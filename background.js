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

// Also on every service-worker start: an update that leaves stale rules behind
// must not need a browser restart to become harmless.
safeSyncRules();
