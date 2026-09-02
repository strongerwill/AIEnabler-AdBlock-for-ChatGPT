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
const PROTECTED_DOMAINS = [
  "chatgpt.com",
  "chat.openai.com",
  "gemini.google.com",
  "claude.ai",
  "chat.deepseek.com",
  "grok.com",
  "grok.x.ai",
  "copilot.microsoft.com",
  "perplexity.ai",
  "chat.mistral.ai",
  "kimi.com",
  "kimi.moonshot.cn",
  "chat.qwen.ai",
  "poe.com",
];

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
const OFFSCREEN_DOCUMENT = "offscreen/offscreen.html";
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

/** Sites where only the export tools run. Ad hiding stays ChatGPT-only. */
const EXPORT_ONLY_MATCHES = [
  "https://gemini.google.com/*",
  "https://claude.ai/*",
  "https://*.claude.ai/*",
  "https://chat.deepseek.com/*",
  "https://grok.com/*",
  "https://grok.x.ai/*",
  "https://copilot.microsoft.com/*",
  "https://www.perplexity.ai/*",
  "https://perplexity.ai/*",
  "https://chat.mistral.ai/*",
  "https://www.kimi.com/*",
  "https://kimi.com/*",
  "https://kimi.moonshot.cn/*",
  "https://chat.qwen.ai/*",
  "https://poe.com/*",
];

const CHATGPT_MATCHES = [
  "https://chatgpt.com/*",
  "https://*.chatgpt.com/*",
  "https://chat.openai.com/*",
];

/**
 * Frames a chat site renders diagrams in. Never a tab of their own, so nothing
 * is injected into them from here - the declared content script covers them -
 * but the access still has to be granted for that script to run.
 */
const FRAME_MATCHES = [
  "https://*.claudeusercontent.com/*",
  "https://*.claudemcpcontent.com/*",
];

/**
 * Chrome only injects content scripts into pages loaded after the extension
 * starts, so a tab that was already open would need a manual reload before the
 * copy and export controls appeared. Injecting on install and on browser start
 * removes that step. Already-injected tabs are skipped, because re-running the
 * scripts in the same tab would throw on their top-level declarations.
 */
/**
 * The reader script for diagram frames, injected on its own because a tab that
 * already has the page scripts can still be holding a frame that has none - a
 * frame loaded before access to its domain was granted.
 */
async function injectFrameReader(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content/frame-tools.js"],
    });
    return true;
  } catch {
    // No access to those frames. The export marks the diagram as unreadable
    // instead, which is the honest outcome.
    return false;
  }
}

async function injectIntoTab(tabId, group) {
  await injectFrameReader(tabId);
  const [probe] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => Boolean(window.__AIENABLER_EXPORT_TOOLS__),
  });
  if (probe?.result) return false;
  await chrome.scripting.insertCSS({ target: { tabId }, files: group.css });
  await chrome.scripting.executeScript({ target: { tabId }, files: group.js });
  return true;
}

async function injectIntoOpenTabs() {
  const groups = [
    {
      matches: CHATGPT_MATCHES,
      css: ["content/hide-ads.css", "content/export-tools.css"],
      js: [
        "content/sites.js",
        "content/hide-ads.js",
        "content/export-tools.js",
      ],
    },
    {
      matches: EXPORT_ONLY_MATCHES,
      css: ["content/export-tools.css"],
      js: ["content/sites.js", "content/export-tools.js"],
    },
  ];

  for (const group of groups) {
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({ url: group.matches });
    } catch {
      continue;
    }
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await injectIntoTab(tab.id, group);
      } catch {
        /* Tab closed, still loading, or not scriptable: it will load normally. */
      }
    }
  }
}

function safeInjectIntoOpenTabs() {
  injectIntoOpenTabs().catch(() => {
    /* Injection is a convenience; a page load installs the scripts anyway. */
  });
}

/** True for a match pattern naming one of the chat sites, e.g. from a grant. */
function isChatSiteOrigin(origin) {
  return [...CHATGPT_MATCHES, ...EXPORT_ONLY_MATCHES].includes(origin);
}

const ALL_MATCHES = [
  ...CHATGPT_MATCHES,
  ...EXPORT_ONLY_MATCHES,
  ...FRAME_MATCHES,
];

/**
 * Chrome withholds host access when site access is set to "on click", and when
 * an update widens the declared hosts. Either way the content script silently
 * never runs, so the toolbar badge is what tells the user to open the popup
 * rather than leaving them to guess why the buttons are missing.
 */
async function refreshAccessBadge() {
  let granted = true;
  try {
    granted = await chrome.permissions.contains({ origins: ALL_MATCHES });
  } catch {
    return;
  }
  try {
    await chrome.action.setBadgeText({ text: granted ? "" : "!" });
    if (!granted) {
      await chrome.action.setBadgeBackgroundColor({ color: "#c2410c" });
      await chrome.action.setTitle({
        title:
          "AIEnabler: open the popup to let the chat sites run automatically",
      });
    } else {
      await chrome.action.setTitle({
        title: "AIEnabler: Block Ads & Export Chats",
      });
    }
  } catch {
    /* The action API is unavailable while the worker is shutting down. */
  }
}

function safeRefreshAccessBadge() {
  refreshAccessBadge().catch(() => {
    /* A missing badge is cosmetic; never break the worker over it. */
  });
}

chrome.permissions.onRemoved.addListener(safeRefreshAccessBadge);

function chatHostGroup(url) {
  let hostname;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    hostname = parsed.hostname;
  } catch {
    return null;
  }
  const chatgptHosts = ["chatgpt.com", "chat.openai.com"];
  const exportHosts = [
    "gemini.google.com",
    "claude.ai",
    "chat.deepseek.com",
    "grok.com",
    "grok.x.ai",
    "copilot.microsoft.com",
    "perplexity.ai",
    "chat.mistral.ai",
    "kimi.com",
    "kimi.moonshot.cn",
    "chat.qwen.ai",
    "poe.com",
  ];
  if (hostAllowed(hostname, chatgptHosts)) {
    return {
      css: ["content/hide-ads.css", "content/export-tools.css"],
      js: [
        "content/sites.js",
        "content/hide-ads.js",
        "content/export-tools.js",
      ],
    };
  }
  if (hostAllowed(hostname, exportHosts)) {
    return {
      css: ["content/export-tools.css"],
      js: ["content/sites.js", "content/export-tools.js"],
    };
  }
  return null;
}

/**
 * Belt and braces for the declared content scripts. A tab can end up without
 * them - a permission that was granted after the tab opened, an extension
 * reload, or a navigation the declarative match missed - and the only visible
 * symptom is that no toolbar ever appears. Re-injecting on load is cheap
 * because an already-injected tab is detected and skipped.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const group = chatHostGroup(tab?.url || "");
  if (!group) return;
  injectIntoTab(tabId, group).catch(() => {
    /* Not scriptable yet; the periodic sweep or a reload will cover it. */
  });
});

chrome.runtime.onInstalled.addListener(() => {
  safeSyncRules();
  safeInjectIntoOpenTabs();
  safeRefreshAccessBadge();
});

chrome.runtime.onStartup.addListener(() => {
  safeSyncRules();
  safeInjectIntoOpenTabs();
  safeRefreshAccessBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[KEY_BLOCK_NETWORK]) safeSyncRules();
});

function hostAllowed(hostname, allowed) {
  return allowed.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "aienabler-inject-frames") return undefined;
  const tabId = sender.tab?.id;
  if (!tabId || !chatHostGroup(sender.tab?.url || "")) {
    sendResponse({ ok: false });
    return undefined;
  }
  injectFrameReader(tabId).then((ok) => sendResponse({ ok }));
  return true;
});

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_DOCUMENT,
        reasons: ["CLIPBOARD"],
        justification: "Copy locally converted chat Markdown on shortcut.",
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

chrome.permissions.onAdded.addListener((permissions) => {
  const origins = permissions.origins || [];
  // Site access just went from "on click" to allowed, so the tabs that were
  // open under the old setting still have no content script.
  if (origins.some(isChatSiteOrigin)) safeInjectIntoOpenTabs();
  safeRefreshAccessBadge();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "copy-latest-markdown" && command !== "print-conversation") {
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (command === "print-conversation") {
      await chrome.tabs.sendMessage(tab.id, {
        type: "aienabler-export",
        action: "print-conversation",
      });
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "aienabler-export",
      action: "get-latest-markdown",
    });
    if (!response?.ok || !response.result?.markdown) {
      throw new Error(response?.error || "No answer was found.");
    }
    // The page cannot reach the clipboard without a click, so the worker hands
    // the text to an offscreen document that can.
    await copyWithOffscreenDocument(response.result.markdown);
  } catch {
    /* The active tab is not a supported chat page. */
  }
});

// Also on every service-worker start: an update that leaves stale rules behind
// must not need a browser restart to become harmless.
safeSyncRules();
safeRefreshAccessBadge();
