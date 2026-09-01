const KEY_ENABLED = "enabled";
const KEY_DIAG_REQUEST = "diagnosticsRequest";
const KEY_DIAG_RESULT = "diagnosticsResult";
const KEY_STATS = "lastStats";
const KEY_BLOCK_NETWORK = "blockNetwork";
const KEY_PENDING_EXPORT = "pendingMarkdownExport";

/**
 * Ad creative host. Requested only when network blocking is switched on, so a
 * default install keeps host access limited to ChatGPT - and so the switch
 * cannot end up on while the rule is inert for lack of access.
 */
const CREATIVE_ORIGIN = "https://bzrcdn.openai.com/*";
const EXPORT_IMAGE_ORIGINS = [
  "https://*.oaiusercontent.com/*",
  "https://*.oaistatic.com/*",
  "https://images.openai.com/*",
  "https://oaidalleapiprodscus.blob.core.windows.net/*",
];

const toggle = document.getElementById("toggle");
const network = document.getElementById("network");
const status = document.getElementById("status");
const stats = document.getElementById("stats");
const scanButton = document.getElementById("scan");
const copyButton = document.getElementById("copy");
const report = document.getElementById("report");
const copyMarkdownButton = document.getElementById("copy-markdown");
const exportMarkdownButton = document.getElementById("export-markdown");
const printConversationButton = document.getElementById("print-conversation");
const exportStatus = document.getElementById("export-status");

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
      exportStatus.textContent = "Open a ChatGPT conversation and try again.";
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
            "Reload the open ChatGPT tab, then try again.";
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

exportMarkdownButton.addEventListener("click", () => {
  const startExport = (imageAccess) => {
    runExportAction(
      exportMarkdownButton,
      "export-conversation-markdown",
      "Exporting\u2026",
      (result) =>
        `Downloaded ${result.messages || 0} messages and ${
          result.images || 0
        } images${
          result.failedImages ? `; ${result.failedImages} kept as links` : ""
        }${imageAccess ? "" : "; image-host access was not granted"}.`,
    );
  };
  chrome.permissions.contains({ origins: EXPORT_IMAGE_ORIGINS }, (granted) => {
    if (granted) {
      startExport(true);
      return;
    }
    // Chrome closes the popup for a host-permission prompt. The worker watches
    // for the grant and starts this pending export after the popup is gone.
    chrome.storage.local.set({ [KEY_PENDING_EXPORT]: Date.now() });
    chrome.permissions.request({ origins: EXPORT_IMAGE_ORIGINS }, (accepted) => {
      if (!accepted) {
        chrome.storage.local.remove(KEY_PENDING_EXPORT);
        startExport(false);
      }
    });
  });
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
