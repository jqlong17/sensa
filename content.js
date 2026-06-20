chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GAME_COPILOT_PING") {
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "GAME_COPILOT_CAPTURE_CONTEXT") {
    try {
      sendResponse({ ok: true, context: collectPageContext() });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return true;
  }

  if (message?.type === "GAME_COPILOT_GET_CAPTURE_PAGE_INFO") {
    try {
      sendResponse({
        ok: true,
        info: {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          fullWidth: Math.max(
            document.documentElement.scrollWidth,
            document.body?.scrollWidth || 0,
            window.innerWidth
          ),
          fullHeight: Math.max(
            document.documentElement.scrollHeight,
            document.body?.scrollHeight || 0,
            window.innerHeight
          ),
          devicePixelRatio: window.devicePixelRatio || 1
        }
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return true;
  }

  if (message?.type === "GAME_COPILOT_SCROLL_TO") {
    try {
      window.scrollTo(message.payload?.x || 0, message.payload?.y || 0);
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return true;
  }

  return false;
});

function collectPageContext() {
  const selection = window.getSelection?.()?.toString().trim() || "";
  const visibleText = extractVisibleText(document.body);
  const activeElement = document.activeElement;
  const activeInfo =
    activeElement && activeElement !== document.body
      ? {
          tag: activeElement.tagName,
          id: activeElement.id || "",
          classes: activeElement.className || "",
          text: normalizeText(activeElement.textContent || activeElement.value || "")
        }
      : null;

  return {
    page: {
      title: document.title,
      url: location.href,
      hostname: location.hostname,
      description:
        document.querySelector('meta[name="description"]')?.getAttribute("content") || ""
    },
    selection,
    activeElement: activeInfo,
    headings: collectTextList("h1, h2, h3", 18),
    buttons: collectTextList("button, [role='button']", 24),
    formLabels: collectTextList("label, input, textarea, select", 24),
    tables: collectTables(4),
    lists: collectLists(6),
    gameHints: collectGameHints(),
    siteSpecific: collectSiteSpecificContext(),
    visibleTextExcerpt: visibleText.slice(0, 12000),
    timestamp: new Date().toISOString()
  };
}

function collectTextList(selector, limit) {
  return Array.from(document.querySelectorAll(selector))
    .map((node) => normalizeText(node.textContent || node.value || ""))
    .filter(Boolean)
    .slice(0, limit);
}

function collectTables(limit) {
  return Array.from(document.querySelectorAll("table"))
    .slice(0, limit)
    .map((table) => {
      const rows = Array.from(table.querySelectorAll("tr"))
        .slice(0, 8)
        .map((row) =>
          Array.from(row.querySelectorAll("th, td"))
            .map((cell) => normalizeText(cell.textContent || ""))
            .filter(Boolean)
        )
        .filter((cells) => cells.length);

      return rows;
    })
    .filter((rows) => rows.length);
}

function collectLists(limit) {
  return Array.from(document.querySelectorAll("ul, ol"))
    .slice(0, limit)
    .map((list) =>
      Array.from(list.querySelectorAll(":scope > li"))
        .map((item) => normalizeText(item.textContent || ""))
        .filter(Boolean)
        .slice(0, 12)
    )
    .filter((items) => items.length);
}

function collectGameHints() {
  const candidates = Array.from(
    document.querySelectorAll(
      "[class*='score'], [class*='player'], [class*='turn'], [class*='log'], [class*='action'], [id*='score'], [id*='player'], [id*='turn'], [id*='log'], [id*='action']"
    )
  );

  return candidates
    .map((node) => {
      const text = normalizeText(node.textContent || "");
      if (!text) {
        return null;
      }

      return {
        tag: node.tagName,
        id: node.id || "",
        className: typeof node.className === "string" ? node.className : "",
        text: text.slice(0, 300)
      };
    })
    .filter(Boolean)
    .slice(0, 30);
}

function collectSiteSpecificContext() {
  const hostname = location.hostname;

  if (hostname.includes("boardgamearena.com")) {
    return {
      site: "boardgamearena",
      currentTurnBanner: findFirstText([
        "#pagemaintitletext",
        "#gameaction_status_wrap",
        "#gameaction_status",
        ".gamestate",
        ".current_player_is_active"
      ]),
      actionButtons: collectStructuredNodes(
        ["#generalactions > *", ".bgabutton", ".action-button", "button"],
        20
      ),
      playerPanels: collectStructuredNodes(
        [
          "#right-side-first-part .roundedbox",
          "#players-side .roundedbox",
          ".player-board",
          ".player_score"
        ],
        12
      ),
      logs: collectStructuredNodes(
        ["#logs .log", "#chatwindowlogs .log", ".logitem", "#overall-content .log"],
        24
      ),
      mainBoardRegions: collectStructuredNodes(
        ["#game_play_area > div", "#main_board > div", "#tableau > div", "#page-content .whiteblock"],
        16
      )
    };
  }

  return null;
}

function findFirstText(selectors) {
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    const text = normalizeText(node?.textContent || "");
    if (text) {
      return text;
    }
  }
  return "";
}

function collectStructuredNodes(selectors, limit) {
  const seen = new Set();
  const result = [];

  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector));
    for (const node of nodes) {
      const text = normalizeText(node.textContent || "");
      if (!text) {
        continue;
      }

      const key = `${node.tagName}:${node.id}:${text.slice(0, 120)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      result.push({
        tag: node.tagName,
        id: node.id || "",
        className: typeof node.className === "string" ? node.className : "",
        text: text.slice(0, 500)
      });

      if (result.length >= limit) {
        return result;
      }
    }
  }

  return result;
}

function extractVisibleText(root) {
  if (!root) {
    return "";
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }

      const style = window.getComputedStyle(parent);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      return normalizeText(node.textContent || "")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });

  const parts = [];
  while (walker.nextNode() && parts.length < 500) {
    parts.push(normalizeText(walker.currentNode.textContent || ""));
  }
  return parts.join("\n");
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}
