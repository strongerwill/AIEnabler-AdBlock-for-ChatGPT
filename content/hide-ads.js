/*
 * AIEnabler - local export and clean-up tools for AI chat sites.
 * Copyright (C) 2026 David Cheng
 *
 * Free software under the GNU General Public License, version 3 or later.
 * Distributed with NO WARRANTY; see the LICENSE file in this repository or
 * <https://www.gnu.org/licenses/> for the full terms.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * AIEnabler ad-hiding content script.
 *
 * Detection is pattern based rather than a fixed selector list, because
 * ChatGPT ships hashed class names and renames data attributes often.
 * An element is treated as ad chrome when one of these is true:
 *   1. it has an attribute whose NAME carries an ad/sponsor token
 *   2. class/id/aria/testid VALUES carry an ad/sponsor token
 *   3. it is an ad control ("Sponsored options", "About this ad") or a short
 *      disclosure label ("Sponsored", "\u5e7f\u544a", ...), in which case the
 *      surrounding card is hidden instead of the label alone
 *   4. it links through the ad server (oppref/olref, utm_medium=paidaeo)
 *   5. it sits next to the ad's analytics JSON ("adsRequestId", "adDataToken")
 *
 * For 3-5 the whole unit goes, not just the anchor: hideAdAround() climbs to the
 * landmark wrapping the ad - the `<aside aria-label=" Sponsored ">` or its
 * `<section>` - so the "About this ad" panel and the empty frame go with it.
 *
 * Values are tokenized (kebab, snake and camelCase aware) instead of substring
 * matched, so "adCard" and "-ads-" hit while "head", "add files", "threads" and
 * "advanced" do not. For CSS-module class names the "_hash_" prefix is dropped
 * before tokenizing so random hashes can never look like an ad token.
 *
 * isSafeToHide() is what keeps this from eating the page: it refuses any
 * element that is - or contains - the answer body, a conversation turn, the
 * composer or page chrome, and refuses anything holding more text than a card
 * plausibly would.
 */

const KEY_ENABLED = "enabled";
const KEY_DIAG_REQUEST = "diagnosticsRequest";
const KEY_DIAG_RESULT = "diagnosticsResult";
const KEY_STATS = "lastStats";

/**
 * Filtering is the default state, so the stylesheet works even if this script
 * never runs. The class below only ever turns filtering *off*.
 */
const OFF_CLASS = "gpt-ad-filter-off";
const HIDDEN_CLASS = "gpt-ad-filter-hidden";
const MARK_ATTR = "data-gpt-ad-filter";
const REASON_ATTR = "data-gpt-ad-filter-reason";
const HTML_NS = "http://www.w3.org/1999/xhtml";

/** Ad containers. Hidden as-is. Mirrored in hide-ads.css for instant hiding. */
const CARD_SELECTORS = [
  "[data-sponsor]",
  "[data-sponsored]",
  "[data-sponsor-v2]",
  "[data-ad-card]",
  "[data-ad-slot]",
  "[data-ad-unit]",
  "[data-ads]",
  "[data-ad]",
  "[data-assistant-ads]",
  "[data-assistant-ad]",
  "[data-ads-placement]",
  "[data-ad-placement]",
  "[data-advertisement]",
  "[data-promoted]",
  "[data-koah-ad]",
  '[data-testid^="ad-" i]',
  '[data-testid$="-ad" i]',
  '[data-testid*="-ad-" i]',
  '[data-testid*="sponsor" i]',
  '[data-testid*="promoted" i]',
];

/** Ad labels and controls. The surrounding card is hidden, not just these. */
const ANCHOR_SELECTORS = [
  // Matched as a substring: the live markup labels the unit " Sponsored ",
  // padded with spaces, and its menu button "Sponsored options".
  '[aria-label*="sponsor" i]',
  '[aria-roledescription*="sponsor" i]',
  '[aria-label*="promoted" i]',
  '[aria-label*="advertisement" i]',
  '[aria-label*="ad options" i]',
  '[aria-label*="ad settings" i]',
  '[aria-label*="this ad" i]',
  // Ad server click-through links and creatives.
  'a[href*="utm_medium=paidaeo" i]',
  'a[href*="oppref=" i]',
  'a[href*="olref=" i]',
  'img[src*="bzrcdn.openai.com" i]',
];

/** Ad tokens, compared against tokenized attribute names and values. */
const AD_TOKENS = new Set([
  "ad",
  "ads",
  "adcard",
  "adcards",
  "adslot",
  "adslots",
  "adunit",
  "adunits",
  "advert",
  "adverts",
  "advertise",
  "advertisement",
  "advertisements",
  "advertising",
  "koah",
  "promoted",
  "promotion",
  "promotions",
  "sponsor",
  "sponsors",
  "sponsored",
  "sponsoring",
  "sponsorship",
]);

/**
 * Words that turn an ad token into a flag or a capability on a container that
 * merely hosts ads ("data-ads-eligible", "adsEnabled"), so it must not be hidden.
 */
const STATE_TOKENS = new Set([
  "allowed",
  "blocked",
  "consent",
  "disabled",
  "eligible",
  "enabled",
  "free",
  "opt",
  "optin",
  "optout",
  "settings",
  "supported",
]);

/**
 * Attributes whose VALUES are worth tokenizing. Deliberately a whitelist:
 * arbitrary data-* payloads (base64, JSON) produce garbage tokens.
 */
const VALUE_ATTRS = new Set([
  "class",
  "id",
  "title",
  "alt",
  "aria-label",
  "aria-roledescription",
  "data-testid",
  "data-test-id",
  "data-component",
  "data-component-name",
  "data-widget",
  "data-widget-type",
  "data-slot",
  "data-placement",
  "data-kind",
  "data-type",
  "data-variant",
  "data-surface",
]);

/** A hit on these describes a control or label, so expand to its card. */
const LABEL_ATTRS = new Set([
  "alt",
  "aria-label",
  "aria-roledescription",
  "title",
]);

/** Short disclosure labels. Matched on exact normalized text only. */
const DISCLOSURE_LABELS = new Set([
  "sponsored",
  "sponsor",
  "sponsored content",
  "sponsored result",
  "sponsored results",
  "sponsored link",
  "sponsored links",
  "promoted",
  "promoted content",
  "advertisement",
  "advertising",
  "paid partnership",
  "partner content",
  "ads by chatgpt",
  "ad",
  "\u5e7f\u544a",
  "\u5ee3\u544a",
  "\u8d5e\u52a9",
  "\u8d5e\u52a9\u5185\u5bb9",
  "\u8d0a\u52a9",
  "\u63a8\u5e7f",
  "\u30b9\u30dd\u30f3\u30b5\u30fc",
  "\u5e83\u544a",
  "\uad11\uace0",
]);

/**
 * Rendered answer and prompt text. Nothing inside it is ever an ad: an ad unit
 * is a sibling of the message body, never part of it. So a heuristic hit in
 * here is the model quoting an ad, and is ignored outright.
 */
const ANSWER_BODY_SELECTOR = [
  "[data-assistant-markdown]",
  "[data-message-content]",
  "[data-user-message-copy]",
  "[data-user-message-bubble]",
  ".markdown",
  ".prose",
].join(", ");

/** Answer/question bodies. Never hidden, never swallowed by a card. */
const PROSE_SELECTOR = [ANSWER_BODY_SELECTOR, "[data-stream-target]"].join(", ");

/** One conversation turn. Never hidden, never swallowed by a card. */
const TURN_SELECTOR = [
  "[data-message-role]",
  "[data-message-id]",
  '[data-testid^="conversation-turn"]',
  ".agent-turn",
].join(", ");

/**
 * Page chrome. Never hidden, and never present inside anything we hide.
 *
 * Kept as narrow as possible, because a single entry appearing anywhere inside
 * an ad makes that ad unhideable. `aside` is the clearest example: the served
 * unit *is* an `<aside>`, so the sidebar is named directly instead.
 */
const CHROME_SELECTOR = [
  "main",
  "nav",
  "textarea",
  "#web-mobile-root",
  '[role="navigation"]',
  'aside[aria-label="Sidebar" i]',
  ".wm-desktop-sidebar",
  ".wm-sidebar-sidebar",
  "[data-conversation-transcript]",
  "[data-web-mobile-conversation]",
  "[data-mobile-composer]",
  "[data-swipable-detail-body]",
  "[data-swipable-detail-footer]",
  // Recovery and auth UI. An ad unit never contains these, and hiding one would
  // leave the user with no way to retry a failed turn or dismiss ChatGPT's
  // anonymous rate-limit prompt.
  "#mobile-auth-dialog",
  "#no-auth-soft-rate-limit-dialog",
  "[data-conversation-recovery]",
  "[data-conversation-recovery-retry]",
  "[data-conversation-gate]",
  "[data-safety-dialog]",
  // React "lightweight web" shell: layout wrappers that must never collapse.
  ".wm-app-appShell",
  ".wm-app-conversation",
  ".wm-app-thread",
  ".wm-app-threadContent",
  ".wm-app-threadViewport",
  ".wm-composer-composer",
].join(", ");

/**
 * Never hidden as themselves, but allowed *inside* something we hide.
 *
 * `header` is the reason this list exists: the ad's own "About this ad" panel
 * has one, and treating it as page chrome made the whole ad unit unhideable.
 * The page-level header, footer and form are not reachable anyway, since only
 * an element carrying an ad signal is ever a candidate.
 */
const SELF_ONLY_SELECTOR = [
  "html",
  "head",
  "body",
  "header",
  "footer",
  "form",
  "dialog",
].join(", ");

/** Conversation content. Never hidden, never swallowed by a card. */
const CONTENT_SELECTOR = [PROSE_SELECTOR, TURN_SELECTOR].join(", ");

/** Self-match guard for an element the page itself marked as an ad. */
const PROTECTED_SELECTOR = [CHROME_SELECTOR, SELF_ONLY_SELECTOR].join(", ");

/** Anything matching this is off limits, as a self match or as a descendant. */
const KEEP_SELECTOR = [CHROME_SELECTOR, CONTENT_SELECTOR].join(", ");

/** Self-match guard for a card inferred from a nearby label or control. */
const IMPLICIT_SELF_SELECTOR = [
  PROTECTED_SELECTOR,
  CONTENT_SELECTOR,
].join(", ");

/** Climbing from a label stops here. */
const BOUNDARY_SELECTOR = KEEP_SELECTOR;

/**
 * The wrapper a whole ad unit lives in. Reached by climbing from any part of the
 * ad, so a renamed label or class still loses its entire card.
 */
const UNIT_TAGS = new Set(["ASIDE", "SECTION", "ARTICLE"]);
const UNIT_ROLES = new Set(["complementary", "list", "listitem", "region"]);

/**
 * Ad click-through links: `oppref`/`olref` are the ad server's referral tokens
 * and `paidaeo` its campaign medium. Matched raw, since tokenizing a URL turns
 * every "ad" inside a path or query blob into a false positive.
 */
const AD_LINK_PATTERN = /[?&](?:oppref|olref)=|utm_medium=paidaeo/i;

/**
 * Host serving ad creatives. Conversation images never come from it, so an
 * `<img>` pointing here is an ad even when every label around it has changed.
 */
const AD_MEDIA_PATTERN = /\/\/bzrcdn\.openai\.com\//i;

/**
 * Keys of the JSON payload ChatGPT embeds next to a rendered ad. Format and
 * class names churn; this bookkeeping does not.
 */
const AD_PAYLOAD_PATTERN =
  /"ads(?:RequestId|ResponseType|ResponseIndex|SpamIntegrityPayload)"|"advertiserCount"|"adDataToken"/;

/** Only the head of a payload is scanned: the encoded blobs run to ~10 kB. */
const MAX_PAYLOAD_SCAN = 4000;

/** Traversed, but never candidates themselves. */
const STRUCTURAL_TAGS = new Set(["HTML", "HEAD", "BODY"]);

/** Neither candidates nor traversed. */
const INERT_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "LINK",
  "META",
  "TITLE",
  "TEMPLATE",
  "NOSCRIPT",
  "SVG",
  "CANVAS",
  "IFRAME",
  "HEAD",
]);

const MAX_NODES_PER_SWEEP = 20000;
const MAX_LABEL_TEXT = 32;
/** Text budget for a label-derived card. */
const MAX_CARD_TEXT = 800;
/** Text budget when an ad attribute named the element outright. */
const MAX_MARKED_TEXT = 2500;
/**
 * Text budget for an ad unit's landmark wrapper. Larger than a card, because the
 * wrapper also holds the "About this ad" panel, but far below an answer: this is
 * the only guard left once a landmark is hidden without a prose check.
 */
const MAX_UNIT_TEXT = 1600;
const CARD_CLIMB_DEPTH = 8;
const CARD_GROWTH_FACTOR = 1.6;
/**
 * A real card holds a headline plus a line of body copy, so climbing out of a
 * two-character "Ad" badge has to be allowed to pick up a few hundred
 * characters before the growth check calls it a page section.
 */
const CARD_GROWTH_FLOOR = 420;
/** How far a hidden card's empty wrappers are collapsed. */
const WRAPPER_COLLAPSE_DEPTH = 3;
const RESWEEP_INTERVAL_MS = 1500;

let enabled = true;
let hiddenCount = 0;
const hiddenReasons = new Map();
const hiddenNodes = new Set();
const observers = new Set();
let observedRoots = new WeakSet();
/** Elements already found clean. Re-checked only when they mutate. */
let examined = new WeakSet();
let sweepTimer = 0;
let statsTimer = 0;

function normalizedText(el) {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

/**
 * Length of the text a reader would actually see, stopping as soon as `limit` is
 * passed. `textContent` cannot be used for this: an ad unit carries its
 * analytics payload in a `<script type="application/json">`, and those few
 * kilobytes of base64 made every card look like a page section.
 */
function measureVisibleText(el, limit, parts) {
  let total = 0;
  const stack = [el];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.nodeValue || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      total += text.length;
      if (parts) parts.push(text);
      if (total > limit) return total;
      continue;
    }
    if (node !== el) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (INERT_TAGS.has(tagOf(node))) continue;
    }
    // Pushed back to front so popping walks the tree in reading order.
    for (let child = node.lastChild; child; child = child.previousSibling) {
      stack.push(child);
    }
  }
  return total;
}

function visibleTextLength(el, limit) {
  return measureVisibleText(el, limit, null);
}

function visibleTextSample(el, max) {
  const parts = [];
  measureVisibleText(el, max, parts);
  return parts.join(" ").slice(0, max);
}

function tagOf(el) {
  return typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
}

/**
 * Split a value into lowercase words across kebab, snake and camelCase
 * boundaries: "assistantAdsCard" -> assistant, ads, card.
 */
function tokenize(value, out) {
  for (const chunk of String(value).split(/[^A-Za-z0-9]+/)) {
    if (!chunk) continue;
    const spaced = chunk
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
    for (const word of spaced.split(" ")) {
      if (word) out.push(word.toLowerCase());
    }
  }
  return out;
}

/** Drop the "_hash_" prefix of CSS-module class names before tokenizing. */
function classTokens(value) {
  const out = [];
  for (const name of String(value).split(/\s+/)) {
    if (!name) continue;
    const scoped = /^_[A-Za-z0-9-]{3,12}_(.+)$/.exec(name);
    tokenize(scoped ? scoped[1] : name, out);
  }
  return out;
}

/** Each class is judged on its own, so "settings-open" cannot veto "ads-card". */
function classListMatches(value) {
  for (const name of String(value).split(/\s+/)) {
    if (name && hasAdToken(classTokens(name))) return true;
  }
  return false;
}

function hasRawAdToken(tokens) {
  for (const token of tokens) {
    if (AD_TOKENS.has(token)) return true;
  }
  return false;
}

function hasAdToken(tokens) {
  let found = false;
  for (const token of tokens) {
    // "data-ads-eligible" describes a container that may host an ad, not the ad.
    if (STATE_TOKENS.has(token)) return false;
    if (AD_TOKENS.has(token)) found = true;
  }
  return found;
}

/** null, or { reason, expand } describing why this element looks like an ad. */
function adAttributeMatch(el) {
  const attrs = el.attributes;
  if (!attrs) return null;
  for (let i = 0; i < attrs.length; i += 1) {
    const { name, value } = attrs[i];
    if (name === MARK_ATTR || name === REASON_ATTR) continue;
    if (hasAdToken(tokenize(name, []))) {
      return { reason: `attr:${name}`, expand: false };
    }
    if (!value) continue;
    if (name === "href") {
      // The link is inside the card, so the card is what has to go.
      if (AD_LINK_PATTERN.test(value)) return { reason: "link", expand: true };
      continue;
    }
    if (name === "src") {
      // Skipping data: URIs first, since the brand logo is a few kB of base64.
      if (!value.startsWith("data:") && AD_MEDIA_PATTERN.test(value)) {
        return { reason: "media", expand: true };
      }
      continue;
    }
    if (!VALUE_ATTRS.has(name)) continue;
    const hit =
      name === "class"
        ? classListMatches(value)
        : hasAdToken(tokenize(value, []));
    if (hit) {
      return { reason: `value:${name}`, expand: LABEL_ATTRS.has(name) };
    }
  }
  return null;
}

function isDisclosureLabel(el) {
  if (el.childElementCount > 2) return false;
  // Rejected on length first, which stops at the 33rd character instead of
  // building the text of a subtree that may hold an entire answer.
  if (visibleTextLength(el, MAX_LABEL_TEXT) > MAX_LABEL_TEXT) return false;
  const text = normalizedText(el);
  if (!text || text.length > MAX_LABEL_TEXT) return false;
  return DISCLOSURE_LABELS.has(text.toLowerCase().replace(/[·:;.,|]+$/, ""));
}

function isBoundary(el) {
  return Boolean(el.matches && el.matches(BOUNDARY_SELECTOR));
}

/**
 * `explicit` means the element itself carries an ad attribute, so it is allowed
 * to be a conversation turn or hold answer markup: ChatGPT renders some ad
 * units as their own turn, complete with a markdown body. Page chrome is still
 * off limits, and the text budget still applies.
 */
function isSafeToHide(el, maxText, explicit = false) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  if (el.namespaceURI && el.namespaceURI !== HTML_NS) return false;
  const tag = tagOf(el);
  if (STRUCTURAL_TAGS.has(tag) || INERT_TAGS.has(tag)) return false;
  if (!el.matches || !el.querySelector) return false;
  if (el.matches(explicit ? PROTECTED_SELECTOR : IMPLICIT_SELF_SELECTOR)) {
    return false;
  }
  if (el.querySelector(explicit ? CHROME_SELECTOR : KEEP_SELECTOR)) return false;
  if (visibleTextLength(el, maxText) > maxText) return false;
  return true;
}

/**
 * The `<aside>`, `<section>` or `role="list"` wrapper that holds a whole ad
 * unit, found by climbing from any part of it. This is what survives a rename:
 * the label, the class hashes and the link all change, the landmark does not.
 */
function unitRootFrom(anchor) {
  let found = null;
  // Starts at the anchor, which is often the landmark itself. A payload script
  // is skipped, or its own kilobytes of JSON would end the climb at once.
  let current = INERT_TAGS.has(tagOf(anchor)) ? anchor.parentElement : anchor;
  for (let depth = 0; current && depth < CARD_CLIMB_DEPTH; depth += 1) {
    if (isBoundary(current)) break;
    // Text only grows on the way up, so the first ancestor over budget ends it.
    if (visibleTextLength(current, MAX_UNIT_TEXT) > MAX_UNIT_TEXT) break;
    const role = current.getAttribute("role");
    const isUnit =
      UNIT_TAGS.has(tagOf(current)) || (role && UNIT_ROLES.has(role.trim()));
    if (isUnit && isSafeToHide(current, MAX_UNIT_TEXT, true)) found = current;
    current = current.parentElement;
  }
  return found;
}

/**
 * Walk up from a label or ad control to the card that wraps it. Pure wrapper
 * divs share the label's text so they are absorbed; an ancestor that adds
 * substantial sibling text is where the ad ends and the page begins.
 */
function cardFrom(anchor) {
  let best = isSafeToHide(anchor, MAX_CARD_TEXT) ? anchor : null;
  let bestLength = best ? visibleTextLength(best, MAX_CARD_TEXT) : 0;
  let current = anchor.parentElement;

  for (let depth = 0; current && depth < CARD_CLIMB_DEPTH; depth += 1) {
    if (isBoundary(current)) break;
    if (!isSafeToHide(current, MAX_CARD_TEXT)) break;
    const length = visibleTextLength(current, MAX_CARD_TEXT);
    if (best && length > CARD_GROWTH_FLOOR + bestLength * CARD_GROWTH_FACTOR) {
      break;
    }
    best = current;
    bestLength = length;
    current = current.parentElement;
  }
  return best;
}

/**
 * True when the reason says the element itself is marked as an ad, as opposed
 * to being the card inferred from a nearby label or control.
 */
function isExplicitReason(reason) {
  if (reason === "selector") return true;
  if (reason.startsWith("attr:") || reason.startsWith("unit:")) return true;
  return reason.startsWith("value:") && !LABEL_ATTRS.has(reason.slice(6));
}

function budgetFor(reason) {
  if (reason.startsWith("unit:")) return MAX_UNIT_TEXT;
  return isExplicitReason(reason) ? MAX_MARKED_TEXT : MAX_CARD_TEXT;
}

/**
 * Hide the wrappers a hidden ad leaves behind. A card sits in its own
 * `<section>`, and an empty flex child still contributes the thread's row gap.
 */
function collapseWrappers(el) {
  let parent = el.parentElement;
  for (let depth = 0; parent && depth < WRAPPER_COLLAPSE_DEPTH; depth += 1) {
    if (parent.childElementCount !== 1) return;
    if (visibleTextLength(parent, 0) > 0) return;
    if (!isSafeToHide(parent, MAX_MARKED_TEXT, true)) return;
    markHidden(parent, "wrapper");
    parent = parent.parentElement;
  }
}

function markHidden(el, reason) {
  el.classList.add(HIDDEN_CLASS);
  // Also inline, so a hidden ad does not depend on the stylesheet being parsed.
  if (el.style) el.style.setProperty("display", "none", "important");
  el.setAttribute(MARK_ATTR, "1");
  el.setAttribute(REASON_ATTR, reason);
  hiddenNodes.add(el);
  hiddenCount += 1;
  hiddenReasons.set(reason, (hiddenReasons.get(reason) || 0) + 1);
  queueStats();
}

function hideNode(el, reason) {
  if (!el || !el.hasAttribute || el.hasAttribute(MARK_ATTR)) return false;
  const explicit = isExplicitReason(reason);
  if (!isSafeToHide(el, budgetFor(reason), explicit)) return false;
  markHidden(el, reason);
  collapseWrappers(el);
  return true;
}

/**
 * Hide the ad around a label, control or tracking link. The landmark wrapper is
 * preferred over the measured card: it takes the "About this ad" panel and the
 * analytics payload with it, instead of leaving an empty frame behind.
 */
function hideAdAround(anchor, reason) {
  if (!anchor || !anchor.closest) return false;
  // Already inside something hidden: climbing again on every sweep is wasted.
  if (hiddenNodes.size > 0 && anchor.closest(`[${MARK_ATTR}]`)) return false;
  // An ad link or the word "Sponsored" inside the answer text is the model
  // talking about ads, so it stays.
  if (anchor.closest(ANSWER_BODY_SELECTOR)) return false;
  const unit = unitRootFrom(anchor);
  if (unit && hideNode(unit, `unit:${reason}`)) return true;
  const card = cardFrom(anchor);
  return card ? hideNode(card, reason) : false;
}

function unhideAll() {
  const nodes = new Set(hiddenNodes);
  for (const el of document.querySelectorAll(`[${MARK_ATTR}]`)) nodes.add(el);
  for (const el of nodes) {
    el.classList.remove(HIDDEN_CLASS);
    if (el.style) el.style.removeProperty("display");
    el.removeAttribute(MARK_ATTR);
    el.removeAttribute(REASON_ATTR);
  }
  hiddenNodes.clear();
  hiddenCount = 0;
  hiddenReasons.clear();
  examined = new WeakSet();
  queueStats();
}

/** HTML elements under root, crossing into open shadow roots. */
function elementsIn(root, out = [], budget = { left: MAX_NODES_PER_SWEEP }) {
  if (!root || !root.querySelectorAll) return out;
  if (root.nodeType === Node.ELEMENT_NODE && !STRUCTURAL_TAGS.has(tagOf(root))) {
    out.push(root);
  }
  for (const el of root.querySelectorAll("*")) {
    if (budget.left <= 0) break;
    if (el.namespaceURI && el.namespaceURI !== HTML_NS) continue;
    if (INERT_TAGS.has(tagOf(el))) continue;
    budget.left -= 1;
    out.push(el);
    if (el.shadowRoot) {
      observeRoot(el.shadowRoot);
      elementsIn(el.shadowRoot, out, budget);
    }
  }
  return out;
}

function sweep(root) {
  if (!enabled || !root) return;

  if (root.querySelectorAll) {
    for (const selector of CARD_SELECTORS) {
      let nodes;
      try {
        nodes = root.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const el of nodes) hideNode(el, "selector");
    }
    for (const selector of ANCHOR_SELECTORS) {
      let nodes;
      try {
        nodes = root.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const el of nodes) hideAdAround(el, "control");
    }
    sweepPayloads(root);
  }

  const skipHidden = hiddenNodes.size > 0;
  for (const el of elementsIn(root)) {
    if (examined.has(el) || el.hasAttribute(MARK_ATTR)) continue;
    if (skipHidden && el.closest(`[${MARK_ATTR}]`)) continue;
    examined.add(el);

    const match = adAttributeMatch(el);
    if (match) {
      if (match.expand) hideAdAround(el, match.reason);
      else hideNode(el, match.reason);
      continue;
    }
    if (isDisclosureLabel(el)) hideAdAround(el, "label");
  }
}

/**
 * ChatGPT ships each rendered ad with its own analytics JSON. That payload is
 * the most stable marker the unit has, and it is never traversed as an element,
 * so it gets its own pass.
 */
function sweepPayloads(root) {
  let nodes;
  try {
    nodes = root.querySelectorAll('script[type="application/json"]');
  } catch {
    return;
  }
  for (const script of nodes) {
    if (examined.has(script)) continue;
    examined.add(script);
    const head = (script.textContent || "").slice(0, MAX_PAYLOAD_SCAN);
    if (!AD_PAYLOAD_PATTERN.test(head)) continue;
    hideAdAround(script, "payload");
  }
}

/**
 * A sweep that cannot take the rest of the script down with it. The bootstrap
 * sweep runs before the listeners at the end of this file are registered, so an
 * exception on one odd element would otherwise leave the tab unfiltered for the
 * rest of its life.
 */
function safeSweep(root) {
  try {
    sweep(root);
  } catch {
    /* keep the observer and the timer alive */
  }
}

function scheduleSweep() {
  if (!enabled || sweepTimer) return;
  sweepTimer = window.setTimeout(() => {
    sweepTimer = 0;
    safeSweep(document.documentElement);
  }, 120);
}

function observeRoot(root) {
  if (!root || observedRoots.has(root)) return;
  observedRoots.add(root);
  const observer = new MutationObserver((mutations) => {
    if (!enabled) return;
    for (const mutation of mutations) {
      // Text or attributes may have turned a clean element into an ad label.
      examined.delete(
        mutation.type === "characterData"
          ? mutation.target.parentElement
          : mutation.target,
      );
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        safeSweep(node);
      }
    }
    scheduleSweep();
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  observers.add(observer);
}

function stopObserving() {
  for (const observer of observers) observer.disconnect();
  observers.clear();
  observedRoots = new WeakSet();
}

function queueStats() {
  if (statsTimer) return;
  statsTimer = window.setTimeout(() => {
    statsTimer = 0;
    try {
      chrome.storage.local.set({
        [KEY_STATS]: {
          count: hiddenCount,
          reasons: Object.fromEntries(hiddenReasons),
          ts: Date.now(),
          url: location.href,
        },
      });
    } catch {
      /* extension context invalidated after reload */
    }
  }, 400);
}

/**
 * Copy of the last assistant turn with media, scripts and long text stripped,
 * so an unblocked ad can be reported without leaking the conversation.
 */
function sanitizedTurn() {
  const turns = document.querySelectorAll(
    '[data-message-role="assistant"], .agent-turn, [data-testid^="conversation-turn"]',
  );
  const host =
    turns[turns.length - 1] ||
    document.querySelector("[data-conversation-transcript]");
  if (!host) return null;

  const clone = host.cloneNode(true);
  for (const el of clone.querySelectorAll(
    "script, style, svg, img, picture, video, canvas, iframe, noscript, template",
  )) {
    el.remove();
  }
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue && node.nodeValue.length > 120) {
      node.nodeValue = "[text removed]";
    }
    node = walker.nextNode();
  }
  return (clone.outerHTML || "").slice(0, 20000);
}

/**
 * Whether the stylesheet is actually live, checked by styling a throwaway node
 * the way a real ad unit is labelled. If this is false the extension is not
 * loaded in the tab (or was reloaded without refreshing it), which is worth
 * knowing before hunting for a missing selector.
 */
function cssActive() {
  try {
    const probe = document.createElement("div");
    probe.setAttribute("aria-label", "Sponsored");
    document.body.appendChild(probe);
    const hidden = getComputedStyle(probe).display === "none";
    probe.remove();
    return hidden;
  } catch {
    return null;
  }
}

/** Read-only scan used by the popup to capture the real ad markup. */
function runDiagnostics() {
  const items = [];
  const attributeNames = new Set();
  const adClassNames = new Set();
  const adLabels = new Set();
  const seen = new Set();

  const record = (el, reason) => {
    if (items.length >= 15 || seen.has(el)) return;
    seen.add(el);
    items.push({
      reason,
      tag: el.tagName.toLowerCase(),
      attrs: Array.from(el.attributes || [])
        .map((a) => `${a.name}="${String(a.value).slice(0, 120)}"`)
        .join(" "),
      text: visibleTextSample(el, 200),
      snippet: (el.outerHTML || "").slice(0, 700),
    });
  };

  for (const el of elementsIn(document.documentElement)) {
    // Raw matching here: the report should surface names the matcher skipped
    // on purpose, such as "data-ads-eligible".
    for (const attr of el.attributes || []) {
      if (hasRawAdToken(tokenize(attr.name, []))) attributeNames.add(attr.name);
    }
    for (const name of el.classList || []) {
      if (hasRawAdToken(classTokens(name))) adClassNames.add(name);
    }
    const label = el.getAttribute && el.getAttribute("aria-label");
    if (label && hasRawAdToken(tokenize(label, []))) adLabels.add(label);

    if (el.hasAttribute(MARK_ATTR)) {
      record(el, `hidden:${el.getAttribute(REASON_ATTR)}`);
      continue;
    }
    const match = adAttributeMatch(el);
    if (match) {
      record(el, `candidate:${match.reason}`);
      continue;
    }
    if (isDisclosureLabel(el)) record(el, "candidate:label");
  }

  for (const script of document.querySelectorAll(
    'script[type="application/json"]',
  )) {
    const head = (script.textContent || "").slice(0, MAX_PAYLOAD_SCAN);
    if (!AD_PAYLOAD_PATTERN.test(head)) continue;
    const unit = unitRootFrom(script) || script.parentElement;
    if (unit) record(unit, "candidate:payload");
  }

  const adResources = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((name) => /assistant-ads|ads-analytics|sponsor|advert/i.test(name))
    .slice(0, 20);

  return {
    ts: Date.now(),
    url: location.href,
    build: document.documentElement.dataset.build || null,
    renderer: document.documentElement.dataset.conversationRenderer || null,
    cssActive: cssActive(),
    enabled,
    hiddenCount,
    hiddenReasons: Object.fromEntries(hiddenReasons),
    adAttributeNames: Array.from(attributeNames).slice(0, 40),
    adClassNames: Array.from(adClassNames).slice(0, 40),
    adAriaLabels: Array.from(adLabels).slice(0, 20),
    adResources,
    items,
    lastAssistantTurn: sanitizedTurn(),
  };
}

function applyEnabled(on) {
  enabled = on;
  document.documentElement.classList.toggle(OFF_CLASS, !on);
  if (on) {
    observeRoot(document.documentElement);
    safeSweep(document.documentElement);
  } else {
    stopObserving();
    unhideAll();
  }
}

observeRoot(document.documentElement);
safeSweep(document.documentElement);

/**
 * One line in the page console once the DOM exists. An ad that is still visible
 * with no line here is not a missing selector: it is a tab that predates the
 * last extension reload, and no amount of selector work will fix it.
 */
function reportStatus() {
  try {
    const css = cssActive();
    console.info(
      `[AIEnabler] ad filter running - stylesheet ${
        css ? "on" : "OFF"
      }, hidden so far: ${hiddenCount}`,
    );
  } catch {
    /* console unavailable */
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", reportStatus, { once: true });
} else {
  reportStatus();
}

chrome.storage.local.get(KEY_ENABLED, (result) => {
  applyEnabled(result[KEY_ENABLED] !== false);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[KEY_ENABLED]) {
    applyEnabled(changes[KEY_ENABLED].newValue !== false);
  }
  if (changes[KEY_DIAG_REQUEST] && changes[KEY_DIAG_REQUEST].newValue) {
    try {
      chrome.storage.local.set({ [KEY_DIAG_RESULT]: runDiagnostics() });
    } catch {
      /* ignore */
    }
  }
});

// The lightweight renderer swaps large DOM regions on navigation and streaming,
// so re-sweep on its events plus a cheap timer.
for (const event of [
  "pageshow",
  "visibilitychange",
  "web-mobile-conversation-state-change",
  "web-mobile-conversation-state-settled",
  "web-mobile-safety-change",
  "web-mobile-conversation-control",
]) {
  document.addEventListener(event, scheduleSweep, true);
}
window.addEventListener("popstate", scheduleSweep);
window.setInterval(() => {
  if (document.visibilityState === "visible") scheduleSweep();
}, RESWEEP_INTERVAL_MS);
