chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    message?.target !== "aienabler-offscreen" ||
    message.type !== "copy-markdown"
  ) {
    return undefined;
  }
  navigator.clipboard
    .writeText(String(message.text || ""))
    .then(() => sendResponse({ ok: true }))
    .catch((error) =>
      sendResponse({ ok: false, error: error.message || "Clipboard write failed." }),
    );
  return true;
});
