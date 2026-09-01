/**
 * Network layer (opt-in, off by default).
 *
 * Earlier versions blocked requests on chatgpt.com by URL path, including a
 * `/(?:ads|advertisement|sponsored)/` regex and the `assistant-ads-*` chunks.
 * Those paths are not exclusive to advertising: the lightweight renderer serves
 * its conversation stream and its partial-update chunks from the same origin,
 * and a blocked request there leaves the thread stuck on
 * "Unable to connect. Retry". Cosmetic + script hiding already removes every ad
 * the client renders, so the app's correctness wins: nothing on chatgpt.com is
 * blocked any more.
 *
 * What remains is limited to third-party ad creative hosts, which the
 * conversation never loads from, and it is opt-in. Dynamic rules survive
 * extension updates, so every path through here also clears rules left behind
 * by an older version.
 */

const KEY_BLOCK_NETWORK = "blockNetwork";

/** Hosts serving ad creatives only. Never a ChatGPT app or API origin. */
const CREATIVE_DOMAINS = ["bzrcdn.openai.com"];

/**
 * Domains no rule may ever target: the conversation stream
 * (`/unauth-mweb/conversation`), the APIs (`/backend-api/`, `/backend-anon/`),
 * the sentinel frame, the beacons and the partial-update script chunks all live
 * on them.
 */
const PROTECTED_DOMAINS = ["chatgpt.com", "chat.openai.com"];

const RULES = [
  {
    id: 1,
    priority: 1,
    action: { type: "block" },
    condition: {
      requestDomains: CREATIVE_DOMAINS,
      resourceTypes: ["image", "media"],
    },
  },
];

/**
 * A rule is only allowed out if it names the exact hosts it applies to, and
 * none of them is a ChatGPT origin. This is a hard stop rather than a comment,
 * because the bug this file exists to fix was a rule that looked ad-specific
 * but matched first-party endpoints.
 */
function isSafeRule(rule) {
  const domains = rule.condition && rule.condition.requestDomains;
  if (!Array.isArray(domains) || domains.length === 0) return false;
  return domains.every(
    (domain) =>
      !PROTECTED_DOMAINS.some(
        (protectedDomain) =>
          domain === protectedDomain || domain.endsWith(`.${protectedDomain}`),
      ),
  );
}

const SAFE_RULES = RULES.filter(isSafeRule);
const MAX_EXPORT_IMAGE_BYTES = 25 * 1024 * 1024;
const OFFSCREEN_DOCUMENT = "offscreen/offscreen.html";
const KEY_PENDING_EXPORT = "pendingMarkdownExport";
const EXPORT_IMAGE_ORIGINS = new Set([
  "https://*.oaiusercontent.com/*",
  "https://*.oaistatic.com/*",
  "https://images.openai.com/*",
  "https://oaidalleapiprodscus.blob.core.windows.net/*",
]);
let creatingOffscreen = null;

async function syncRules() {
  let on = false;
  try {
    const stored = await chrome.storage.local.get(KEY_BLOCK_NETWORK);
    on = stored[KEY_BLOCK_NETWORK] === true;
  } catch {
    /* unreadable storage means off: ChatGPT must work by default */
  }

  const wanted = on ? SAFE_RULES : [];
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  // Every existing id goes, not just the ones this build knows about, so rules
  // added by an older version cannot outlive it.
  const removeRuleIds = existing.map((rule) => rule.id);

  // Nothing installed and nothing wanted: the common case, so it stays a no-op.
  if (removeRuleIds.length === 0 && wanted.length === 0) return;

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: wanted,
  });
}

function safeSyncRules() {
  syncRules().catch(() => {
    /* nothing to do: leaving rules alone is safer than retrying blindly */
  });
}

chrome.runtime.onInstalled.addListener(safeSyncRules);
chrome.runtime.onStartup.addListener(safeSyncRules);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[KEY_BLOCK_NETWORK]) safeSyncRules();
});

function isChatGptSender(sender) {
  try {
    const url = new URL(sender.tab?.url || "");
    return (
      url.protocol === "https:" &&
      (url.hostname === "chatgpt.com" ||
        url.hostname.endsWith(".chatgpt.com") ||
        url.hostname === "chat.openai.com")
    );
  } catch {
    return false;
  }
}

function isAllowedExportImageUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "images.openai.com" ||
        url.hostname === "oaidalleapiprodscus.blob.core.windows.net" ||
        url.hostname.endsWith(".oaiusercontent.com") ||
        url.hostname.endsWith(".oaistatic.com"))
    );
  } catch {
    return false;
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "aienabler-fetch-image") return undefined;
  if (!isChatGptSender(sender) || !isAllowedExportImageUrl(message.url)) {
    sendResponse({ ok: false, error: "Image URL was refused." });
    return undefined;
  }
  (async () => {
    const response = await fetch(message.url, { credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!isAllowedExportImageUrl(response.url)) {
      throw new Error("Image redirect was refused.");
    }
    const declaredSize = Number(response.headers.get("content-length")) || 0;
    if (declaredSize > MAX_EXPORT_IMAGE_BYTES) {
      throw new Error("Image is over 25 MB");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_EXPORT_IMAGE_BYTES) {
      throw new Error("Image is over 25 MB");
    }
    return {
      ok: true,
      contentType: (response.headers.get("content-type") || "").split(";")[0],
      data: bytesToBase64(bytes),
    };
  })()
    .then(sendResponse)
    .catch((error) =>
      sendResponse({ ok: false, error: error.message || "Image fetch failed." }),
    );
  return true;
});

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_DOCUMENT,
        reasons: ["CLIPBOARD"],
        justification: "Copy locally converted ChatGPT Markdown on shortcut.",
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

async function copyWithOffscreenDocument(text) {
  await ensureOffscreenDocument();
  const result = await chrome.runtime.sendMessage({
    target: "aienabler-offscreen",
    type: "copy-markdown",
    text,
  });
  if (!result?.ok) throw new Error(result?.error || "Copy failed.");
}

async function runPendingMarkdownExport() {
  const stored = await chrome.storage.local.get(KEY_PENDING_EXPORT);
  const requestedAt = Number(stored[KEY_PENDING_EXPORT]) || 0;
  await chrome.storage.local.remove(KEY_PENDING_EXPORT);
  if (!requestedAt || Date.now() - requestedAt > 120_000) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, {
    type: "aienabler-export",
    action: "export-conversation-markdown",
  });
}

chrome.permissions.onAdded.addListener((permissions) => {
  if (
    (permissions.origins || []).some((origin) =>
      EXPORT_IMAGE_ORIGINS.has(origin),
    )
  ) {
    runPendingMarkdownExport().catch(() => {
      /* The ChatGPT tab was closed while the permission prompt was open. */
    });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (
    command !== "copy-latest-markdown" &&
    command !== "export-conversation-markdown"
  ) {
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (command === "copy-latest-markdown") {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "aienabler-export",
        action: "get-latest-markdown",
      });
      if (!response?.ok || !response.result?.markdown) {
        throw new Error(response?.error || "No answer was found.");
      }
      await copyWithOffscreenDocument(response.result.markdown);
    } else {
      try {
        await chrome.permissions.request({
          origins: Array.from(EXPORT_IMAGE_ORIGINS),
        });
      } catch {
        /* Export still succeeds with original links if access is denied. */
      }
      await chrome.tabs.sendMessage(tab.id, {
        type: "aienabler-export",
        action: command,
      });
    }
  } catch {
    /* The active tab is not a supported ChatGPT page. */
  }
});

// Also on every service-worker start: an update that leaves stale rules behind
// must not need a browser restart to become harmless.
safeSyncRules();
