const KEY_ENABLED = "enabled";
const KEY_DIAG_REQUEST = "diagnosticsRequest";
const KEY_DIAG_RESULT = "diagnosticsResult";
const KEY_STATS = "lastStats";
const KEY_BLOCK_NETWORK = "blockNetwork";

/**
 * Ad creative host. Requested only when network blocking is switched on, so a
 * default install keeps host access limited to ChatGPT - and so the switch
 * cannot end up on while the rule is inert for lack of access.
 */
const CREATIVE_ORIGIN = "https://bzrcdn.openai.com/*";

const toggle = document.getElementById("toggle");
const network = document.getElementById("network");
const status = document.getElementById("status");
const stats = document.getElementById("stats");
const scanButton = document.getElementById("scan");
const copyButton = document.getElementById("copy");
const report = document.getElementById("report");
const copyMarkdownButton = document.getElementById("copy-markdown");
const printConversationButton = document.getElementById("print-conversation");
const exportStatus = document.getElementById("export-status");
const siteStatus = document.getElementById("site-status");
const enableSiteButton = document.getElementById("enable-site");
const enableAllSitesButton = document.getElementById("enable-all-sites");
const autoRunHint = document.getElementById("auto-run-hint");

/**
 * Every chat origin the extension declares. Chrome withholds these when site
 * access is left on "run on click", and withheld hosts mean no content script
 * and no toolbars - so the popup can grant them all in one prompt.
 */
const ALL_SITE_ORIGINS = [
  "https://chatgpt.com/*",
  "https://*.chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://gemini.google.com/*",
  "https://claude.ai/*",
  "https://*.claude.ai/*",
  // The frames Claude draws diagrams in. Without them an export keeps the text
  // and loses every picture.
  "https://*.claudeusercontent.com/*",
  "https://*.claudemcpcontent.com/*",
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

/** Chat sites the export tools run on, mirrored from the manifest. */
const CHATGPT_HOSTS = ["chatgpt.com", "chat.openai.com"];
const EXPORT_HOSTS = [
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

function hostMatches(hostname, hosts) {
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function tabSiteGroup(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (hostMatches(parsed.hostname, CHATGPT_HOSTS)) {
    return {
      origin: `${parsed.origin}/*`,
      css: ["content/hide-ads.css", "content/export-tools.css"],
      js: [
        "content/sites.js",
        "content/hide-ads.js",
        "content/export-tools.js",
      ],
    };
  }
  if (hostMatches(parsed.hostname, EXPORT_HOSTS)) {
    return {
      origin: `${parsed.origin}/*`,
      css: ["content/export-tools.css"],
      js: ["content/sites.js", "content/export-tools.js"],
    };
  }
  return null;
}

function askContentScript(tabId, action) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "aienabler-export", action }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Chrome does not run content scripts in tabs that were already open when the
 * extension started, and it withholds newly added host permissions on update.
 * Both look identical to the user - no toolbars - so the popup reports which
 * one it is and offers the one-click fix.
 */
async function refreshAutoRunState() {
  const granted = await chrome.permissions.contains({
    origins: ALL_SITE_ORIGINS,
  });
  enableAllSitesButton.hidden = granted;
  autoRunHint.hidden = granted;
  return granted;
}

async function refreshSiteStatus() {
  await refreshAutoRunState();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const group = tab?.url ? tabSiteGroup(tab.url) : null;
  enableSiteButton.hidden = true;
  if (!tab?.id || !group) {
    siteStatus.textContent =
      "This tab is not a supported chat site. Export tools stay hidden here.";
    return;
  }

  const status = await askContentScript(tab.id, "status");
  if (status?.ok) {
    const result = status.result || {};
    // Diagrams live in frames of their own and are the part most likely to go
    // missing, so the count is reported whenever the page has any.
    const diagrams = result.frames
      ? ` ${result.framesRead || 0}/${result.frames} diagrams readable.`
      : "";
    siteStatus.textContent = result.messages
      ? `${result.site || "This site"}: ${result.messages} messages detected, ${
          result.toolbars || 0
        } toolbars placed.${diagrams}`
      : `${result.site || "This site"}: connected, but no messages were found yet. Open a conversation.`;
    return;
  }

  const granted = await chrome.permissions.contains({ origins: [group.origin] });
  if (!granted) {
    siteStatus.textContent =
      "This site is not enabled yet, so the export tools cannot run here.";
    enableSiteButton.hidden = false;
    return;
  }

  siteStatus.textContent = "Activating the export tools on this tab…";
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: group.css });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: group.js });
    const retry = await askContentScript(tab.id, "status");
    siteStatus.textContent = retry?.ok
      ? `${retry.result?.site || "This site"}: activated, ${
          retry.result?.messages || 0
        } messages detected.`
      : "Could not activate here. Reload the page and open the popup again.";
  } catch {
    siteStatus.textContent =
      "Could not activate here. Reload the page and open the popup again.";
  }
}

enableAllSitesButton.addEventListener("click", () => {
  // Called straight from the click: the permission prompt needs the gesture,
  // and Chrome closes the popup while it is up.
  chrome.permissions.request({ origins: ALL_SITE_ORIGINS }, (granted) => {
    if (!granted) {
      siteStatus.textContent =
        "Site access was not granted, so the tools still run only when clicked.";
      return;
    }
    refreshSiteStatus().catch(() => {
      siteStatus.textContent = "Enabled. Open a chat tab to use the tools.";
    });
  });
});

enableSiteButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const group = tab?.url ? tabSiteGroup(tab.url) : null;
  if (!group) return;
  const granted = await chrome.permissions.request({ origins: [group.origin] });
  if (!granted) {
    siteStatus.textContent = "Site access was not granted, so nothing changed.";
    return;
  }
  await refreshSiteStatus();
});

refreshSiteStatus().catch(() => {
  siteStatus.textContent = "Could not read this tab.";
});

let scanStartedAt = 0;
let scanTimer = 0;

function setStatus(on) {
  status.textContent = on
    ? "On \u2014 sponsored cards are hidden on ChatGPT."
    : "Off \u2014 ChatGPT ads are shown.";
}

function renderStats(value) {
  if (!value || typeof value.count !== "number") {
    stats.textContent = "";
    return;
  }
  const reasons = Object.entries(value.reasons || {})
    .map(([reason, count]) => `${reason} \u00d7${count}`)
    .join(", ");
  stats.textContent = value.count
    ? `Hidden on last ChatGPT page: ${value.count}${reasons ? ` (${reasons})` : ""}`
    : "Nothing matched on the last ChatGPT page yet.";
}

function showReport(result) {
  report.hidden = false;
  copyButton.hidden = false;
  report.value = JSON.stringify(result, null, 2);
  scanButton.disabled = false;
  scanButton.textContent = "Scan open ChatGPT tab";
}

chrome.storage.local.get(
  [KEY_ENABLED, KEY_STATS, KEY_BLOCK_NETWORK],
  (result) => {
    const on = result[KEY_ENABLED] !== false;
    toggle.checked = on;
    // Opt-in: anything other than an explicit true reads as off, so a fresh
    // profile - and one upgrading from the version that defaulted this on -
    // starts with ChatGPT untouched by network blocking.
    const blocking = result[KEY_BLOCK_NETWORK] === true;
    network.checked = blocking;
    if (blocking) {
      // Chrome closes the popup while the permission prompt is up, so a denied
      // request may never reach its callback. The grant is the source of truth.
      chrome.permissions.contains({ origins: [CREATIVE_ORIGIN] }, (granted) => {
        network.checked = Boolean(granted);
        if (!granted) chrome.storage.local.set({ [KEY_BLOCK_NETWORK]: false });
      });
    }
    setStatus(on);
    renderStats(result[KEY_STATS]);
  },
);

toggle.addEventListener("change", () => {
  const on = toggle.checked;
  chrome.storage.local.set({ [KEY_ENABLED]: on }, () => setStatus(on));
});

network.addEventListener("change", () => {
  if (!network.checked) {
    chrome.storage.local.set({ [KEY_BLOCK_NETWORK]: false });
    chrome.permissions.remove({ origins: [CREATIVE_ORIGIN] }, () => {});
    return;
  }
  // Stored first, because the permission prompt closes the popup and the
  // callback below may never run. Without the grant the rule simply never
  // matches, and the next popup open reconciles the switch.
  chrome.storage.local.set({ [KEY_BLOCK_NETWORK]: true });
  // Called straight from the change event: the request needs the user gesture.
  chrome.permissions.request({ origins: [CREATIVE_ORIGIN] }, (granted) => {
    network.checked = Boolean(granted);
    if (!granted) {
      chrome.storage.local.set({ [KEY_BLOCK_NETWORK]: false });
      status.textContent =
        "Ad-host access was not granted, so request blocking stays off.";
    }
  });
});

scanButton.addEventListener("click", () => {
  scanStartedAt = Date.now();
  scanButton.disabled = true;
  scanButton.textContent = "Scanning\u2026";
  report.hidden = true;
  copyButton.hidden = true;
  chrome.storage.local.set({ [KEY_DIAG_REQUEST]: scanStartedAt });

  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => {
    scanButton.disabled = false;
    scanButton.textContent = "Scan open ChatGPT tab";
    status.textContent =
      "No ChatGPT tab answered. Open chatgpt.com, reload it, then scan again.";
  }, 2500);
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(report.value);
  copyButton.textContent = "Copied";
  window.setTimeout(() => {
    copyButton.textContent = "Copy report";
  }, 1200);
});

function runExportAction(button, action, pendingText, doneText) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = pendingText;
  exportStatus.textContent = "";
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (chrome.runtime.lastError || !tab?.id) {
      button.disabled = false;
      button.textContent = originalText;
      exportStatus.textContent = "Open a supported chat tab and try again.";
      return;
    }
    chrome.tabs.sendMessage(
      tab.id,
      { type: "aienabler-export", action },
      (response) => {
        button.disabled = false;
        button.textContent = originalText;
        if (chrome.runtime.lastError || !response) {
          exportStatus.textContent =
            "Reload the open chat tab, then try again.";
          return;
        }
        if (!response.ok) {
          exportStatus.textContent =
            response.error || "The export could not be completed.";
          return;
        }
        Promise.resolve(doneText(response.result || {}))
          .then((message) => {
            exportStatus.textContent = message;
          })
          .catch((error) => {
            exportStatus.textContent =
              error.message || "The action could not be completed.";
          });
      },
    );
  });
}

copyMarkdownButton.addEventListener("click", () => {
  runExportAction(
    copyMarkdownButton,
    "get-latest-markdown",
    "Copying\u2026",
    async (result) => {
      await navigator.clipboard.writeText(result.markdown || "");
      return "Latest assistant answer copied as Markdown.";
    },
  );
});

printConversationButton.addEventListener("click", () => {
  runExportAction(
    printConversationButton,
    "print-conversation",
    "Preparing\u2026",
    () => {
      window.setTimeout(() => window.close(), 50);
      return "Opening print dialog\u2026";
    },
  );
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[KEY_STATS]) renderStats(changes[KEY_STATS].newValue);
  const result = changes[KEY_DIAG_RESULT] && changes[KEY_DIAG_RESULT].newValue;
  if (result && result.ts >= scanStartedAt) {
    window.clearTimeout(scanTimer);
    showReport(result);
  }
});
