(() => {
  if (window.top !== window || window.__AIENABLER_EXPORT_TOOLS__) return;
  window.__AIENABLER_EXPORT_TOOLS__ = true;

  const UI_ATTR = "data-aienabler-ui";
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const HIDDEN_SELECTOR =
    "[data-gpt-ad-filter], .gpt-ad-filter-hidden, [data-aienabler-ui]";
  const BODY_SELECTOR = [
    "[data-assistant-markdown]",
    "[data-message-content]",
    "[data-user-message-copy]",
    "[data-user-message-bubble]",
    ".markdown",
    ".prose",
  ].join(", ");
  const TURN_SELECTOR = [
    "[data-message-role]",
    "[data-message-author-role]",
    "[data-turn]",
    "[data-message-id]",
    '[data-testid^="conversation-turn"]',
    ".agent-turn",
  ].join(", ");
  const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
  /**
   * Reference chips and inline badges render at favicon size on the page, but
   * an export loses ChatGPT's stylesheet and falls back to the file's intrinsic
   * size, which is far larger. Anything at or below this box is treated as an
   * icon: dropped from Markdown, and pinned to its on-screen size when printed.
   */
  const ICON_MAX_PX = 32;

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

  function nodeToMarkdown(node, context = { listDepth: 0 }) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return escapeMarkdown(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (node.matches(HIDDEN_SELECTOR)) return "";
    if (node.namespaceURI && node.namespaceURI !== HTML_NS) return "";

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

  function elementRole(element) {
    const host = element.closest(TURN_SELECTOR);
    const value = [
      host?.getAttribute("data-message-role"),
      host?.getAttribute("data-message-author-role"),
      host?.getAttribute("data-turn"),
      element.getAttribute("data-message-role"),
      element.getAttribute("data-message-author-role"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (value.includes("assistant")) return "assistant";
    if (value.includes("user")) return "user";
    if (host?.classList.contains("agent-turn")) return "assistant";
    if (
      element.matches("[data-assistant-markdown]") ||
      host?.querySelector("[data-assistant-markdown]")
    ) {
      return "assistant";
    }
    if (
      element.matches("[data-user-message-copy], [data-user-message-bubble]") ||
      host?.querySelector("[data-user-message-copy], [data-user-message-bubble]")
    ) {
      return "user";
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
    return groups;
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

  function isIconImage(element) {
    const width = Number(element.dataset?.aienablerWidth) || 0;
    const height = Number(element.dataset?.aienablerHeight) || 0;
    return width > 0 && height > 0 && width <= ICON_MAX_PX && height <= ICON_MAX_PX;
  }

  function cleanClone(body) {
    const clone = body.cloneNode(true);
    const originalMedia = Array.from(body.querySelectorAll("img, svg"));
    for (const [index, media] of Array.from(
      clone.querySelectorAll("img, svg"),
    ).entries()) {
      const source = originalMedia[index];
      const { width, height } = renderedBox(source);
      media.dataset.aienablerWidth = String(width);
      media.dataset.aienablerHeight = String(height);
      if (media.tagName === "IMG") {
        media.dataset.aienablerSource =
          source?.currentSrc || source?.getAttribute("src") || "";
      }
    }
    for (const element of clone.querySelectorAll(
      `${HIDDEN_SELECTOR}, script, style, iframe, object, embed, template, form, button`,
    )) {
      element.remove();
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

  function installMessageTools(group) {
    const anchor = group.bodies.at(-1);
    if (!anchor || anchor.dataset.aienablerExportReady === "1") return;
    anchor.dataset.aienablerExportReady = "1";
    const host = anchor.parentElement || anchor;
    host.classList.add("aienabler-export-host");
    const tools = document.createElement("div");
    tools.className = "aienabler-tools";
    tools.setAttribute(UI_ATTR, "message");
    tools.append(
      makeButton("Copy Markdown", async (button) => {
        // Resolved on click: streaming may have added more bodies to this turn
        // since the button was installed.
        const current =
          messageGroups().find((candidate) => candidate.turn === group.turn) ||
          group;
        await copyGroupMarkdown(current);
        flashButton(button, "Copied");
      }),
    );
    anchor.insertAdjacentElement("afterend", tools);
  }

  /**
   * ChatGPT wraps code blocks in horizontally scrolling containers. A toolbar
   * placed directly after the block would sit inside that scroller and could
   * require scrolling to reach, so it is attached after the outermost wrapper
   * that holds nothing else. Stops at the message body either way.
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
    table.insertAdjacentElement("beforebegin", tools);
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
    toolbarAnchor(pre).insertAdjacentElement("afterend", tools);
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
    const raw =
      document.querySelector("main h1")?.textContent ||
      document.title.replace(/\s*[|—-]\s*ChatGPT.*$/i, "") ||
      "ChatGPT conversation";
    return (
      raw
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/[.\s]+$/g, "")
        .slice(0, 90) || "ChatGPT conversation"
    );
  }

  function imageExtension(type, source) {
    const byType = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
      "image/avif": "avif",
    };
    if (byType[type]) return byType[type];
    const match = String(source).match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
    return match?.[1].toLowerCase() || "bin";
  }

  function bytesFromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function sniffImageType(bytes) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return "image/png";
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (
      String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a" ||
      String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a"
    ) {
      return "image/gif";
    }
    if (
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    ) {
      return "image/webp";
    }
    const start = new TextDecoder()
      .decode(bytes.slice(0, 256))
      .replace(/^\s+/, "");
    return start.startsWith("<svg") || start.startsWith("<?xml")
      ? "image/svg+xml"
      : "";
  }

  function fetchImageFromExtension(source) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "aienabler-fetch-image", url: source },
        (response) => {
          if (chrome.runtime.lastError || !response?.ok) {
            reject(
              new Error(
                response?.error ||
                  chrome.runtime.lastError?.message ||
                  "extension fetch failed",
              ),
            );
            return;
          }
          resolve({
            bytes: bytesFromBase64(response.data),
            type: response.contentType || "",
          });
        },
      );
    });
  }

  async function readImage(source) {
    try {
      const response = await fetch(source, { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (blob.size > MAX_IMAGE_BYTES) throw new Error("Image is over 25 MB");
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        type: blob.type,
      };
    } catch (pageError) {
      if (!/^https:/i.test(source)) throw pageError;
      return fetchImageFromExtension(source);
    }
  }

  async function localizeImages(clone, state) {
    const clonedImages = Array.from(clone.querySelectorAll("img"));
    for (const image of clonedImages) {
      const source =
        image.dataset.aienablerSource || image.getAttribute("src") || "";
      delete image.dataset.aienablerSource;
      // Reference icons are dropped from Markdown, so bundling them would only
      // grow the ZIP with files nothing links to.
      if (!source || isIconImage(image)) continue;
      if (state.paths.has(source)) {
        image.setAttribute("src", state.paths.get(source));
        continue;
      }
      try {
        const result = await readImage(source);
        if (result.bytes.length > MAX_IMAGE_BYTES) {
          throw new Error("Image is over 25 MB");
        }
        const type =
          (result.type.startsWith("image/") && result.type) ||
          sniffImageType(result.bytes);
        if (!type) throw new Error("Not a recognized image");
        const extension = imageExtension(type, source);
        const path = `images/image-${String(state.nextImage).padStart(
          3,
          "0",
        )}.${extension}`;
        state.nextImage += 1;
        state.paths.set(source, path);
        state.files.push({
          name: path,
          bytes: result.bytes,
        });
        image.setAttribute("src", path);
        image.removeAttribute("srcset");
      } catch (error) {
        state.failures.push(`${source} — ${error.message || "download failed"}`);
      }
    }
  }

  function encode(value) {
    return new TextEncoder().encode(value);
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipDateTime(date = new Date()) {
    return {
      time:
        ((date.getHours() & 31) << 11) |
        ((date.getMinutes() & 63) << 5) |
        ((date.getSeconds() / 2) & 31),
      date:
        (((Math.max(1980, date.getFullYear()) - 1980) & 127) << 9) |
        (((date.getMonth() + 1) & 15) << 5) |
        (date.getDate() & 31),
    };
  }

  function zipFiles(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const stamp = zipDateTime();
    for (const file of files) {
      const name = encode(file.name);
      const bytes = file.bytes instanceof Uint8Array ? file.bytes : encode(file.bytes);
      const checksum = crc32(bytes);
      const local = new Uint8Array(30 + name.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, stamp.time, true);
      localView.setUint16(12, stamp.date, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, bytes.length, true);
      localView.setUint32(22, bytes.length, true);
      localView.setUint16(26, name.length, true);
      local.set(name, 30);
      localParts.push(local, bytes);

      const central = new Uint8Array(46 + name.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, stamp.time, true);
      centralView.setUint16(14, stamp.date, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, bytes.length, true);
      centralView.setUint32(24, bytes.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint32(42, offset, true);
      central.set(name, 46);
      centralParts.push(central);
      offset += local.length + bytes.length;
    }
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    return new Blob([...localParts, ...centralParts, end], {
      type: "application/zip",
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function exportConversation() {
    const groups = messageGroups();
    if (!groups.length) throw new Error("No conversation content was found.");
    const state = { files: [], paths: new Map(), failures: [], nextImage: 1 };
    const parts = [
      `# ${escapeMarkdown(fileSafeTitle())}`,
      "",
      `> Exported: ${new Date().toISOString()}`,
      `> Source: ${location.href}`,
      "",
    ];
    for (const group of groups) {
      const blocks = [];
      for (const body of group.bodies) {
        const clone = cleanClone(body);
        await localizeImages(clone, state);
        const markdown = normalizeMarkdown(nodeToMarkdown(clone));
        if (markdown) blocks.push(markdown);
      }
      if (!blocks.length) continue;
      parts.push(
        `## ${group.role === "user" ? "User" : "Assistant"}`,
        "",
        blocks.join("\n\n"),
        "",
      );
    }
    if (state.failures.length) {
      parts.push(
        "## Image download notes",
        "",
        "These images could not be bundled; their original links remain in the Markdown:",
        "",
        ...state.failures.map((failure) => `- ${failure}`),
        "",
      );
    }
    state.files.unshift({ name: "conversation.md", bytes: encode(parts.join("\n")) });
    downloadBlob(zipFiles(state.files), `${fileSafeTitle()}.zip`);
    return {
      messages: groups.length,
      images: state.files.length - 1,
      failedImages: state.failures.length,
    };
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
      delete media.dataset.aienablerSource;
    }
  }

  function printConversation() {
    const groups = messageGroups();
    if (!groups.length) throw new Error("No conversation content was found.");
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
        h1 { font-size: 20pt; margin: 0 0 8mm; } h2 { font-size: 11pt; color: #666; margin: 0 0 3mm; }
        .message { break-inside: avoid-page; border-top: 1px solid #ddd; padding: 6mm 0; }
        /* Wraps only at existing spaces, and small enough that a wide ASCII
           diagram fits a line: breaking mid-run would misalign the drawing. */
        pre { white-space: pre-wrap; overflow-wrap: normal; word-break: normal;
              font-size: 9pt; line-height: 1.35; background: #f5f5f5; padding: 3mm; }
        code { font-family: ui-monospace, monospace; }
        img, svg { max-width: 100%; height: auto; }
        .aienabler-icon { width: auto; max-height: 1.1em; vertical-align: text-bottom; }
        table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #bbb; padding: 2mm; text-align: left; }
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
        const markdown = groupMarkdown(group);
        if (!markdown) throw new Error("No answer content was found.");
        return { markdown };
      }
      await copyGroupMarkdown(group);
      return { copied: true };
    }
    if (action === "export-conversation-markdown") return exportConversation();
    if (action === "print-conversation") {
      printConversation();
      return { printing: true };
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
  for (const event of [
    "pageshow",
    "popstate",
    "web-mobile-conversation-state-change",
    "web-mobile-conversation-state-settled",
  ]) {
    window.addEventListener(event, scheduleInlineTools, true);
  }
})();
