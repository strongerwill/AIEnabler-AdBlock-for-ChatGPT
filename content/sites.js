/**
 * Chat sites the export tools understand. Ad hiding stays ChatGPT-only: the
 * sponsored-card heuristics are built around that page and would hide real UI
 * on other products.
 *
 * Assigned to a single global so the file can be injected again into a tab that
 * already has it - re-running a set of top-level `const` declarations would
 * throw and leave the injection half-applied.
 */
window.AIEnablerSites =
  window.AIEnablerSites ||
  (() => {
    const SITES = [
      {
        id: "chatgpt",
        label: "ChatGPT",
        hosts: ["chatgpt.com", "chat.openai.com"],
        titleStrip: /\s*[|—-]\s*ChatGPT.*$/i,
        body: [
          "[data-assistant-markdown]",
          "[data-message-content]",
          "[data-user-message-copy]",
          "[data-user-message-bubble]",
          ".markdown",
          ".prose",
        ],
        turn: [
          "[data-message-role]",
          "[data-message-author-role]",
          "[data-turn]",
          "[data-message-id]",
          '[data-testid^="conversation-turn"]',
          ".agent-turn",
        ],
        assistant: [
          '[data-message-role="assistant"]',
          '[data-message-author-role="assistant"]',
          "[data-assistant-markdown]",
          ".agent-turn",
        ],
        user: [
          '[data-message-role="user"]',
          '[data-message-author-role="user"]',
          "[data-user-message-copy]",
          "[data-user-message-bubble]",
        ],
      },
      {
        id: "gemini",
        label: "Gemini",
        hosts: ["gemini.google.com"],
        titleStrip: /\s*[|—-]\s*Gemini.*$/i,
        body: [
          "user-query",
          "model-response",
          "message-content",
          ".query-text",
          ".user-query-bubble-with-background",
          ".model-response-text",
          ".markdown",
          ".prose",
        ],
        turn: [
          "user-query",
          "model-response",
          "chat-message",
          ".conversation-container",
        ],
        assistant: [
          "model-response",
          "message-content",
          ".model-response-text",
          ".markdown-main-panel",
        ],
        user: [
          "user-query",
          ".query-text",
          ".user-query-bubble-with-background",
        ],
      },
      {
        id: "claude",
        label: "Claude",
        hosts: ["claude.ai"],
        titleStrip: /\s*[|—-]\s*Claude.*$/i,
        body: [
          '[data-testid="user-message"]',
          '[data-testid="assistant-message"]',
          ".font-claude-message",
          ".font-claude-response",
          ".font-user-message",
          ".standard-markdown",
          ".prose",
          "[class*='markdown']",
        ],
        turn: [
          '[data-testid="user-message"]',
          '[data-testid="assistant-message"]',
          "[data-is-streaming]",
          ".font-claude-message",
          ".font-claude-response",
          ".font-user-message",
        ],
        assistant: [
          '[data-testid="assistant-message"]',
          "[data-is-streaming]",
          ".font-claude-message",
          ".font-claude-response",
        ],
        user: ['[data-testid="user-message"]', ".font-user-message"],
      },
      {
        id: "deepseek",
        label: "DeepSeek",
        hosts: ["chat.deepseek.com"],
        titleStrip: /\s*[|—-]\s*DeepSeek.*$/i,
        body: [".ds-markdown", ".ds-message", ".markdown"],
        turn: [".ds-message", "[class*='ds-message']"],
        assistant: [".ds-markdown"],
        user: [],
      },
      {
        id: "grok",
        label: "Grok",
        hosts: ["grok.com", "grok.x.ai"],
        titleStrip: /\s*[|—-]\s*Grok.*$/i,
        body: [".markdown", ".prose", "[data-testid='markdown-viewer']"],
        turn: ["[data-testid='message']", "[data-message-id]"],
        assistant: [],
        user: [],
      },
      {
        id: "copilot",
        label: "Copilot",
        hosts: ["copilot.microsoft.com"],
        titleStrip: /\s*[|—-]\s*Copilot.*$/i,
        body: [
          ".ac-textBlock",
          "[data-content='ai-message']",
          "[data-content='user-message']",
          ".markdown",
          ".prose",
        ],
        turn: ["[data-content='ai-message']", "[data-content='user-message']"],
        assistant: ["[data-content='ai-message']"],
        user: ["[data-content='user-message']"],
      },
      {
        id: "perplexity",
        label: "Perplexity",
        hosts: ["www.perplexity.ai", "perplexity.ai"],
        titleStrip: /\s*[|—-]\s*Perplexity.*$/i,
        body: [".prose", "[class*='prose']", ".markdown"],
        turn: ["[data-testid='thread-message']", "article"],
        assistant: [],
        user: [],
      },
      {
        id: "mistral",
        label: "Mistral",
        hosts: ["chat.mistral.ai"],
        titleStrip: /\s*[|—-]\s*(Le Chat|Mistral).*$/i,
        body: [".prose", ".markdown"],
        turn: ["[data-message-id]", "article"],
        assistant: [],
        user: [],
      },
      {
        id: "kimi",
        label: "Kimi",
        hosts: ["www.kimi.com", "kimi.com", "kimi.moonshot.cn"],
        titleStrip: /\s*[|—-]\s*Kimi.*$/i,
        body: [".markdown", ".segment-assistant", ".segment-user"],
        turn: [".segment-assistant", ".segment-user"],
        assistant: [".segment-assistant"],
        user: [".segment-user"],
      },
      {
        id: "qwen",
        label: "Qwen",
        hosts: ["chat.qwen.ai"],
        titleStrip: /\s*[|—-]\s*(Qwen|Tongyi).*$/i,
        body: [".markdown-body", ".markdown", ".prose"],
        turn: ["[class*='message']"],
        assistant: [],
        user: [],
      },
      {
        id: "poe",
        label: "Poe",
        hosts: ["poe.com"],
        titleStrip: /\s*[|—-]\s*Poe.*$/i,
        body: [".Markdown_markdownContainer", ".markdown", ".prose"],
        turn: ["[class*='Message_message']", "[class*='ChatMessage']"],
        assistant: [],
        user: [],
      },
    ];

    function hostMatches(hostname, host) {
      return hostname === host || hostname.endsWith(`.${host}`);
    }

    return {
      all: SITES,
      forHost(hostname) {
        return (
          SITES.find((site) =>
            site.hosts.some((host) => hostMatches(hostname, host)),
          ) || null
        );
      },
    };
  })();
