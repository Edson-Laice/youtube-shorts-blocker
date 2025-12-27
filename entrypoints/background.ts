export default defineBackground(() => {
  // Estado inicial
  let isBlocking = true;
  let stats = {
    totalBlocked: 0,
    apiBlocks: 0,
    domBlocks: 0,
    redirects: 0,
  };

  // --- Gerenciamento de Estado ---

  async function saveState() {
    await browser.storage.local.set({ isBlocking, stats });
    console.log("💾 Estado salvo:", { isBlocking, stats });
  }

  async function loadState() {
    const result = await browser.storage.local.get(["isBlocking", "stats"]);
    if (result.isBlocking !== undefined) {
      isBlocking = result.isBlocking;
    }
    if (result.stats) {
      // Limpa para garantir que não haja propriedades undefined
      stats = {
        totalBlocked: result.stats.totalBlocked || 0,
        apiBlocks: result.stats.apiBlocks || 0,
        domBlocks: result.stats.domBlocks || 0,
        redirects: result.stats.redirects || 0,
      };
    }
    console.log("📁 Estado carregado:", { isBlocking, stats });
  }

  // Envia o estado atual para o popup
  function broadcastState() {
    browser.runtime
      .sendMessage({
        type: "STATS_UPDATE",
        stats: {
          ...stats,
          isBlocking,
          lastUpdated: new Date().toLocaleTimeString(),
        },
      })
      .catch(() => {
        // Ignora o erro que ocorre se o popup não estiver aberto
      });
  }

  // --- Lógica Principal ---

  // Função para atualizar estatísticas
  function updateStats(type: "api" | "dom" | "redirect") {
    stats.totalBlocked++;
    if (type === "api") stats.apiBlocks++;
    if (type === "dom") stats.domBlocks++;
    if (type === "redirect") stats.redirects++;
    saveState();
    broadcastState();
  }

  // --- Listeners de Bloqueio ---

  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!isBlocking) return;

      const isShortsUrl =
        details.url.includes("/shorts/") &&
        (details.url.includes("youtube.com") ||
          details.url.includes("youtu.be"));

      if (isShortsUrl && details.type === "main_frame") {
        console.log(`🚫 Redirecionando Short: ${details.url}`);
        updateStats("redirect");
        return { redirectUrl: "https://www.youtube.com/" };
      }
    },
    {
      urls: ["*://*.youtube.com/*", "*://*.youtu.be/*"],
      types: ["main_frame"],
    },
    ["blocking"]
  );

  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!isBlocking) return;

      const url = details.url.toLowerCase();
      const shortsApiPatterns = [
        /\/youtubei\/v1\/reel\/reel_watch_sequence/,
        /\/youtubei\/v1\/reel\/reel_item_watch/,
        /\/youtubei\/v1\/shorts\//,
        /\/youtubei\/v1\/browse.*shorts/i,
        /\/youtubei\/v1\/next.*shorts/i,
        /reelItems.*shorts/i,
        /reelWatchSequence/i,
        /\/get_reel_watch_sequence/,
        /\/get_shorts_sequence/i,
      ];

      for (const pattern of shortsApiPatterns) {
        if (pattern.test(url)) {
          console.log(`🚫 Bloqueando API de Shorts: ${details.url}`);
          updateStats("api");
          return { cancel: true };
        }
      }

      if (details.requestBody) {
        try {
          const requestBody = String.fromCharCode.apply(
            null,
            new Uint8Array(details.requestBody.raw?.[0]?.bytes || [])
          );

          if (
            requestBody.toLowerCase().includes("shorts") ||
            requestBody.includes("REEL") ||
            requestBody.includes("reelItems")
          ) {
            console.log(`🚫 Bloqueando requisição com corpo de Shorts`);
            updateStats("api");
            return { cancel: true };
          }
        } catch (e) {}
      }
    },
    {
      urls: ["*://*.youtube.com/*"],
      types: ["xmlhttprequest"],
    },
    ["blocking", "requestBody"]
  );

  // --- Comunicação com Popup ---

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_STATS") {
      loadState().then(() => {
        sendResponse({
          ...stats,
          isBlocking,
          lastUpdated: new Date().toLocaleTimeString(),
        });
      });
      return true; // Mantém a mensagem aberta para resposta assíncrona
    }

    if (message.type === "RESET_STATS") {
      stats = { totalBlocked: 0, apiBlocks: 0, domBlocks: 0, redirects: 0 };
      saveState();
      broadcastState();
      sendResponse({ success: true });
    }

    if (message.type === "TOGGLE_EXTENSION") {
      isBlocking = !isBlocking;
      console.log("Toggled blocking to:", isBlocking);
      saveState();
      broadcastState(); // Envia o novo estado para a UI
      sendResponse({ success: true });
    }
  });

  // Inicialização
  loadState().then(() => {
    console.log("✅ YouTube Shorts Blocker ativo!");
  });
});
