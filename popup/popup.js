const KEY_ENABLED = "enabled";
const KEY_DIAG_REQUEST = "diagnosticsRequest";
const KEY_DIAG_RESULT = "diagnosticsResult";
const KEY_STATS = "lastStats";
const KEY_BLOCK_NETWORK = "blockNetwork";

const toggle = document.getElementById("toggle");
const network = document.getElementById("network");
const status = document.getElementById("status");
const stats = document.getElementById("stats");
const scanButton = document.getElementById("scan");
const copyButton = document.getElementById("copy");
const report = document.getElementById("report");

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
    network.checked = result[KEY_BLOCK_NETWORK] !== false;
    setStatus(on);
    renderStats(result[KEY_STATS]);
  },
);

toggle.addEventListener("change", () => {
  const on = toggle.checked;
  chrome.storage.local.set({ [KEY_ENABLED]: on }, () => setStatus(on));
});

network.addEventListener("change", () => {
  chrome.storage.local.set({ [KEY_BLOCK_NETWORK]: network.checked });
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[KEY_STATS]) renderStats(changes[KEY_STATS].newValue);
  const result = changes[KEY_DIAG_RESULT] && changes[KEY_DIAG_RESULT].newValue;
  if (result && result.ts >= scanStartedAt) {
    window.clearTimeout(scanTimer);
    showReport(result);
  }
});
