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
