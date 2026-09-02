/**
 * Runs inside the frames that chat sites draw diagrams in. Those frames are a
 * separate origin - deliberately, so the conversation cannot reach into them -
 * which means the page-side export sees an empty box where the picture is. An
 * extension is not bound by that rule, so this script reads the drawing from
 * the inside and hands it out.
 *
 * It starts nothing and volunteers nothing: it answers a request from whoever
 * embedded it, with a snapshot of the largest drawing in its document.
 */
(() => {
  if (window.__AIENABLER_FRAME_TOOLS__) return;
  window.__AIENABLER_FRAME_TOOLS__ = true;

  const REQUEST = "aienabler-frame-request";
  const REPLY = "aienabler-frame-reply";
  /** A drawing smaller than this is a spinner or an icon, not the picture. */
  const MIN_PX = 24;

  function renderedBox(element) {
    const rect = element?.getBoundingClientRect?.();
    return {
      width: Math.round(rect?.width || 0),
      height: Math.round(rect?.height || 0),
    };
  }

  /** The biggest drawing on screen, which is the one the answer is about. */
  function largestVisible(selector) {
    let best = null;
    let bestArea = 0;
    for (const element of document.querySelectorAll(selector)) {
      const { width, height } = renderedBox(element);
      const area = width * height;
      if (width < MIN_PX || height < MIN_PX || area <= bestArea) continue;
      best = element;
      bestArea = area;
    }
    return best;
  }

  /**
   * Serializes an SVG. The markup travels as text rather than as a rendered
   * bitmap so the diagram stays sharp at any size in the exported document.
   */
  function svgPayload(svg) {
    const { width, height } = renderedBox(svg);
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!clone.getAttribute("viewBox") && width && height) {
      clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    // Scripts drew this picture; they must not travel with it into an export.
    for (const script of clone.querySelectorAll("script")) script.remove();
    for (const element of [clone, ...clone.querySelectorAll("*")]) {
      for (const attribute of Array.from(element.attributes || [])) {
        if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      }
    }
    return {
      kind: "svg",
      markup: new XMLSerializer().serializeToString(clone),
      width,
      height,
    };
  }

  /** A canvas has no markup to hand over, so it travels as a bitmap. */
  function canvasPayload(canvas) {
    const { width, height } = renderedBox(canvas);
    try {
      return { kind: "png", dataUrl: canvas.toDataURL("image/png"), width, height };
    } catch {
      // Tainted by a cross-origin draw, and the browser refuses to read it.
      return null;
    }
  }

  function documentDrawing() {
    const svg = largestVisible("svg");
    if (svg) return svgPayload(svg);
    const canvas = largestVisible("canvas");
    return canvas ? canvasPayload(canvas) : null;
  }

  window.addEventListener("message", (event) => {
    const request = event.data;
    if (!request || request.type !== REQUEST || !event.source) return;
    let payload = null;
    try {
      payload = documentDrawing();
    } catch {
      payload = null;
    }
    event.source.postMessage({ type: REPLY, id: request.id, payload }, "*");
  });
})();
