const DEFAULT_MODEL = "gpt-5.4";
const DEFAULT_BASE_URL = "https://api.aixhan.com/v1";
const DEFAULT_SYSTEM_PROMPT =
  "你是 Sensa，一个运行在浏览器侧边栏中的 AI 助手。你的核心任务不是空泛聊天，而是尽可能理解用户当前所处的环境：网页内容、页面结构、可选截图，以及历史对话。你需要利用这些材料，帮助用户快速理解当前页面、提炼关键信息、回答问题，并给出下一步建议。回答要求：1. 默认使用中文。2. 尽量简洁，结论优先，避免无意义复述。3. 如果页面信息不足，要明确指出缺失点。4. 优先依据用户当前环境中的最新材料作答，而不是脱离上下文泛泛而谈。5. 可以使用简短 Markdown 来增强可读性，但不要过度排版。6. 你要始终记住：AI 很多时候不是能力不够，而是缺少足够的环境背景信息，因此你的价值在于基于材料做出更贴近真实情境的判断。";
const ENV_TRAIL_KEY = "sensaEnvTrail";
const ENV_ACTIVE_KEY = "sensaActiveTabs";
const MAX_ENV_EVENTS = 24;
const SETTINGS_KEY = "sensaSettings";

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getStoredSettings();
  await saveStoredSettings(settings);
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isTrackableTab(tab)) {
      return;
    }

    const session = await chrome.storage.local.get([ENV_ACTIVE_KEY, ENV_TRAIL_KEY]);
    const activeTabs = session[ENV_ACTIVE_KEY] || {};
    const previous = activeTabs[String(windowId)] || null;

    const nextEntry = {
      tabId,
      title: sanitizeTitle(tab.title),
      url: sanitizeUrl(tab.url),
      hostname: safeHostname(tab.url)
    };

    activeTabs[String(windowId)] = nextEntry;
    await chrome.storage.local.set({ [ENV_ACTIVE_KEY]: activeTabs });

    if (
      !previous ||
      (previous.url === nextEntry.url && previous.title === nextEntry.title)
    ) {
      return;
    }

    const trail = Array.isArray(session[ENV_TRAIL_KEY]) ? session[ENV_TRAIL_KEY] : [];
    trail.push({
      type: "tab_switch",
      at: new Date().toISOString(),
      windowId,
      from: {
        title: previous.title || "",
        hostname: previous.hostname || "",
        url: previous.url || ""
      },
      to: {
        title: nextEntry.title || "",
        hostname: nextEntry.hostname || "",
        url: nextEntry.url || ""
      }
    });

    while (trail.length > MAX_ENV_EVENTS) {
      trail.shift();
    }

    await chrome.storage.local.set({ [ENV_TRAIL_KEY]: trail });
  } catch (error) {
    console.error("Failed to record environment trail", error);
  }
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Failed to set side panel behavior", error));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SENSA_ANALYZE") {
    handleAnalyze(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  if (message?.type === "SENSA_GET_SETTINGS") {
    getStoredSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  if (message?.type === "SENSA_SAVE_SETTINGS") {
    saveStoredSettings(message.payload || {})
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  if (message?.type === "SENSA_GET_ENV_TRAIL") {
    chrome.storage.local
      .get([ENV_TRAIL_KEY])
      .then((session) =>
        sendResponse({
          ok: true,
          trail: Array.isArray(session[ENV_TRAIL_KEY]) ? session[ENV_TRAIL_KEY] : []
        })
      )
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  return false;
});

async function handleAnalyze(payload) {
  const config = await getStoredSettings();

  if (!config.openaiApiKey) {
    throw new Error("Missing OpenAI API key. Open the side panel settings and save your API key first.");
  }

  const model = config.openaiModel || DEFAULT_MODEL;
  const baseUrl = normalizeBaseUrl(config.openaiBaseUrl || DEFAULT_BASE_URL);
  const systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  const userContent = [
    {
      type: "input_text",
      text: buildUserPrompt(payload)
    }
  ];

  if (payload?.includeScreenshot && payload?.screenshotDataUrl) {
    userContent.push({
      type: "input_image",
      image_url: payload.screenshotDataUrl
    });
  }

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemPrompt
            }
          ]
        },
        {
          role: "user",
          content: userContent
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = extractTextFromResponse(data);
  if (!text) {
    throw new Error("The model response was empty.");
  }

  return {
    text,
    usage: data.usage || null,
    model: data.model || model
  };
}

async function getStoredSettings() {
  const stored = await chrome.storage.local.get([
    SETTINGS_KEY,
    "openaiApiKey",
    "openaiBaseUrl",
    "openaiModel",
    "systemPrompt",
    "includeScreenshot",
    "includePageContext",
    "fontScale",
    "screenshotMode"
  ]);

  const merged = {
    ...(stored[SETTINGS_KEY] || {})
  };

  if (!merged.openaiApiKey && stored.openaiApiKey) {
    merged.openaiApiKey = stored.openaiApiKey;
  }
  if (!merged.openaiBaseUrl && stored.openaiBaseUrl) {
    merged.openaiBaseUrl = stored.openaiBaseUrl;
  }
  if (!merged.openaiModel && stored.openaiModel) {
    merged.openaiModel = stored.openaiModel;
  }
  if (!merged.systemPrompt && stored.systemPrompt) {
    merged.systemPrompt = stored.systemPrompt;
  }
  if (typeof merged.includeScreenshot !== "boolean" && typeof stored.includeScreenshot === "boolean") {
    merged.includeScreenshot = stored.includeScreenshot;
  }
  if (typeof merged.includePageContext !== "boolean" && typeof stored.includePageContext === "boolean") {
    merged.includePageContext = stored.includePageContext;
  }
  if (!merged.fontScale && stored.fontScale) {
    merged.fontScale = stored.fontScale;
  }
  if (!merged.screenshotMode && stored.screenshotMode) {
    merged.screenshotMode = stored.screenshotMode;
  }

  return normalizeSettings(merged);
}

async function saveStoredSettings(payload) {
  const next = normalizeSettings(payload || {});
  await chrome.storage.local.set({
    [SETTINGS_KEY]: next
  });
}

function normalizeSettings(input) {
  return {
    openaiApiKey: String(input.openaiApiKey || "").trim(),
    openaiBaseUrl: String(input.openaiBaseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, ""),
    openaiModel: String(input.openaiModel || DEFAULT_MODEL).trim(),
    systemPrompt: String(input.systemPrompt || DEFAULT_SYSTEM_PROMPT).trim(),
    includeScreenshot: typeof input.includeScreenshot === "boolean" ? input.includeScreenshot : true,
    includePageContext: typeof input.includePageContext === "boolean" ? input.includePageContext : true,
    fontScale: input.fontScale || "small",
    screenshotMode: input.screenshotMode || "viewport"
  };
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function buildUserPrompt(payload) {
  const history = Array.isArray(payload?.conversationHistory)
    ? payload.conversationHistory.slice(-8)
    : [];
  const envTrail = Array.isArray(payload?.environmentTrail)
    ? payload.environmentTrail.slice(-6)
    : [];

  const sections = [
    "请基于当前网页状态帮助用户理解页面并推进任务。",
    "如果最新页面内容与历史对话冲突，以最新页面内容为准。",
    ""
  ];

  if (history.length) {
    sections.push("历史对话：");
    sections.push(
      history
        .map((item) => `${item.role === "assistant" ? "助手" : "用户"}: ${item.text}`)
        .join("\n")
    );
    sections.push("");
  }

  sections.push("用户本轮问题：");
  sections.push(
    payload?.userInstruction?.trim() || "请解释当前页面并给出最有帮助的下一步建议。"
  );
  sections.push("");

  if (envTrail.length) {
    sections.push("最近的环境切换轨迹：");
    sections.push(
      envTrail
        .map(
          (item) =>
            `${item.at || ""} 从《${item.from?.title || item.from?.hostname || "未知页面"}》切换到《${item.to?.title || item.to?.hostname || "未知页面"}》`
        )
        .join("\n")
    );
    sections.push("");
  }

  if (payload?.includeScreenshot) {
    sections.push("本轮附带了当前页面截图。");
    sections.push("");
  }

  if (payload?.includePageContext) {
    sections.push("页面结构化上下文 JSON：");
    sections.push(JSON.stringify(payload?.pageContext || {}, null, 2));
  } else {
    sections.push("本轮未附带新的页面上下文，请主要依据历史对话回答。");
  }

  return sections.filter(Boolean).join("\n");
}

function extractTextFromResponse(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  const textParts = [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        textParts.push(part.text);
      }
    }
  }

  return textParts.join("\n").trim();
}

function isTrackableTab(tab) {
  return !!tab?.url && /^https?:\/\//.test(tab.url);
}

function sanitizeTitle(title) {
  return String(title || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function sanitizeUrl(url) {
  return String(url || "").slice(0, 500);
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
