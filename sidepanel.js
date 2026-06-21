const defaultSystemPrompt =
  "你是 Sensa，一个运行在浏览器侧边栏中的 AI 助手。你的核心任务不是空泛聊天，而是尽可能理解用户当前所处的环境：网页内容、页面结构、可选截图，以及历史对话。你需要利用这些材料，帮助用户快速理解当前页面、提炼关键信息、回答问题，并给出下一步建议。回答要求：1. 默认使用中文。2. 尽量简洁，结论优先，避免无意义复述。3. 如果页面信息不足，要明确指出缺失点。4. 优先依据用户当前环境中的最新材料作答，而不是脱离上下文泛泛而谈。5. 可以使用简短 Markdown 来增强可读性，但不要过度排版。6. 你要始终记住：AI 很多时候不是能力不够，而是缺少足够的环境背景信息，因此你的价值在于基于材料做出更贴近真实情境的判断。";
const defaultBaseUrl = "https://api.aixhan.com/v1";
const defaultModel = "gpt-5.4";
const sessionKeyPrefix = "sensaSession:";
const legacySessionKeyPrefix = "gameCopilotSession:";

document.addEventListener("DOMContentLoaded", async () => {
  const elements = {
    messages: document.getElementById("messages"),
    instruction: document.getElementById("instruction"),
    sendButton: document.getElementById("send-button"),
    clearHistory: document.getElementById("clear-history"),
    clearStoredHistory: document.getElementById("clear-stored-history"),
    status: document.getElementById("status"),
    contextSummary: document.getElementById("context-summary"),
    storageSummary: document.getElementById("storage-summary"),
    settingsToggle: document.getElementById("settings-toggle"),
    settings: document.getElementById("settings"),
    includePageContextMain: document.getElementById("include-page-context-main"),
    includeScreenshotMain: document.getElementById("include-screenshot-main"),
    apiKey: document.getElementById("api-key"),
    baseUrl: document.getElementById("base-url"),
    model: document.getElementById("model"),
    systemPrompt: document.getElementById("system-prompt"),
    fontScale: document.getElementById("font-scale"),
    screenshotMode: document.getElementById("screenshot-mode"),
    includePageContextDefault: document.getElementById("include-page-context-default"),
    includeScreenshot: document.getElementById("include-screenshot"),
    saveSettings: document.getElementById("save-settings")
  };

  const state = {
    messages: [],
    currentContext: null,
    currentPageKey: "",
    currentPageTitle: "",
    lastSentContextHash: "",
    lastSentScreenshotHash: "",
    isBusy: false,
    isComposing: false
  };

  const settingsResponse = await chrome.runtime.sendMessage({
    type: "SENSA_GET_SETTINGS"
  });

  if (settingsResponse?.ok) {
    const settings = settingsResponse.settings || {};
    elements.apiKey.value = settings.openaiApiKey || "";
    elements.baseUrl.value = settings.openaiBaseUrl || defaultBaseUrl;
    elements.model.value = settings.openaiModel || defaultModel;
    elements.systemPrompt.value = settings.systemPrompt || defaultSystemPrompt;
    elements.fontScale.value = settings.fontScale || "small";
    elements.screenshotMode.value = settings.screenshotMode || "viewport";
    elements.includePageContextDefault.checked = settings.includePageContext !== false;
    elements.includeScreenshot.checked = settings.includeScreenshot !== false;
    elements.includePageContextMain.checked = settings.includePageContext !== false;
    elements.includeScreenshotMain.checked = settings.includeScreenshot !== false;
    applyFontScale(settings.fontScale || "small");
  }

  await hydratePageSession(state, elements);
  await refreshStorageSummary(elements);

  elements.includePageContextMain.addEventListener("change", () => {
    elements.includePageContextDefault.checked = elements.includePageContextMain.checked;
  });

  elements.includeScreenshotMain.addEventListener("change", () => {
    elements.includeScreenshot.checked = elements.includeScreenshotMain.checked;
  });

  elements.includePageContextDefault.addEventListener("change", () => {
    elements.includePageContextMain.checked = elements.includePageContextDefault.checked;
  });

  elements.includeScreenshot.addEventListener("change", () => {
    elements.includeScreenshotMain.checked = elements.includeScreenshot.checked;
  });

  elements.settingsToggle.addEventListener("click", () => {
    elements.settings.hidden = !elements.settings.hidden;
  });

  elements.saveSettings.addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({
      type: "SENSA_SAVE_SETTINGS",
      payload: {
        openaiApiKey: elements.apiKey.value.trim(),
        openaiBaseUrl: (elements.baseUrl.value.trim() || defaultBaseUrl).replace(/\/+$/, ""),
        openaiModel: elements.model.value.trim() || defaultModel,
        systemPrompt: elements.systemPrompt.value.trim() || defaultSystemPrompt,
        fontScale: elements.fontScale.value || "small",
        screenshotMode: elements.screenshotMode.value || "viewport",
        includePageContext: elements.includePageContextDefault.checked,
        includeScreenshot: elements.includeScreenshot.checked
      }
    });

    applyFontScale(elements.fontScale.value || "small");
    if (response?.ok) {
      elements.settings.hidden = true;
    }
    await refreshStorageSummary(elements);
    setStatus(
      elements.status,
      response?.ok ? "设置已保存。" : `保存失败：${response?.error || "Unknown error"}`
    );
  });

  elements.sendButton.addEventListener("click", async () => {
    await sendMessage(state, elements);
  });

  elements.instruction.addEventListener("compositionstart", () => {
    state.isComposing = true;
  });

  elements.instruction.addEventListener("compositionend", () => {
    state.isComposing = false;
  });

  elements.instruction.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }

    if (event.shiftKey) {
      return;
    }

    if (
      state.isComposing ||
      event.isComposing ||
      event.keyCode === 229
    ) {
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      await sendMessage(state, elements);
    }
  });

  elements.clearHistory.addEventListener("click", async () => {
    state.messages = [];
    state.currentContext = null;
    state.lastSentContextHash = "";
    state.lastSentScreenshotHash = "";
    renderMessages(elements.messages, state.messages);
    updateContextSummary(state, elements);
    setStatus(elements.status, "当前页面历史对话已清空。");
    await persistCurrentSession(state);
    await refreshStorageSummary(elements);
  });

  elements.clearStoredHistory.addEventListener("click", async () => {
    await clearAllStoredHistories();
    state.messages = [];
    state.currentContext = null;
    state.lastSentContextHash = "";
    state.lastSentScreenshotHash = "";
    renderMessages(elements.messages, state.messages);
    updateContextSummary(state, elements);
    await refreshStorageSummary(elements);
    setStatus(elements.status, "已清空本地保存的所有对话历史。");
  });

  renderMessages(elements.messages, state.messages);
  updateContextSummary(state, elements);
});

function applyFontScale(scale) {
  document.body.dataset.fontScale = scale || "small";
}

async function hydratePageSession(state, elements) {
  const pageInfo = await getActivePageInfo();
  state.currentPageKey = makePageKey(pageInfo.url);
  state.currentPageTitle = pageInfo.title || "";

  const stored = await chrome.storage.local.get(state.currentPageKey);
  let session = normalizeStoredSession(stored[state.currentPageKey]);
  if (!session && pageInfo.url) {
    const legacyKey = makeLegacyPageKey(pageInfo.url);
    const legacyStored = await chrome.storage.local.get(legacyKey);
    session = normalizeStoredSession(legacyStored[legacyKey]);
  }
  if (session) {
    state.messages = Array.isArray(session.messages) ? session.messages : [];
    state.currentContext = session.currentContext || null;
    state.lastSentContextHash = session.lastSentContextHash || "";
    state.lastSentScreenshotHash = session.lastSentScreenshotHash || "";
  }

  renderMessages(elements.messages, state.messages);
  updateContextSummary(state, elements);
}

async function ensurePageSession(state, elements) {
  const pageInfo = await getActivePageInfo();
  const nextKey = makePageKey(pageInfo.url);
  if (nextKey === state.currentPageKey) {
    state.currentPageTitle = pageInfo.title || state.currentPageTitle;
    updateContextSummary(state, elements);
    return;
  }

  state.currentPageKey = nextKey;
  state.currentPageTitle = pageInfo.title || "";
  state.messages = [];
  state.currentContext = null;

  const stored = await chrome.storage.local.get(state.currentPageKey);
  let session = normalizeStoredSession(stored[state.currentPageKey]);
  if (!session && pageInfo.url) {
    const legacyKey = makeLegacyPageKey(pageInfo.url);
    const legacyStored = await chrome.storage.local.get(legacyKey);
    session = normalizeStoredSession(legacyStored[legacyKey]);
  }
  if (session) {
    state.messages = Array.isArray(session.messages) ? session.messages : [];
    state.currentContext = session.currentContext || null;
    state.lastSentContextHash = session.lastSentContextHash || "";
    state.lastSentScreenshotHash = session.lastSentScreenshotHash || "";
  }

  renderMessages(elements.messages, state.messages);
  updateContextSummary(state, elements);
}

async function persistCurrentSession(state) {
  if (!state.currentPageKey) {
    return;
  }

  const primarySession = buildPersistedSession(state, { compact: false });

  try {
    await chrome.storage.local.set({
      [state.currentPageKey]: primarySession
    });
    return;
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      throw error;
    }
  }

  const compactSession = buildPersistedSession(state, { compact: true });
  await chrome.storage.local.set({
    [state.currentPageKey]: compactSession
  });
}

function normalizeStoredSession(session) {
  if (!session || typeof session !== "object") {
    return null;
  }

  return {
    messages: Array.isArray(session.messages)
      ? session.messages.map((message) => ({
          role: message?.role || "assistant",
          text: String(message?.text || ""),
          meta: typeof message?.meta === "string" ? message.meta : undefined,
          details: sanitizeMessageDetails(message?.details, { compact: false })
        }))
      : [],
    currentContext: sanitizeContextForStorage(session.currentContext, { compact: false }),
    lastSentContextHash: session.lastSentContextHash || "",
    lastSentScreenshotHash: session.lastSentScreenshotHash || "",
    savedAt: session.savedAt || ""
  };
}

function buildPersistedSession(state, { compact }) {
  const maxMessages = compact ? 24 : 40;
  return {
    messages: state.messages.slice(-maxMessages).map((message) => ({
      role: message.role,
      text: compact ? truncateText(message.text, 4000) : String(message.text || ""),
      meta: typeof message.meta === "string" ? truncateText(message.meta, 200) : undefined,
      details: sanitizeMessageDetails(message.details, { compact })
    })),
    currentContext: sanitizeContextForStorage(state.currentContext, { compact }),
    lastSentContextHash: state.lastSentContextHash,
    lastSentScreenshotHash: state.lastSentScreenshotHash,
    savedAt: new Date().toISOString()
  };
}

function sanitizeMessageDetails(details, { compact }) {
  if (!details || typeof details !== "object") {
    return null;
  }

  return {
    contextPreview: truncateText(details.contextPreview || "", compact ? 1200 : 4000),
    screenshotDataUrl: "",
    screenshotNote: truncateText(details.screenshotNote || "", 240)
  };
}

function sanitizeContextForStorage(context, { compact }) {
  if (!context || typeof context !== "object") {
    return null;
  }

  const page = context.page || {};
  return {
    page: {
      title: page.title || "",
      url: page.url || "",
      hostname: page.hostname || "",
      description: truncateText(page.description || "", compact ? 200 : 400)
    },
    selection: truncateText(context.selection || "", compact ? 200 : 500),
    activeElement: context.activeElement
      ? {
          tag: context.activeElement.tag || "",
          id: context.activeElement.id || "",
          classes: truncateText(context.activeElement.classes || "", 160),
          text: truncateText(context.activeElement.text || "", compact ? 200 : 400)
        }
      : null,
    headings: limitStringArray(context.headings, compact ? 8 : 12, 120),
    buttons: limitStringArray(context.buttons, compact ? 10 : 16, 80),
    formLabels: limitStringArray(context.formLabels, compact ? 10 : 16, 80),
    visibleTextExcerpt: truncateText(context.visibleTextExcerpt || "", compact ? 1200 : 3000),
    screenshotMeta: context.screenshotMeta || null,
    timestamp: context.timestamp || ""
  };
}

function limitStringArray(value, count, maxChars) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, count)
    .map((item) => truncateText(item, maxChars))
    .filter(Boolean);
}

function truncateText(text, maxChars) {
  const value = String(text || "");
  if (!maxChars || value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function isQuotaExceededError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const lower = message.toLowerCase();
  return lower.includes("quota") || lower.includes("kquotabytes");
}

async function sendMessage(state, elements) {
  await ensurePageSession(state, elements);

  const text = elements.instruction.value.trim();
  if (!text || state.isBusy) {
    return;
  }

  const includePageContext = elements.includePageContextMain.checked;
  const includeScreenshot = elements.includeScreenshotMain.checked;
  const screenshotMode = elements.screenshotMode.value || "viewport";

  state.isBusy = true;
  syncBusyState(elements, true);

  try {
    if (includePageContext || includeScreenshot) {
      setStatus(
        elements.status,
        includeScreenshot ? "正在抓取最新页面内容和截图..." : "正在抓取最新页面内容..."
      );
      state.currentContext = await captureContextFromActiveTab(includeScreenshot, screenshotMode);
      updateContextSummary(state, elements);
    }

    const contextPayload = includePageContext ? stripTransportFields(state.currentContext) : {};
    const contextHash = includePageContext ? await hashText(stableStringify(contextPayload)) : "";
    const screenshotHash =
      includeScreenshot && state.currentContext?.screenshotDataUrl
        ? await hashText(state.currentContext.screenshotDataUrl)
        : "";

    const shouldSendContext =
      includePageContext && !!contextHash && contextHash !== state.lastSentContextHash;
    const shouldSendScreenshot =
      includeScreenshot && !!screenshotHash && screenshotHash !== state.lastSentScreenshotHash;

    const historyForRequest = state.messages.map((item) => ({
      role: item.role,
      text: item.text
    }));
    const environmentTrail = await getEnvironmentTrail();

    state.messages.push({
      role: "user",
      text,
      details: {
        contextPreview: includePageContext
          ? shouldSendContext
            ? buildContextPreview(state.currentContext)
            : "本轮检测到页面内容未变化，未重复发送页面上下文。"
          : "本轮未附带页面内容。",
        screenshotDataUrl:
          includeScreenshot && shouldSendScreenshot
            ? state.currentContext?.screenshotDataUrl || ""
            : "",
        screenshotNote:
          includeScreenshot && !shouldSendScreenshot
            ? "本轮检测到截图未变化，未重复发送截图。"
            : includeScreenshot
              ? "本轮附带了最新截图。"
              : "本轮未附带截图。"
      }
    });
    renderMessages(elements.messages, state.messages);
    scrollMessagesToBottom(elements.messages);
    elements.instruction.value = "";

    const assistantMessage = {
      role: "assistant",
      text: "",
      meta: "流式生成中..."
    };
    state.messages.push(assistantMessage);
    renderMessages(elements.messages, state.messages);
    scrollMessagesToBottom(elements.messages);
    setStatus(elements.status, "正在请求模型...");

    const result = await streamAnalyze({
      settings: getCurrentSettings(elements),
      payload: {
        userInstruction: text,
        pageContext: shouldSendContext ? contextPayload : {},
        includePageContext: shouldSendContext,
        screenshotDataUrl: shouldSendScreenshot ? state.currentContext?.screenshotDataUrl || "" : "",
        includeScreenshot: shouldSendScreenshot,
        conversationHistory: historyForRequest,
        environmentTrail
      },
      onDelta(delta) {
        assistantMessage.text += delta;
        renderMessages(elements.messages, state.messages);
        scrollMessagesToBottom(elements.messages);
      }
    });

    assistantMessage.meta = result.usage
      ? `tokens: input ${result.usage.input_tokens || 0}, output ${result.usage.output_tokens || 0}`
      : result.model || "AI";
    if (!assistantMessage.text.trim() && result.text) {
      assistantMessage.text = result.text;
    }

    if (shouldSendContext) {
      state.lastSentContextHash = contextHash;
    }
    if (shouldSendScreenshot) {
      state.lastSentScreenshotHash = screenshotHash;
    }

    renderMessages(elements.messages, state.messages);
    scrollMessagesToBottom(elements.messages);
    await persistCurrentSession(state);
    await refreshStorageSummary(elements);
    setStatus(
      elements.status,
      result.usage
        ? `模型 ${result.model} 已返回。tokens: input ${result.usage.input_tokens || 0}, output ${result.usage.output_tokens || 0}.`
        : `模型 ${result.model} 已返回。`
    );
  } catch (error) {
    if (state.messages[state.messages.length - 1]?.role === "assistant" && !state.messages[state.messages.length - 1].text) {
      state.messages.pop();
    }
    const failure = normalizeSendError(error);
    state.messages.push({
      role: "assistant",
      text: buildFailureMessage(failure),
      meta: "发送失败"
    });
    renderMessages(elements.messages, state.messages);
    scrollMessagesToBottom(elements.messages);
    await persistCurrentSession(state);
    await refreshStorageSummary(elements);
    setStatus(elements.status, `发送失败：${failure.shortReason}`);
  } finally {
    state.isBusy = false;
    syncBusyState(elements, false);
  }
}

function syncBusyState(elements, isBusy) {
  elements.sendButton.disabled = isBusy;
}

function updateContextSummary(state, elements) {
  if (!state.currentContext) {
    const pageLabel = state.currentPageTitle
      ? `当前页面：${state.currentPageTitle}`
      : "发送时会按勾选项自动抓取最新页面内容和截图。";
    elements.contextSummary.textContent = pageLabel;
    return;
  }

  const page = state.currentContext.page || {};
  const screenshotSuffix = state.currentContext.screenshotMeta ? "，含截图" : "";
  elements.contextSummary.textContent =
    `${page.title || state.currentPageTitle || "当前页面"}${screenshotSuffix}`.slice(0, 120);
}

async function getActivePageInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return {
    id: tab?.id || 0,
    windowId: tab?.windowId || chrome.windows.WINDOW_ID_CURRENT,
    url: tab?.url || "",
    title: tab?.title || ""
  };
}

function makePageKey(url) {
  return `${sessionKeyPrefix}${url || "unknown"}`;
}

function makeLegacyPageKey(url) {
  return `${legacySessionKeyPrefix}${url || "unknown"}`;
}

async function captureContextFromActiveTab(includeScreenshot, screenshotMode) {
  const tab = await getActivePageInfo();
  if (!tab.id) {
    throw new Error("No active tab found.");
  }

  await ensureContentScriptReady(tab.id);

  const contextResponse = await chrome.tabs.sendMessage(tab.id, {
    type: "SENSA_CAPTURE_CONTEXT"
  });

  if (!contextResponse?.ok) {
    throw new Error(contextResponse?.error || "Failed to capture page context.");
  }

  let screenshotDataUrl = "";
  if (includeScreenshot) {
    if (screenshotMode === "fullpage") {
      screenshotDataUrl = await captureFullPageScreenshot(tab.id, tab.windowId);
    } else {
      screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png"
      });
    }
  }

  return {
    ...contextResponse.context,
    screenshotDataUrl,
    screenshotMeta: screenshotDataUrl
      ? {
          format: "png",
          source: screenshotMode === "fullpage" ? "fullpage" : "captureVisibleTab"
        }
      : null
  };
}

async function captureFullPageScreenshot(tabId, windowId) {
  await ensureContentScriptReady(tabId);

  const infoResponse = await chrome.tabs.sendMessage(tabId, {
    type: "SENSA_GET_CAPTURE_PAGE_INFO"
  });
  if (!infoResponse?.ok) {
    throw new Error(infoResponse?.error || "Failed to get page capture info.");
  }

  const info = infoResponse.info;
  const dpr = info.devicePixelRatio || 1;
  const viewportHeight = info.viewportHeight || 1;
  const viewportWidth = info.viewportWidth || 1;
  const fullHeight = info.fullHeight || viewportHeight;
  const fullWidth = info.fullWidth || viewportWidth;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(fullWidth * dpr);
  canvas.height = Math.round(fullHeight * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create canvas for full-page screenshot.");
  }

  const originalY = info.scrollY || 0;
  const originalX = info.scrollX || 0;
  const segments = Math.ceil(fullHeight / viewportHeight);

  for (let index = 0; index < segments; index += 1) {
    const y = Math.min(index * viewportHeight, Math.max(fullHeight - viewportHeight, 0));
    await chrome.tabs.sendMessage(tabId, {
      type: "SENSA_SCROLL_TO",
      payload: { x: 0, y }
    });
    await sleep(250);
    const shot = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    const image = await loadImage(shot);
    ctx.drawImage(
      image,
      0,
      0,
      image.width,
      image.height,
      0,
      Math.round(y * dpr),
      Math.round(viewportWidth * dpr),
      Math.round(Math.min(viewportHeight, fullHeight - y) * dpr)
    );
  }

  await chrome.tabs.sendMessage(tabId, {
    type: "SENSA_SCROLL_TO",
    payload: { x: originalX, y: originalY }
  });
  await sleep(100);
  return canvas.toDataURL("image/png");
}

async function ensureContentScriptReady(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "SENSA_PING"
    });
    return;
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch (error) {
    throw new Error(describeContentScriptInjectionError(error));
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "SENSA_PING"
    });
  } catch (error) {
    if (isMissingReceiverError(error)) {
      throw new Error("Content script is unavailable on this page.");
    }
    throw error;
  }
}

function isMissingReceiverError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("Receiving end does not exist") || message.includes("Could not establish connection");
}

function describeContentScriptInjectionError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const lower = message.toLowerCase();

  if (lower.includes("cannot access a chrome:// url") || lower.includes("cannot access contents of url")) {
    return "This page is restricted by Chrome, so Sensa cannot read its content.";
  }

  if (lower.includes("the extensions gallery cannot be scripted")) {
    return "Chrome Web Store pages cannot be scripted.";
  }

  if (lower.includes("missing host permission")) {
    return "Sensa does not have permission to access this page.";
  }

  return message || "Failed to inject content script into the current page.";
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load screenshot image."));
    image.src = dataUrl;
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderMessages(container, messages) {
  if (!messages.length) {
    container.innerHTML = `
      <section class="panel-empty">
        <h2 class="panel-empty-title">Sensa 已就绪</h2>
        <p class="panel-empty-text">聊天历史会按页面保留。发送时会根据本轮勾选自动抓取最新页面内容和截图。</p>
      </section>
    `;
    return;
  }

  container.innerHTML = messages.map((message) => renderMessage(message)).join("");
}

function renderMessage(message) {
  const meta = message.role === "assistant" ? message.meta || "AI" : "你";
  const details = message.details
    ? `
      <details class="message-details">
        <summary>本轮详细信息</summary>
        <div class="message-details-body">
          ${
            message.details.screenshotDataUrl
              ? `<img class="message-screenshot" src="${message.details.screenshotDataUrl}" alt="Captured screenshot" />`
              : ""
          }
          ${
            message.details.screenshotNote
              ? `<div class="message-detail-note">${escapeHtml(message.details.screenshotNote)}</div>`
              : ""
          }
          <pre class="message-context">${escapeHtml(message.details.contextPreview)}</pre>
        </div>
      </details>
    `
    : "";

  return `
    <article class="message ${message.role}">
      <div class="message-meta">${escapeHtml(meta)}</div>
      <div class="message-bubble">
        <div class="message-text">${markdownToHtml(message.text, message.role === "user")}</div>
        ${details}
      </div>
    </article>
  `;
}

function markdownToHtml(markdown, isPlainText) {
  if (isPlainText) {
    return `<p>${renderInline(escapeHtml(markdown))}</p>`;
  }

  const source = String(markdown || "").trim();
  if (!source) {
    return "";
  }

  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }
    blocks.push(`<p>${renderInline(escapeHtml(paragraph.join(" ")))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) {
      return;
    }
    blocks.push(
      `<ul>${listItems.map((item) => `<li>${renderInline(escapeHtml(item))}</li>`).join("")}</ul>`
    );
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(headingMatch[1].length, 3);
      blocks.push(`<h${level}>${renderInline(escapeHtml(headingMatch[2]))}</h${level}>`);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      listItems.push(bulletMatch[1]);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      listItems.push(orderedMatch[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks.join("");
}

function renderInline(text) {
  let html = text;
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

function buildContextPreview(context) {
  const preview = {
    ...stripTransportFields(context),
    screenshotDataUrl: context?.screenshotDataUrl ? "[screenshot attached]" : "",
    screenshotMeta: context?.screenshotMeta || null
  };
  return JSON.stringify(preview, null, 2);
}

function stripTransportFields(context) {
  if (!context) {
    return {};
  }

  const clone = { ...context };
  delete clone.screenshotDataUrl;
  return clone;
}

function scrollMessagesToBottom(container) {
  container.scrollTop = container.scrollHeight;
}

function setStatus(element, text) {
  element.textContent = text;
}

async function refreshStorageSummary(elements) {
  const stats = await getStorageStats();
  elements.storageSummary.textContent =
    `本地总占用 ${formatBytes(stats.totalBytes)}，其中对话历史 ${formatBytes(stats.historyBytes)}，共 ${stats.historyCount} 个页面会话。`;
}

async function getStorageStats() {
  const allStored = await chrome.storage.local.get(null);
  const allKeys = Object.keys(allStored);
  const historyKeys = allKeys.filter(
    (key) => key.startsWith(sessionKeyPrefix) || key.startsWith(legacySessionKeyPrefix)
  );
  const totalBytes = await chrome.storage.local.getBytesInUse(null);
  const historyBytes = historyKeys.length
    ? await chrome.storage.local.getBytesInUse(historyKeys)
    : 0;

  return {
    totalBytes,
    historyBytes,
    historyCount: historyKeys.length
  };
}

async function clearAllStoredHistories() {
  const allStored = await chrome.storage.local.get(null);
  const historyKeys = Object.keys(allStored).filter(
    (key) => key.startsWith(sessionKeyPrefix) || key.startsWith(legacySessionKeyPrefix)
  );
  if (!historyKeys.length) {
    return;
  }
  await chrome.storage.local.remove(historyKeys);
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function normalizeSendError(error) {
  const rawMessage = error instanceof Error ? error.message : String(error || "Unknown error");
  const message = String(rawMessage || "").trim();
  const lower = message.toLowerCase();

  if (lower.includes("missing openai api key")) {
    return {
      shortReason: "未配置 API Key",
      detail: "请先在配置中填写并保存 API Key。"
    };
  }

  if (lower.includes("openai api error (401)")) {
    return {
      shortReason: "鉴权失败",
      detail: "API Key 无效、已过期，或中转服务未正确识别该 Key。"
    };
  }

  if (lower.includes("openai api error (403)")) {
    return {
      shortReason: "请求被拒绝",
      detail: "当前 Key、模型、来源域名或中转权限不被允许。"
    };
  }

  if (lower.includes("openai api error (429)")) {
    return {
      shortReason: "请求过多",
      detail: "触发了频率限制、额度限制，或中转当前负载过高。"
    };
  }

  if (lower.includes("openai api error (500)") || lower.includes("openai api error (502)") || lower.includes("openai api error (503)") || lower.includes("openai api error (504)")) {
    return {
      shortReason: "服务端异常",
      detail: "模型服务或中转服务暂时不可用，可以稍后重试。"
    };
  }

  if (lower.includes("failed to fetch")) {
    return {
      shortReason: "网络连接失败",
      detail: "通常是网络断开、接口地址不可达、跨域被拦截，或中转服务没有响应。"
    };
  }

  if (lower.includes("streaming request failed")) {
    return {
      shortReason: "流式响应中断",
      detail: "服务端开始返回后又中途断开，常见于网络抖动或中转服务异常。"
    };
  }

  if (lower.includes("failed to capture page context") || lower.includes("capture context")) {
    return {
      shortReason: "页面内容采集失败",
      detail: "当前页面可能限制了内容脚本访问，或页面结构还未准备完成。"
    };
  }

  if (lower.includes("content script is unavailable on this page")) {
    return {
      shortReason: "当前页面不支持读取",
      detail: "这个页面没有可用的内容脚本接收端，通常是浏览器受限页、扩展商店页，或页面本身禁止注入。"
    };
  }

  if (lower.includes("restricted by chrome") || lower.includes("cannot be scripted") || lower.includes("does not have permission to access this page")) {
    return {
      shortReason: "当前页面受限",
      detail: "Chrome 不允许扩展读取这个页面，或者扩展暂时没有访问该页面的权限。"
    };
  }

  if (lower.includes("failed to get page capture info") || lower.includes("capturevisibletab") || lower.includes("screenshot")) {
    return {
      shortReason: "截图失败",
      detail: "当前页面截图权限、页面滚动状态或浏览器接口调用出现了问题。"
    };
  }

  if (lower.includes("no active tab found")) {
    return {
      shortReason: "未找到当前标签页",
      detail: "当前没有可操作的活动标签页，或侧边栏与页面状态不同步。"
    };
  }

  if (lower.includes("the model response was empty") || lower.includes("response was empty")) {
    return {
      shortReason: "模型返回为空",
      detail: "服务端成功响应了请求，但没有返回可显示的文本内容。"
    };
  }

  return {
    shortReason: "未知错误",
    detail: message || "发送过程中出现了未分类的问题。"
  };
}

function buildFailureMessage(failure) {
  return [
    `**未能发送成功**`,
    ``,
    `原因：${failure.shortReason}`,
    `说明：${failure.detail}`
  ].join("\n");
}

async function hashText(text) {
  const buffer = new TextEncoder().encode(String(text || ""));
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stableStringify(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortObject(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function getCurrentSettings(elements) {
  return {
    openaiApiKey: elements.apiKey.value.trim(),
    openaiBaseUrl: (elements.baseUrl.value.trim() || defaultBaseUrl).replace(/\/+$/, ""),
    openaiModel: elements.model.value.trim() || defaultModel,
    systemPrompt: elements.systemPrompt.value.trim() || defaultSystemPrompt
  };
}

function buildUserPrompt(payload) {
  const history = Array.isArray(payload?.conversationHistory)
    ? payload.conversationHistory.slice(-8)
    : [];
  const environmentTrail = Array.isArray(payload?.environmentTrail)
    ? payload.environmentTrail.slice(-6)
    : [];
  const sections = [
    "Analyze the current webpage state and help the user make progress.",
    "Prefer the latest page context when it conflicts with older chat history.",
    ""
  ];

  if (history.length) {
    sections.push("Conversation so far:");
    sections.push(
      history
        .map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.text}`)
        .join("\n")
    );
    sections.push("");
  }

  sections.push("Latest user request:");
  sections.push(
    payload?.userInstruction?.trim() || "Explain the current state and suggest the best next action."
  );
  sections.push("");

  if (environmentTrail.length) {
    sections.push("Recent environment navigation trail:");
    sections.push(
      environmentTrail
        .map(
          (item) =>
            `${item.at || ""} switched from "${item.from?.title || item.from?.hostname || "Unknown"}" to "${item.to?.title || item.to?.hostname || "Unknown"}"`
        )
        .join("\n")
    );
    sections.push("");
  }

  if (payload?.includeScreenshot) {
    sections.push("A screenshot of the current page is attached.");
    sections.push("");
  }

  if (payload?.includePageContext) {
    sections.push("Page context JSON:");
    sections.push(JSON.stringify(payload?.pageContext || {}, null, 2));
  } else {
    sections.push("No fresh page context is attached for this turn. Rely on the conversation history.");
  }

  return sections.filter(Boolean).join("\n");
}

async function streamAnalyze({ settings, payload, onDelta }) {
  if (!settings.openaiApiKey) {
    throw new Error("Missing OpenAI API key. Open the side panel settings and save your API key first.");
  }

  const userContent = [
    {
      type: "input_text",
      text: buildUserPrompt(payload)
    }
  ];

  if (payload.includeScreenshot && payload.screenshotDataUrl) {
    userContent.push({
      type: "input_image",
      image_url: payload.screenshotDataUrl
    });
  }

  const response = await fetch(`${settings.openaiBaseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.openaiApiKey}`
    },
    body: JSON.stringify({
      model: settings.openaiModel || defaultModel,
      stream: true,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: settings.systemPrompt || defaultSystemPrompt
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

  const contentType = response.headers.get("content-type") || "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    const data = await response.json();
    return {
      text: extractTextFromResponseData(data),
      usage: data.usage || null,
      model: data.model || settings.openaiModel || defaultModel
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let finalText = "";
  let finalUsage = null;
  let finalModel = settings.openaiModel || defaultModel;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const eventBlock of events) {
      const parsed = parseSseEvent(eventBlock);
      if (!parsed) {
        continue;
      }

      if (parsed.type === "response.output_text.delta" && parsed.delta) {
        finalText += parsed.delta;
        onDelta(parsed.delta);
      }

      if (parsed.type === "response.completed") {
        if (parsed.response?.usage) {
          finalUsage = parsed.response.usage;
        }
        if (parsed.response?.model) {
          finalModel = parsed.response.model;
        }
        const completedText = extractTextFromResponseData(parsed.response || {});
        if (!finalText && completedText) {
          finalText = completedText;
        }
      }

      if (parsed.type === "error") {
        throw new Error(parsed.error?.message || "Streaming request failed.");
      }
    }
  }

  return {
    text: finalText,
    usage: finalUsage,
    model: finalModel
  };
}

function parseSseEvent(block) {
  const lines = block.split("\n");
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  const raw = dataLines.join("\n").trim();
  if (!raw || raw === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractTextFromResponseData(data) {
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

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getEnvironmentTrail() {
  const response = await chrome.runtime.sendMessage({
    type: "SENSA_GET_ENV_TRAIL"
  });

  if (!response?.ok) {
    return [];
  }

  return Array.isArray(response.trail) ? response.trail : [];
}
