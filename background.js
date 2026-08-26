/**
 * Network layer.
 *
 * The ChatGPT client loads its ad UI as lazy ES module chunks
 * (assistant-ads-*.js, ads-analytics-vendor-*.js). Blocking those requests
 * stops the ad from ever mounting, which cosmetic filtering alone cannot
 * guarantee once markup changes.
 *
 * On by default, with a popup switch to turn it off: ChatGPT's own
 * module-recovery path may reload the tab once per build when a dynamic import
 * fails, and its session guard keeps that from repeating.
 */

const KEY_BLOCK_NETWORK = "blockNetwork";

const AD_DOMAINS = ["chatgpt.com", "chat.openai.com"];

const RULES = [
  {
    id: 1,
    priority: 1,
    action: { type: "block" },
    condition: {
      regexFilter: "/assistant-ads[^/]*\\.(?:js|css|mjs)",
      requestDomains: AD_DOMAINS,
      resourceTypes: ["script", "stylesheet", "xmlhttprequest"],
    },
  },
  {
    id: 2,
    priority: 1,
    action: { type: "block" },
    condition: {
      regexFilter: "/ads-analytics[^/]*\\.(?:js|css|mjs)",
      requestDomains: AD_DOMAINS,
      resourceTypes: ["script", "stylesheet", "xmlhttprequest"],
    },
  },
  {
    id: 3,
    priority: 1,
    action: { type: "block" },
    condition: {
      regexFilter: "/(?:ads|advertisement|sponsored)/",
      requestDomains: AD_DOMAINS,
      resourceTypes: ["xmlhttprequest", "image", "ping", "script"],
    },
  },
];

const RULE_IDS = RULES.map((rule) => rule.id);

async function syncRules() {
  const stored = await chrome.storage.local.get(KEY_BLOCK_NETWORK);
  const on = stored[KEY_BLOCK_NETWORK] !== false;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: RULE_IDS,
    addRules: on ? RULES : [],
  });
}

chrome.runtime.onInstalled.addListener(() => {
  syncRules();
});

chrome.runtime.onStartup.addListener(() => {
  syncRules();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[KEY_BLOCK_NETWORK]) syncRules();
});
