(() => {
  if (window.top !== window || window.__AIENABLER_EXPORT_TOOLS__) return;
  window.__AIENABLER_EXPORT_TOOLS__ = true;

  const UI_ATTR = "data-aienabler-ui";
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const HIDDEN_SELECTOR =
    "[data-gpt-ad-filter], .gpt-ad-filter-hidden, [data-aienabler-ui]";
  const joinSelectors = (selectors) => (selectors || []).filter(Boolean).join(", ");
  const SITE = window.AIEnablerSites?.forHost(location.hostname) || null;
  const BODY_SELECTOR = joinSelectors(
    SITE?.body || [".markdown", ".prose", "[data-message-content]"],
  );
  const TURN_SELECTOR = joinSelectors(
    SITE?.turn || [
      "[data-message-role]",
      "[data-message-id]",
      "[data-testid^='conversation-turn']",
    ],
  );
  const ASSISTANT_SELECTOR = joinSelectors(SITE?.assistant);
  const USER_SELECTOR = joinSelectors(SITE?.user);
  /**
   * Reference chips and inline badges render at favicon size on the page, but
   * an export loses ChatGPT's stylesheet and falls back to the file's intrinsic
   * size, which is far larger. Anything at or below this box is treated as an
   * icon: dropped from Markdown, and pinned to its on-screen size when printed.
   */
  const ICON_MAX_PX = 32;
  /** Marks a frame the export could not read, so it leaves a visible trace. */
  const EMBED_ATTR = "data-aienabler-embed";
  /** Below this box a frame is a tracker or a helper, not part of the answer. */
  const EMBED_MIN_PX = 80;
  const FRAME_REQUEST = "aienabler-frame-request";
  const FRAME_REPLY = "aienabler-frame-reply";
  /** Long enough for a frame still drawing, short enough not to stall a copy. */
  const FRAME_REPLY_MS = 1500;
  /**
   * A diagram is inlined as a data URI so the Markdown file stands on its own.
   * Past this size the URI is longer than the text around it and unreadable in
   * an editor, so an oversized drawing is named rather than embedded.
   */
  const MAX_INLINE_SVG_CHARS = 400000;

  function cleanText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n");
  }

  function escapeMarkdown(value) {
    return cleanText(value).replace(/([\\`*_[\]<>])/g, "\\$1");
  }

  function normalizeMarkdown(value) {
    return cleanText(value)
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function inlineChildren(node, context) {
    return Array.from(node.childNodes)
      .map((child) => nodeToMarkdown(child, context))
      .join("");
  }

  function codeFence(text) {
    const matches = String(text).match(/`+/g) || [];
    const longest = matches.reduce((max, run) => Math.max(max, run.length), 2);
    return "`".repeat(Math.max(3, longest + 1));
  }

  /** The `<code>` holding the block's text, skipping ChatGPT's block header. */
  function codeElement(pre) {
    return pre.querySelector("code") || pre;
  }

  function codeLanguage(pre) {
    const code = codeElement(pre);
    return (
      Array.from(code.classList || [])
        .map((name) => name.match(/(?:language|lang)-([\w+-]+)/i)?.[1])
        .find(Boolean) || ""
    );
  }

  /**
   * Block text kept byte-for-byte apart from trailing blank lines: leading runs
   * of spaces are what hold ASCII diagrams together, so nothing here collapses
   * whitespace. Non-breaking spaces become ordinary ones because they survive a
   * paste as a different character.
   */
  function codeText(pre) {
    return String(codeElement(pre).textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n+$/, "");
  }

  function tableMatrix(table) {
    return Array.from(table.rows || []).map((row) =>
      Array.from(row.cells || []).map((cell) =>
        cleanText(cell.innerText || cell.textContent)
          .replace(/\s+/g, " ")
          .trim(),
      ),
    );
  }

  function tableToMarkdown(table) {
    const rows = tableMatrix(table);
    if (!rows.length) return "";
    const width = Math.max(...rows.map((row) => row.length));
    const padded = rows.map((row) =>
      Array.from({ length: width }, (_, index) =>
        (row[index] || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>"),
      ),
    );
    const header = padded[0];
    const divider = Array.from({ length: width }, () => "---");
    return [
      `| ${header.join(" | ")} |`,
      `| ${divider.join(" | ")} |`,
      ...padded.slice(1).map((row) => `| ${row.join(" | ")} |`),
    ].join("\n");
  }

  function tableToCsv(table) {
    return tableMatrix(table)
      .map((row) =>
        row
          .map((value) => {
            const escaped = value.replace(/"/g, '""');
            return /[",\r\n]/.test(value) ? `"${escaped}"` : escaped;
          })
          .join(","),
      )
      .join("\r\n");
  }

  function listToMarkdown(list, context) {
    const ordered = list.tagName === "OL";
    const start = Number(list.getAttribute("start")) || 1;
    const lines = [];
    let index = 0;
    for (const item of Array.from(list.children)) {
      if (item.tagName !== "LI") continue;
      const nestedLists = Array.from(item.children).filter((child) =>
        /^(UL|OL)$/.test(child.tagName),
      );
      const clone = item.cloneNode(true);
      for (const nested of clone.querySelectorAll(":scope > ul, :scope > ol")) {
        nested.remove();
      }
      const marker = ordered ? `${start + index}. ` : "- ";
      const own = normalizeMarkdown(inlineChildren(clone, context));
      lines.push(`${"  ".repeat(context.listDepth)}${marker}${own}`);
      for (const nested of nestedLists) {
        lines.push(
          listToMarkdown(nested, {
            ...context,
            listDepth: context.listDepth + 1,
          }),
        );
      }
      index += 1;
    }
    return `${lines.join("\n")}\n\n`;
  }

  /** btoa handles bytes, not text, so the markup is encoded to UTF-8 first. */
  function base64Utf8(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  /**
   * Standalone markup for a diagram that was drawn as part of the page: it
   * inherits its size and colours from a stylesheet the export will not have,
   * so both are written onto the copy.
   */
  function svgMarkup(svg) {
    const { width, height } = stampedBox(svg);
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!clone.getAttribute("viewBox") && width && height) {
      clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }
    if (width) clone.setAttribute("width", String(width));
    if (height) clone.setAttribute("height", String(height));
    for (const script of clone.querySelectorAll("script")) script.remove();
    for (const element of [clone, ...clone.querySelectorAll("*")]) {
      for (const attribute of Array.from(element.attributes || [])) {
        if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      }
    }
    return new XMLSerializer().serializeToString(clone);
  }

  /**
   * Stays inline: a reference chip is an icon and a word inside one link, so a
   * blank line here would split `[text](url)` down the middle and leave the
   * closing half stranded in the output.
   */
  function svgToMarkdown(svg) {
    // Icon-sized vectors are bullets, arrows and logos, and only add noise. The
    // box is read from the attributes stamped while cloning, because by now the
    // node is detached and would measure zero.
    if (isIconImage(svg)) return "";
    let markup = "";
    try {
      markup = svgMarkup(svg);
    } catch {
      markup = "";
    }
    if (!markup || markup.length > MAX_INLINE_SVG_CHARS) {
      return "*[Diagram, viewable only in the page]*";
    }
    const alt = cleanText(svg.getAttribute("aria-label") || "") || "diagram";
    return `![${alt}](data:image/svg+xml;base64,${base64Utf8(markup)})`;
  }

  function nodeToMarkdown(node, context = { listDepth: 0 }) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return escapeMarkdown(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (node.matches(HIDDEN_SELECTOR)) return "";
    if (node.hasAttribute?.(EMBED_ATTR)) {
      return `\n\n*[${cleanText(node.textContent)}]*\n\n`;
    }
    // SVG lives in its own namespace, so the HTML rules below do not apply to
    // it. A diagram is worth carrying over; the rest of the namespace is not.
    if (node.namespaceURI && node.namespaceURI !== HTML_NS) {
      return node.localName === "svg" ? svgToMarkdown(node) : "";
    }

    const tag = node.tagName;
    if (/^H[1-6]$/.test(tag)) {
      return `\n\n${"#".repeat(Number(tag[1]))} ${normalizeMarkdown(
        inlineChildren(node, context),
      )}\n\n`;
    }
    if (tag === "BR") return "  \n";
    if (tag === "HR") return "\n\n---\n\n";
    if (tag === "STRONG" || tag === "B") {
      return `**${inlineChildren(node, context)}**`;
    }
    if (tag === "EM" || tag === "I") {
      return `*${inlineChildren(node, context)}*`;
    }
    if (tag === "S" || tag === "DEL" || tag === "STRIKE") {
      return `~~${inlineChildren(node, context)}~~`;
    }
    if (tag === "A") {
      const text = normalizeMarkdown(inlineChildren(node, context)) || node.href;
      return node.href ? `[${text}](${node.href})` : text;
    }
    if (tag === "IMG") {
      if (isIconImage(node)) return "";
      const alt = escapeMarkdown(node.getAttribute("alt") || "image");
      const src = node.getAttribute("src") || "";
      return src ? `![${alt}](${src})` : "";
    }
    if (tag === "CODE" && node.parentElement?.tagName !== "PRE") {
      const text = cleanText(node.textContent).trim();
      const fence = "`".repeat(
        Math.max(1, Math.max(0, ...(text.match(/`+/g) || []).map((x) => x.length)) + 1),
      );
      return `${fence}${text}${fence}`;
    }
    if (tag === "PRE") {
      const text = codeText(node);
      const fence = codeFence(text);
      return `\n\n${fence}${codeLanguage(node)}\n${text}\n${fence}\n\n`;
    }
    if (tag === "BLOCKQUOTE") {
      const text = normalizeMarkdown(inlineChildren(node, context));
      return `\n\n${text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    }
    if (tag === "UL" || tag === "OL") return listToMarkdown(node, context);
    if (tag === "TABLE") return `\n\n${tableToMarkdown(node)}\n\n`;
    if (tag === "LI") return inlineChildren(node, context);

    const content = inlineChildren(node, context);
    if (
      /^(P|DIV|SECTION|ARTICLE|MAIN|ASIDE|FIGURE|FIGCAPTION|DETAILS|SUMMARY|DL|DT|DD)$/.test(
        tag,
      )
    ) {
      return `\n\n${content}\n\n`;
    }
    return content;
  }

  function looksLikeRole(text, kind) {
    const value = String(text || "").toLowerCase();
    if (kind === "assistant") {
      return /\b(assistant|model|bot|claude|gemini|grok|deepseek|copilot|ai)\b/.test(
        value,
      );
    }
    return /\b(user|human|prompt|query|you)\b/.test(value);
  }

  function elementRole(element) {
    const host = element.closest(TURN_SELECTOR);
    const value = [
      host?.getAttribute("data-message-role"),
      host?.getAttribute("data-message-author-role"),
      host?.getAttribute("data-turn"),
      host?.getAttribute("data-content"),
      element.getAttribute("data-message-role"),
      element.getAttribute("data-message-author-role"),
      element.getAttribute("data-content"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (looksLikeRole(value, "assistant")) return "assistant";
    if (looksLikeRole(value, "user")) return "user";
    if (
      ASSISTANT_SELECTOR &&
      (element.matches(ASSISTANT_SELECTOR) || host?.matches(ASSISTANT_SELECTOR))
    ) {
      return "assistant";
    }
    if (
      USER_SELECTOR &&
      (element.matches(USER_SELECTOR) || host?.matches(USER_SELECTOR))
    ) {
      return "user";
    }
    const tagged = `${element.tagName} ${host?.tagName || ""}`.toLowerCase();
    if (tagged.includes("model-response") || tagged.includes("message-content")) {
      return "assistant";
    }
    if (tagged.includes("user-query")) return "user";
    const classBlob = `${element.className || ""} ${host?.className || ""}`;
    if (looksLikeRole(classBlob, "assistant")) return "assistant";
    if (looksLikeRole(classBlob, "user")) return "user";
    if (
      element.matches(
        ".markdown, .prose, .ds-markdown, .markdown-body, .standard-markdown, message-content",
      )
    ) {
      return "assistant";
    }
    return null;
  }

  /**
   * One entry per conversation turn, holding every body that turn renders.
   * ChatGPT splits a single answer across several matching containers, so a
   * per-body view would copy only the last fragment of the reply.
   */
  function messageGroups() {
    const groups = [];
    const byTurn = new Map();
    if (!BODY_SELECTOR) return groups;
    for (const body of document.querySelectorAll(BODY_SELECTOR)) {
      if (body.closest(`[${UI_ATTR}]`) || body.closest(HIDDEN_SELECTOR)) continue;
      // Keep the innermost container only: an outer wrapper that also matches
      // would otherwise repeat the same text in the export.
      if (body.querySelector(BODY_SELECTOR)) continue;
      const role = elementRole(body);
      if (!role) continue;
      const turn = body.closest(TURN_SELECTOR) || body;
      const group = byTurn.get(turn);
      if (group) {
        group.bodies.push(body);
        continue;
      }
      const created = { role, turn, bodies: [body] };
      byTurn.set(turn, created);
      groups.push(created);
    }
    for (const group of groups) addTurnEmbeds(group);
    return groups;
  }

  /**
   * A diagram can be rendered in a frame that sits beside the text container
   * rather than inside it, and only the innermost text container is exported -
   * so the picture would fall outside the export entirely, with not even a gap
   * to show for it. Any answer-sized frame elsewhere in the turn is folded in,
   * then the parts are put back into the order they appear on the page.
   */
  function addTurnEmbeds(group) {
    if (group.turn === group.bodies[0]) return;
    for (const frame of group.turn.querySelectorAll("iframe")) {
      const { width, height } = renderedBox(frame);
      if (width < EMBED_MIN_PX || height < EMBED_MIN_PX) continue;
      if (group.bodies.some((body) => body.contains(frame))) continue;
      group.bodies.push(frame);
    }
    group.bodies.sort(inDocumentOrder);
  }

  function inDocumentOrder(left, right) {
    const position = left.compareDocumentPosition(right);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  /** The element itself counts too, since a body can be the frame in question. */
  function selfAndDescendants(root, selector) {
    const found = Array.from(root.querySelectorAll(selector));
    if (root.matches?.(selector)) found.unshift(root);
    return found;
  }

  function latestAssistantGroup() {
    return messageGroups().filter(({ role }) => role === "assistant").at(-1) || null;
  }

  /** On-screen box of an element, falling back to an image's intrinsic size. */
  function renderedBox(element) {
    const rect = element?.getBoundingClientRect?.();
    const width = Math.round(rect?.width || element?.naturalWidth || 0);
    const height = Math.round(rect?.height || element?.naturalHeight || 0);
    return { width, height };
  }

  /**
   * The on-screen box recorded while cloning. Markdown is built from a detached
   * clone, where measuring gives zero, so the size has to be read back from the
   * attributes rather than taken again.
   */
  function stampedBox(element) {
    return {
      width: Number(element.dataset?.aienablerWidth) || 0,
      height: Number(element.dataset?.aienablerHeight) || 0,
    };
  }

  function isIconImage(element) {
    const { width, height } = stampedBox(element);
    return width > 0 && height > 0 && width <= ICON_MAX_PX && height <= ICON_MAX_PX;
  }

  /** Drawings collected from frames, keyed by the frame that produced them. */
  const framePayloads = new WeakMap();
  let frameRequests = 0;

  /** Asks one frame for its drawing, giving up rather than blocking forever. */
  function askFrame(frame) {
    return new Promise((resolve) => {
      const id = `aienabler-${(frameRequests += 1)}`;
      let timer = 0;
      const stop = (payload) => {
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(payload);
      };
      const onMessage = (event) => {
        const reply = event.data;
        if (!reply || reply.type !== FRAME_REPLY || reply.id !== id) return;
        // Any frame on the page can post a message, so only the one that was
        // asked is allowed to answer for itself.
        if (event.source !== frame.contentWindow) return;
        stop(reply.payload || null);
      };
      window.addEventListener("message", onMessage);
      timer = window.setTimeout(() => stop(null), FRAME_REPLY_MS);
      try {
        frame.contentWindow?.postMessage({ type: FRAME_REQUEST, id }, "*");
      } catch {
        stop(null);
      }
    });
  }

  /**
   * Asks the worker to put the reader script into this tab's frames. A frame
   * that was already loaded when access to its domain was granted never got the
   * script and would stay silent until the page is reloaded; this is what saves
   * the reload.
   */
  function requestFrameReader() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: "aienabler-inject-frames" },
          (response) => {
            void chrome.runtime.lastError;
            resolve(Boolean(response?.ok));
          },
        );
      } catch {
        resolve(false);
      }
    });
  }

  /** Collects drawings from every answer-sized frame, all frames at once. */
  async function resolveFrames(bodies) {
    const pending = [];
    for (const body of bodies) {
      for (const frame of selfAndDescendants(body, "iframe")) {
        const { width, height } = renderedBox(frame);
        if (width < EMBED_MIN_PX || height < EMBED_MIN_PX) continue;
        if (framePayloads.has(frame) || pending.includes(frame)) continue;
        pending.push(frame);
      }
    }
    if (!pending.length) return;
    let payloads = await Promise.all(pending.map(askFrame));
    // Silence usually means the frame loaded before its domain was granted and
    // so never received the reader. Placing it now avoids a page reload.
    if (payloads.some((payload) => !payload) && (await requestFrameReader())) {
      const retried = await Promise.all(
        pending.map((frame, index) =>
          payloads[index] ? null : askFrame(frame),
        ),
      );
      payloads = payloads.map((payload, index) => payload || retried[index]);
    }
    payloads.forEach((payload, index) => {
      if (payload) framePayloads.set(pending[index], payload);
    });
  }

  /** Rebuilds an SVG from the markup a frame sent over as text. */
  function parseFrameSvg(markup) {
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    if (parsed.querySelector("parsererror")) return null;
    const svg = parsed.documentElement;
    return svg && svg.localName === "svg"
      ? document.importNode(svg, true)
      : null;
  }

  /** The drawing a frame handed over, as an element the export understands. */
  function frameElement(payload) {
    if (payload?.kind === "svg" && payload.markup) {
      return parseFrameSvg(payload.markup);
    }
    if (payload?.kind === "png" && payload.dataUrl) {
      const image = document.createElement("img");
      image.src = payload.dataUrl;
      if (payload.width) image.width = payload.width;
      if (payload.height) image.height = payload.height;
      return image;
    }
    return null;
  }

  function cleanClone(body) {
    // Wrapped rather than used bare, so a body that is itself a frame can be
    // swapped for the drawing it holds like any other node would be.
    const clone = document.createElement("div");
    clone.appendChild(body.cloneNode(true));
    const originalMedia = selfAndDescendants(body, "img, svg");
    for (const [index, media] of Array.from(
      clone.querySelectorAll("img, svg"),
    ).entries()) {
      const source = originalMedia[index];
      const { width, height } = renderedBox(source);
      media.dataset.aienablerWidth = String(width);
      media.dataset.aienablerHeight = String(height);
    }
    // A frame's document belongs to another origin, so its drawing has to be
    // collected beforehand by the script running inside it. What came back
    // takes the frame's place; a frame that said nothing leaves a note instead
    // of vanishing unexplained. Tiny frames are trackers and helpers, and go.
    const originalFrames = selfAndDescendants(body, "iframe");
    for (const [index, frame] of Array.from(
      clone.querySelectorAll("iframe"),
    ).entries()) {
      const source = originalFrames[index];
      const { width, height } = renderedBox(source);
      if (width < EMBED_MIN_PX || height < EMBED_MIN_PX) {
        frame.remove();
        continue;
      }
      const payload = framePayloads.get(source);
      const drawing = payload ? frameElement(payload) : null;
      if (drawing) {
        frame.replaceWith(drawing);
        continue;
      }
      const note = document.createElement("div");
      note.setAttribute(EMBED_ATTR, "1");
      note.textContent = "Embedded content, viewable only in the page";
      frame.replaceWith(note);
    }
    // Buttons are page chrome - copy, edit, feedback - except when a site wraps
    // a figure in one to make it open full screen. Those are unwrapped, because
    // dropping them takes the diagram or picture with them.
    for (const button of clone.querySelectorAll("button")) {
      if (button.querySelector("img, svg, canvas, table, pre")) {
        button.replaceWith(...button.childNodes);
      } else {
        button.remove();
      }
    }
    for (const element of clone.querySelectorAll(
      `${HIDDEN_SELECTOR}, script, object, embed, template, form`,
    )) {
      element.remove();
    }
    // Page stylesheets have no business in an export, but an inline diagram
    // carries its own <style> and renders as blank shapes without it.
    for (const style of clone.querySelectorAll("style")) {
      if (style.namespaceURI === HTML_NS) style.remove();
    }
    for (const element of [clone, ...clone.querySelectorAll("*")]) {
      for (const attribute of Array.from(element.attributes || [])) {
        if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      }
      const href = element.getAttribute?.("href");
      if (href && /^\s*javascript:/i.test(href)) element.removeAttribute("href");
    }
    return clone;
  }

  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.cssText = "position:fixed;left:-9999px;top:0";
      document.documentElement.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      if (!copied) throw new Error("Clipboard access was denied.");
    }
  }

  /**
   * Writes the same content twice: plain text for editors and terminals, and an
   * HTML flavor for rich-text targets. Word, Outlook and the like re-flow a
   * plain-text paste in a proportional font, which is what breaks the alignment
   * of ASCII diagrams; the HTML flavor pins them to a monospace `pre` instead.
   * Falls back to plain text wherever `ClipboardItem` is unavailable.
   */
  async function writeRichClipboard(text, html) {
    if (navigator.clipboard?.write && typeof ClipboardItem === "function") {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
        return;
      } catch {
        /* Fall through to the plain-text path below. */
      }
    }
    await writeClipboard(text);
  }

  function codeBlockHtml(text) {
    return `<pre style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace;font-size:12px;line-height:1.45;white-space:pre;tab-size:4;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:12px">${escapeHtml(
      text,
    )}</pre>`;
  }

  function tableHtml(table) {
    const rows = tableMatrix(table)
      .map((row, rowIndex) => {
        const tag = rowIndex === 0 ? "th" : "td";
        const cells = row
          .map(
            (value) =>
              `<${tag} style="border:1px solid #bbb;padding:4px 8px;text-align:left">${escapeHtml(
                value,
              )}</${tag}>`,
          )
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");
    return `<table style="border-collapse:collapse">${rows}</table>`;
  }

  function flashButton(button, label) {
    const previous = button.textContent;
    button.textContent = label;
    window.setTimeout(() => {
      button.textContent = previous;
    }, 1200);
  }

  async function copyGroupMarkdown(group) {
    await resolveFrames(group.bodies);
    const markdown = groupMarkdown(group);
    if (!markdown) throw new Error("No answer content was found.");
    await writeClipboard(markdown);
    return markdown;
  }

  function groupMarkdown(group) {
    return normalizeMarkdown(
      group.bodies
        .map((body) => normalizeMarkdown(nodeToMarkdown(cleanClone(body))))
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  function makeButton(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await handler(button);
      } catch (error) {
        console.warn("[AIEnabler] export action failed", error);
        flashButton(button, "Failed");
      }
    });
    return button;
  }

  /** One toolbar per turn, so a turn rendered in several parts keeps just one. */
  const turnToolbars = new WeakMap();

  /**
   * Re-read on click rather than captured at install time, because streaming
   * keeps adding bodies to a turn after its toolbar is in place.
   */
  function currentGroup(group) {
    return (
      messageGroups().find((candidate) => candidate.turn === group.turn) || group
    );
  }

  function installMessageTools(group) {
    const anchor = group.bodies.at(-1);
    if (!anchor) return;
    let tools = turnToolbars.get(group.turn);
    if (!tools) {
      tools = document.createElement("div");
      tools.className = "aienabler-tools";
      tools.setAttribute(UI_ATTR, "message");
      tools.append(
        makeButton("Copy Markdown", async (button) => {
          await copyGroupMarkdown(currentGroup(group));
          flashButton(button, "Copied");
        }),
        makeButton("Save PDF", async (button) => {
          flashButton(button, "Opening\u2026");
          await printConversation([currentGroup(group)]);
        }),
      );
      turnToolbars.set(group.turn, tools);
    }
    const host = anchor.parentElement || anchor;
    host.classList.add("aienabler-export-host");
    // Streaming appends further bodies below an installed toolbar. Moving it
    // only when the newest body sits after it keeps it at the end of the answer
    // without the mutation it causes triggering another move.
    const stranded =
      tools.isConnected &&
      Boolean(
        tools.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    if (!tools.isConnected || stranded) {
      anchor.insertAdjacentElement("afterend", tools);
    }
  }

  /**
   * Chat sites wrap tables and code blocks in horizontally scrolling
   * containers. A toolbar placed directly after the element would sit inside
   * that scroller and could require scrolling to reach, so it is attached after
   * the outermost wrapper that holds nothing else. Stops at the message body.
   */
  function toolbarAnchor(element) {
    let anchor = element;
    for (let depth = 0; depth < 3; depth += 1) {
      const parent = anchor.parentElement;
      if (!parent || parent.children.length !== 1) break;
      if (parent.matches(BODY_SELECTOR) || parent.matches(TURN_SELECTOR)) break;
      anchor = parent;
    }
    return anchor;
  }

  /**
   * Puts a toolbar below its block. Coming after the wrapper in the DOM is not
   * enough on its own, because a wrapper is free to paint its children in
   * another order - a reversed flex column, or a grid that places them. So the
   * result is checked against the rendered boxes, and only a toolbar that ends
   * up wholly above its block is flipped to the other side of the wrapper,
   * which is where such a container paints it last.
   */
  function placeToolbarBelow(block, tools) {
    const anchor = toolbarAnchor(block);
    anchor.insertAdjacentElement("afterend", tools);
    const blockBox = block.getBoundingClientRect();
    const toolsBox = tools.getBoundingClientRect();
    // Zero boxes mean nothing is laid out yet (a collapsed block, a hidden
    // tab), and there is no position to judge.
    if (!blockBox.height || !toolsBox.height) return;
    if (toolsBox.bottom <= blockBox.top + 1) {
      anchor.insertAdjacentElement("beforebegin", tools);
    }
  }

  function installTableTools(table) {
    if (table.dataset.aienablerTableReady === "1") return;
    table.dataset.aienablerTableReady = "1";
    const tools = document.createElement("div");
    tools.className = "aienabler-tools aienabler-table-tools";
    tools.setAttribute(UI_ATTR, "table");
    tools.append(
      makeButton("Copy table MD", async (button) => {
        await writeClipboard(tableToMarkdown(table));
        flashButton(button, "Copied");
      }),
      makeButton("Copy CSV", async (button) => {
        // The HTML flavor lets spreadsheets paste real cells instead of one
        // column of raw CSV, while text editors still receive the CSV.
        await writeRichClipboard(tableToCsv(table), tableHtml(table));
        flashButton(button, "Copied");
      }),
    );
    placeToolbarBelow(table, tools);
  }

  function installCodeTools(pre) {
    if (pre.dataset.aienablerCodeReady === "1") return;
    // Only the outermost block gets a toolbar: ChatGPT sometimes nests a `pre`
    // inside another one, which would otherwise stack a second pair of buttons.
    if (pre.parentElement?.closest("pre")) return;
    const text = codeText(pre);
    // A single line cannot lose its alignment when pasted, so a toolbar there
    // is noise. The flag is set only once a block qualifies, so a block still
    // streaming in is re-checked as it grows.
    if (!text.trim() || !text.includes("\n")) return;
    pre.dataset.aienablerCodeReady = "1";
    const tools = document.createElement("div");
    tools.className = "aienabler-tools aienabler-code-tools";
    tools.setAttribute(UI_ATTR, "code");
    tools.append(
      makeButton("Copy keeping layout", async (button) => {
        const text = codeText(pre);
        await writeRichClipboard(text, codeBlockHtml(text));
        flashButton(button, "Copied");
      }),
      makeButton("Copy MD", async (button) => {
        const text = codeText(pre);
        const fence = codeFence(text);
        await writeClipboard(
          `${fence}${codeLanguage(pre)}\n${text}\n${fence}`,
        );
        flashButton(button, "Copied");
      }),
    );
    placeToolbarBelow(pre, tools);
  }

  function installInlineTools() {
    for (const group of messageGroups()) {
      if (group.role === "assistant") installMessageTools(group);
      for (const body of group.bodies) {
        for (const table of body.querySelectorAll("table")) installTableTools(table);
        for (const pre of body.querySelectorAll("pre")) installCodeTools(pre);
      }
    }
  }

  let toolTimer = 0;
  function scheduleInlineTools() {
    if (toolTimer) return;
    toolTimer = window.setTimeout(() => {
      toolTimer = 0;
      installInlineTools();
    }, 180);
  }

  function fileSafeTitle() {
    const fallback = SITE ? `${SITE.label} conversation` : "AI conversation";
    const stripped = SITE?.titleStrip
      ? document.title.replace(SITE.titleStrip, "")
      : document.title;
    const raw =
      document.querySelector("main h1")?.textContent || stripped || fallback;
    return (
      raw
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/[.\s]+$/g, "")
        .slice(0, 90) || fallback
    );
  }

  /**
   * The print document has none of ChatGPT's styling, so media falls back to
   * its intrinsic size - which turns favicon-sized reference chips into
   * full-width images. Carrying the on-screen box over as attributes keeps
   * every image the size the reader saw.
   */
  function applyRenderedSizes(clone) {
    for (const media of clone.querySelectorAll("img, svg")) {
      const width = Number(media.dataset.aienablerWidth) || 0;
      const height = Number(media.dataset.aienablerHeight) || 0;
      if (width > 0) media.setAttribute("width", String(width));
      if (height > 0) media.setAttribute("height", String(height));
      if (isIconImage(media)) media.classList.add("aienabler-icon");
      delete media.dataset.aienablerWidth;
      delete media.dataset.aienablerHeight;
    }
  }

  /** Prints the given turns, or the whole thread when none are named. */
  async function printConversation(groups = messageGroups()) {
    if (!groups.length) throw new Error("No conversation content was found.");
    await resolveFrames(groups.flatMap(({ bodies }) => bodies));
    const frame = document.createElement("iframe");
    frame.setAttribute(UI_ATTR, "print");
    frame.style.cssText =
      "position:fixed;width:1px;height:1px;right:0;bottom:0;border:0;opacity:0";
    document.documentElement.appendChild(frame);
    const rows = groups
      .map(({ role, bodies }) => {
        const content = bodies
          .map((body) => {
            const clone = cleanClone(body);
            applyRenderedSizes(clone);
            return clone.innerHTML;
          })
          .join("");
        return `<section class="message"><h2>${
          role === "user" ? "User" : "Assistant"
        }</h2><div class="content">${content}</div></section>`;
      })
      .join("");
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${fileSafeTitle()}</title>
      <style>
        @page { margin: 16mm; }
        body { color: #111; font: 11pt/1.55 system-ui, sans-serif; margin: 0 auto; max-width: 850px; }
        h1 { font-size: 20pt; margin: 0 0 5mm; }
        h2 { font-size: 11pt; color: #666; margin: 0 0 3mm; break-after: avoid; }
        /* An answer runs as long as it needs to and simply flows onto the next
           page. Keeping a turn whole would push anything taller than the space
           left under the title onto page two, leaving page one nearly blank. */
        .message { border-top: 1px solid #ddd; padding: 5mm 0; }
        .message:first-of-type { border-top: 0; padding-top: 0; }
        .message:last-of-type { padding-bottom: 0; }
        p { orphans: 2; widows: 2; }
        /* Wraps only at existing spaces, and small enough that a wide ASCII
           diagram fits a line: breaking mid-run would misalign the drawing. */
        pre { white-space: pre-wrap; overflow-wrap: normal; word-break: normal;
              font-size: 9pt; line-height: 1.35; background: #f5f5f5; padding: 3mm; }
        code { font-family: ui-monospace, monospace; }
        img, svg { max-width: 100%; height: auto; break-inside: avoid; }
        .aienabler-icon { width: auto; max-height: 1.1em; vertical-align: text-bottom; }
        table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #bbb; padding: 2mm; text-align: left; }
        thead { display: table-header-group; } tr { break-inside: avoid; }
        [${EMBED_ATTR}] { border: 1px dashed #bbb; color: #666; font-size: 9pt;
                          padding: 4mm; text-align: center; }
        a { color: inherit; overflow-wrap: anywhere; }
      </style></head><body><h1>${escapeHtml(fileSafeTitle())}</h1>${rows}</body></html>`);
    doc.close();
    window.setTimeout(async () => {
      const images = Array.from(doc.images);
      const loaded = Promise.allSettled(
        images.map(
          (image) =>
            new Promise((resolve) => {
              if (image.complete) {
                resolve();
                return;
              }
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
            }),
        ),
      );
      await Promise.race([
        loaded,
        new Promise((resolve) => window.setTimeout(resolve, 3000)),
      ]);
      frame.contentWindow.focus();
      frame.contentWindow.print();
      window.setTimeout(() => frame.remove(), 60_000);
    }, 500);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function runAction(action) {
    if (
      action === "copy-latest-markdown" ||
      action === "get-latest-markdown"
    ) {
      const group = latestAssistantGroup();
      if (!group) throw new Error("No assistant answer was found.");
      if (action === "get-latest-markdown") {
        await resolveFrames(group.bodies);
        const markdown = groupMarkdown(group);
        if (!markdown) throw new Error("No answer content was found.");
        return { markdown };
      }
      await copyGroupMarkdown(group);
      return { copied: true };
    }
    if (action === "print-conversation") {
      await printConversation();
      return { printing: true };
    }
    if (action === "status") {
      installInlineTools();
      const groups = messageGroups();
      // Asking the frames as well, so the report separates "no diagram found in
      // the answer" from "found one, but its frame never answered".
      const allBodies = groups.flatMap(({ bodies }) => bodies);
      const frames = allBodies
        .flatMap((body) => selfAndDescendants(body, "iframe"))
        .filter((frame) => {
          const { width, height } = renderedBox(frame);
          return width >= EMBED_MIN_PX && height >= EMBED_MIN_PX;
        });
      await resolveFrames(allBodies);
      return {
        frames: frames.length,
        framesRead: frames.filter((frame) => framePayloads.has(frame)).length,
        site: SITE?.label || null,
        host: location.hostname,
        messages: groups.length,
        assistantMessages: groups.filter(({ role }) => role === "assistant").length,
        toolbars: document.querySelectorAll(`[${UI_ATTR}]`).length,
        bodyMatches: BODY_SELECTOR
          ? document.querySelectorAll(BODY_SELECTOR).length
          : 0,
      };
    }
    throw new Error("Unknown export action.");
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "aienabler-export") return undefined;
    runAction(message.action)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  const observer = new MutationObserver(scheduleInlineTools);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installInlineTools, { once: true });
  } else {
    installInlineTools();
  }

  /**
   * These apps render the thread well after load and swap it wholesale when a
   * conversation is opened from the sidebar. A mutation can also land while a
   * turn is still half-built, so a cheap periodic pass while the tab is visible
   * is what makes the buttons appear without a manual reload.
   */
  window.setInterval(() => {
    if (document.visibilityState === "visible") scheduleInlineTools();
  }, 1500);

  try {
    console.info(
      `[AIEnabler] export tools ready on ${SITE?.label || location.hostname}`,
    );
  } catch {
    /* console unavailable */
  }

  for (const event of [
    "pageshow",
    "popstate",
    "web-mobile-conversation-state-change",
    "web-mobile-conversation-state-settled",
  ]) {
    window.addEventListener(event, scheduleInlineTools, true);
  }
})();
