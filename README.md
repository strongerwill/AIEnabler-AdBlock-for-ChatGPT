# AIEnabler — AI Chat Exporter & Clean UI

Export AI chats (ChatGPT, Claude, Gemini, DeepSeek, etc.) & toggle UI elements
for a cleaner workspace.

AIEnabler is an open-source productivity tool for modern AI web interfaces. It
runs entirely in the browser: it never rewrites the model's answer and never
uploads the chat.

**Source:**
https://github.com/strongerwill/AIEnabler-BlockAds-and-ExportChats

## Key features

**Chat export.** Copy or print conversation content from ChatGPT, Claude,
Gemini, DeepSeek, Grok, Microsoft Copilot, Perplexity, Mistral Le Chat, Kimi,
Qwen, and Poe.

- **Copy Markdown** copies one assistant answer (the whole turn, not a fragment).
- **Copy table MD** / **Copy CSV** copy a table. CSV also carries a table flavor
  so spreadsheets paste real cells.
- **Copy keeping layout** / **Copy MD** copy a multi-line code block. Layout copy
  puts a monospace HTML flavor on the clipboard so ASCII diagrams stay aligned
  in Word or mail; editors still get the exact text. Single-line blocks have no
  toolbar.
- **Save PDF** sits beside **Copy Markdown** and prints that one answer in a
  clean view — choose **Save as PDF**.
- The popup copies the latest answer, and its **Print / save PDF** covers the
  whole thread rather than one answer.
- `Ctrl+Shift+M` copies the latest answer; `Ctrl+Shift+E` prints the thread.
  Change shortcuts at `chrome://extensions/shortcuts`.

Reference icons stay small in PDF and are omitted from Markdown. Diagrams drawn
as inline SVG (Mermaid flowcharts, for example) are inlined into the Markdown as
a data URI so the picture travels with the text.

Claude draws diagrams in a frame of its own origin, which the conversation
cannot read. A small script runs inside those frames and hands the drawing back
on request, so it reaches the export too — that is what the
`claudeusercontent.com` and `claudemcpcontent.com` access is for. A frame that
stays silent leaves a marked placeholder rather than disappearing.

**Element control & clean UI.** Optional toggle to hide non-essential UI
elements and ads for a distraction-free experience. Sponsored cards next to
ChatGPT answers are hidden; Plus/Go upsells, login banners, cookie notices, and
unlabeled recommendations are left alone. Ad hiding is ChatGPT-only — that is
where sponsored answer cards appear; the same heuristics would hide real UI on
the other sites.

- **Hide sponsored ads** in the popup is on by default (CSS + content script).
- **Block ad requests** is experimental and **off**. It only blocks creatives
  from the ad host; nothing on `chatgpt.com` is blocked, because earlier path
  rules could stall the conversation on **Unable to connect. Retry**.
- Answer text, the composer, the sidebar, auth sheets, and the Retry control
  are never hidden — including an answer that merely mentions ads.

**Privacy-first.** 100% client-side. No remote servers, no analytics, no
tracking.

**Open source.** GPLv3. Source code:
https://github.com/strongerwill/AIEnabler-BlockAds-and-ExportChats

## Using it

Reload the chat tab after installing or updating. Tools appear on hover under
an assistant answer, and under a table or a multi-line code block.

A fresh install grants every listed site up front, so nothing to click. Two
things take that access away: setting the extension to run **only when
clicked**, and an update that adds sites, which Chrome withholds until you
approve it. Either way the content script never runs and no toolbar appears,
so the toolbar icon shows a `!` badge.

Open the popup to fix it: it offers **Auto-run on all chat sites** (one prompt
covering every supported site) or **Enable on this site**. Granting access
injects into tabs that are already open, so no reload is needed.

The popup also reports whether the tools are connected to the current tab and
how many messages they see, and the page console prints
`[AIEnabler] export tools ready on <site>` once per load.

Site layouts change often. If a copy/export misses a turn, reload the tab; if
it still fails, send a note with the site name.

## Load unpacked

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder (`gpt-plugin`).
4. Reload the chat tab, then confirm the copy/export controls appear (and, on
   ChatGPT, that sponsored cards are hidden).

## How it works

Ad hiding (ChatGPT) uses CSS at `document_start`, then pattern matching on ad
tokens, labels, click-through links, and embedded ad payloads. See
[`content/hide-ads.js`](content/hide-ads.js) and
[`content/hide-ads.css`](content/hide-ads.css).

Export walks conversation turns in
[`content/export-tools.js`](content/export-tools.js), with per-site selectors in
[`content/sites.js`](content/sites.js). Markdown conversion and the print
document are both built in the tab; nothing is fetched to produce them.
[`content/frame-tools.js`](content/frame-tools.js) runs inside diagram frames
and answers a request for their drawing with `postMessage`; it starts nothing on
its own.

## Troubleshooting

**Unable to connect. Retry** on ChatGPT is a blocked conversation request, not
ad hiding. Turn **Block ad requests** off, reload the extension, then
hard-refresh. If it still happens with blocking off, it is not this extension.

**Temporarily experiencing issues** after a ChatGPT login prompt is OpenAI's
anonymous rate limit. Log in, or start a new chat later.

**Still seeing a ChatGPT ad?** Keep the tab open, use **Scan open ChatGPT tab**,
**Copy report**, and email
[davidadblocker@gmail.com](mailto:davidadblocker@gmail.com?subject=AIEnabler%20Feedback)
with subject **AIEnabler Feedback**. The console should show
`[AIEnabler] ad filter running` once per load; if it does not, reload the tab.

**Known limits:** ads with no disclosure *inside* streamed answer text are not
hidden. An unrecognized ad can flash before the sweep catches it. Other chat
sites are not scanned for ads.

## Privacy

No analytics, no remote code, no conversation upload. Host access is limited to
the chat sites listed above plus the two Claude frame domains that diagrams are
drawn in, and ad-host access is requested only if request blocking is on.
`storage` holds the two switches, a hidden-element count, and the diagnostics
report you ask for.

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE)
(GPLv3).
