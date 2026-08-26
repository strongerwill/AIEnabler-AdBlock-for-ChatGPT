# AIEnabler - AdBlock for ChatGPT

Chrome extension (Manifest V3) that hides sponsored ad cards around ChatGPT answers on `chatgpt.com` and `chat.openai.com`. It never rewrites or removes the model's answer.

Scope is deliberately narrow: ad chrome only. Plus/Go upsells, login banners, cookie notices, and unlabeled recommendations are left alone.

## Load unpacked

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder (`gpt-plugin`).
4. Open [chatgpt.com](https://chatgpt.com), ask something that normally shows an ad, and confirm the sponsored card is gone while the answer stays.

The toolbar popup toggles hiding, toggles ad-script blocking, shows how many elements were hidden on the last ChatGPT page, and can capture a diagnostics report. Everything is local; nothing is sent anywhere.

## How it works

Four independent layers, because ChatGPT ships hashed class names and renames its `data-*` attributes often:

1. **Network blocking** ([`background.js`](background.js)) drops the lazy ad module chunks the client imports (`assistant-ads-*.js`, `ads-analytics-*.js`) and `/ads/` requests, so the ad never mounts. On by default; see the caveat under [Ad-script blocking](#ad-script-blocking).
2. **CSS** ([`content/hide-ads.css`](content/hide-ads.css)) hides known ad markers at `document_start`, before any script runs, so there is no flicker. Its main hook is the accessible name: the served unit is `<aside aria-label=" Sponsored ">` with a `Sponsored options` menu button, so labels are matched as substrings, padding and all. `:has()` then takes the wrapper that holds nothing but that aside, and the ad creative is caught by its host (`bzrcdn.openai.com`). Hiding is the *default* state — rules are gated on `html:not(.gpt-ad-filter-off)`, so they still apply if the content script fails to load, and the popup's off switch is what adds the class.
3. **Attribute patterns** ([`content/hide-ads.js`](content/hide-ads.js)) match any element whose attribute *name* contains an ad token (`data-assistant-ads`, `data-ad-slot`, …) or whose `class`/`id`/`aria-label`/`data-testid` *value* contains one (`-ads-`, `sponsored`, `adCard`, `promoted`, …). This catches renamed attributes without a code change. Class hashes such as `_S47C4QYyCs` carry no tokens at all, which is why the layers below matter.
4. **Anchors: labels, controls, links, creatives and payload** — a short standalone label (`Sponsored`, `Ad`, `广告`, `スポンサー`, `광고`, …), an ad control, a click-through link through the ad server (`oppref=`, `olref=`, `utm_medium=paidaeo`), an image from the creative host, or the analytics JSON the renderer embeds beside every ad (`adsRequestId`, `adDataToken`). Any one of them is enough: the ad's landmark wrapper is found by climbing from the anchor, so the card, its `About this ad` panel and its empty frame all go together. Marked nodes also get an inline `display: none`, so script-side hiding does not depend on the stylesheet either.

Re-sweeping is resilient to the lightweight renderer, which swaps large DOM regions: a `MutationObserver` over child lists, attributes and text (including open shadow roots), the renderer's own events (`web-mobile-conversation-state-change`, `pageshow`, `popstate`, …), and a cheap 1.5s interval while the tab is visible. Elements already found clean are remembered and only re-checked when they mutate, so streaming a long answer stays cheap.

### Ad-script blocking

`declarativeNetRequest` rules block the ad chunks outright, which is the only layer that cannot be outrun by markup changes. The trade-off: ChatGPT's own module-recovery code reloads the tab when a dynamic import fails. Its session guard keys that on the build id, so it happens at most once per build per tab — but if you would rather never see a reload, turn **Block ad scripts** off in the popup and reload the tab. Cosmetic filtering keeps working either way.

### Safety guards

Nothing is hidden if it is, or contains, answer text (`[data-assistant-markdown]`, `[data-message-content]`, `.markdown`, `.prose`), the transcript, the composer, or page chrome (`main`, `nav`, `header`, `footer`, the sidebar, the `wm-app-*` shell). So a card is only removed when it is a self-contained sibling of the answer.

Every candidate also has to fit a text budget, from 800 characters for a card inferred from a label up to 2500 for an element the page named as an ad outright. Script and style contents are excluded from that measurement — the ad unit carries kilobytes of base64 in its own `<script type="application/json">`, and counting it made every real ad look like a page section.

The chrome list is kept deliberately narrow, because one entry appearing *anywhere inside* an ad makes that whole ad unhideable. `aside`, `dialog` and `header` were all on it at some point, and the served ad is an `<aside>` whose `About this ad` panel is a `<dialog>` containing a `<header>` — so the ad was the one thing on the page that could not be touched. Those tags are now refused only as the hide target itself; the sidebar is protected by name.

Deliberate exceptions:

- An element that carries an ad attribute *itself* may be a whole conversation turn, since ChatGPT renders some ad units as their own turn with a markdown body. Page chrome is still off limits and the budget still applies.
- Attribute names that only describe a capability (`data-ads-eligible`, `adsEnabled`, …) never match, because they mark containers that may host an ad rather than the ad.

An answer that mentions ads is safe: anything inside rendered message text is ignored by the label, link and payload heuristics, and prose is a hard boundary when climbing to the card. So an answer containing the word "Sponsored", or quoting an ad URL, keeps both.

## Still seeing an ad?

The ad markup differs by account, locale, and A/B bucket, so capture the real element:

1. Leave the ChatGPT tab open with the ad visible.
2. Open the extension popup and click **Scan open ChatGPT tab**.
3. Click **Copy report** and paste it back into the chat/issue.

The report contains the candidate elements' tags/attributes/HTML snippets, every ad-ish attribute name found in the page, which `assistant-ads-*` chunks the page loaded, and the build id — enough to add an exact selector.

Before any of that, open DevTools (F12) on the ChatGPT tab and look in the console for:

```text
[AIEnabler] ad filter running - stylesheet on, hidden so far: 2
```

That line is printed once per page load. **No line at all** means the content script never ran in that tab — usually a tab that was already open when the extension was loaded or reloaded on `chrome://extensions`. Reload the tab; no selector work can help until the line appears. `stylesheet OFF` means the script is running but its CSS is not applying, which points at the extension being disabled rather than at a missing selector. The same signal is in the diagnostics report as `cssActive`.

To tune it yourself, edit the top of [`content/hide-ads.js`](content/hide-ads.js):

- `CARD_SELECTORS` — exact ad containers, hidden as-is (fast path).
- `ANCHOR_SELECTORS` — ad labels, controls and click-through links; the ad around them is hidden, not just the anchor.
- `AD_TOKENS` / `VALUE_ATTRS` — the token vocabulary and which attribute values get tokenized.
- `DISCLOSURE_LABELS` — exact short label text, add your locale's wording here.
- `AD_LINK_PATTERN` / `AD_MEDIA_PATTERN` / `AD_PAYLOAD_PATTERN` — the ad server's link parameters, its creative host, and the keys of its embedded analytics JSON.
- `CHROME_SELECTOR` — page chrome. Adding a tag here that an ad can contain (`header`, `dialog`, `aside`, …) will silently make ads unhideable.
- `UNIT_TAGS` / `UNIT_ROLES` — the landmarks an ad unit is wrapped in, used to hide the whole card from any anchor inside it.

Mirror new attribute/class selectors in [`content/hide-ads.css`](content/hide-ads.css) so they are hidden before the observer runs. Never add a bare `ad` substring to CSS: `[class*="ad"]` would match ordinary words like `head`. Then click **Reload** on `chrome://extensions` and refresh ChatGPT.

## Known limits

- Ads injected **inside** the streamed answer with no disclosure label are not hidden; matching answer prose would risk deleting real content.
- With ad-script blocking on, ChatGPT may reload the tab once per build when it notices the blocked import.

## Privacy

No analytics, no remote code, no conversation upload. Host access is limited to ChatGPT, and `storage` holds only the two switches, the hidden counter, and the diagnostics report you explicitly request.

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE) (GPLv3).
