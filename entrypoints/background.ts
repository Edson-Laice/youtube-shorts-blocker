export default defineBackground(() => {
  // Estatísticas iniciais
  let stats = {
    totalBlocked: 0,
    apiBlocks: 0,
    domBlocks: 0,
    redirects: 0,
  };

  // Função para salvar estatísticas no IndexDB
  async function saveStatsToDB(): Promise<void> {
    return new Promise((resolve) => {
      const request = indexedDB.open("youtubeShortsBlocker", 1);

      request.onsuccess = () => {
        const db = request.result;

        try {
          const transaction = db.transaction(["stats"], "readwrite");
          const store = transaction.objectStore("stats");

          const statsData = {
            id: "backgroundStats",
            ...stats,
            lastUpdated: new Date().toISOString(),
          };

          const putRequest = store.put(statsData);

          putRequest.onsuccess = () => {
            console.log("💾 Estatísticas salvas no background:", stats);
            resolve();
          };

          putRequest.onerror = () => {
            console.error("❌ Erro ao salvar estatísticas no background");
            resolve();
          };
        } catch (error) {
          console.error("❌ Erro na transação do background:", error);
          resolve();
        }
      };

      request.onerror = () => {
        console.error("❌ IndexDB não disponível no background");
        resolve();
      };
    });
  }

  // Carrega estatísticas do IndexDB
  async function loadStatsFromDB(): Promise<void> {
    return new Promise((resolve) => {
      const request = indexedDB.open("youtubeShortsBlocker", 1);

      request.onsuccess = () => {
        const db = request.result;

        try {
          const transaction = db.transaction(["stats"], "readonly");
          const store = transaction.objectStore("stats");
          const getRequest = store.get("backgroundStats");

          getRequest.onsuccess = () => {
            if (getRequest.result) {
              stats = getRequest.result;
              console.log("📁 Estatísticas carregadas do background:", stats);
            }
            resolve();
          };

          getRequest.onerror = () => {
            console.log("📁 Nenhuma estatística salva no background");
            resolve();
          };
        } catch (error) {
          console.error(
            "❌ Erro ao carregar estatísticas do background:",
            error
          );
          resolve();
        }
      };

      request.onerror = () => {
        console.error("❌ IndexDB não disponível para carregar");
        resolve();
      };
    });
  }

  // Inicializa carregando estatísticas
  loadStatsFromDB();

  // Função para atualizar estatísticas
  function updateStats(type: "api" | "dom" | "redirect") {
    stats.totalBlocked++;
    if (type === "api") stats.apiBlocks++;
    if (type === "dom") stats.domBlocks++;
    if (type === "redirect") stats.redirects++;

    // Salva no IndexDB
    saveStatsToDB();

    // Envia para popup
    browser.runtime
      .sendMessage({
        type: "STATS_UPDATE",
        stats: { ...stats, lastUpdated: new Date().toLocaleTimeString() },
      })
      .catch(() => {});
  }

  // Bloqueia acesso direto a páginas de Shorts
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      const isShortsUrl =
        details.url.includes("/shorts/") &&
        (details.url.includes("youtube.com") ||
          details.url.includes("youtu.be"));

      if (isShortsUrl && details.type === "main_frame") {
        console.log(`🚫 Bloqueando Short: ${details.url}`);
        updateStats("redirect");

        return {
          redirectUrl: "https://www.youtube.com/",
        };
      }
    },
    {
      urls: ["*://*.youtube.com/*", "*://*.youtu.be/*"],
      types: ["main_frame"],
    },
    ["blocking"]
  );

  // Intercepta requisições de API que buscam Shorts
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      const url = details.url.toLowerCase();
      const shortsApiPatterns = [
        /\/youtubei\/v1\/reel\/reel_watch_sequence/,
        /\/youtubei\/v1\/reel\/reel_item_watch/,
        /\/youtubei\/v1\/shorts\//,
        /\/youtubei\/v1\/browse.*shorts/i,
        /\/youtubei\/v1\/next.*shorts/i,
        /reelItems.*shorts/i,
        /reelWatchSequence/i,
        /\/get_reel_watch_sequence/i,
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

  // Comunicação com popup
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_STATS") {
      // Tenta do IndexDB primeiro
      loadStatsFromDB().then(() => {
        sendResponse({
          ...stats,
          lastUpdated: new Date().toLocaleTimeString(),
        });
      });
      return true; // Mantém a mensagem aberta para resposta assíncrona
    }

    if (message.type === "RESET_STATS") {
      stats = { totalBlocked: 0, apiBlocks: 0, domBlocks: 0, redirects: 0 };
      saveStatsToDB();
      sendResponse({ success: true });
    }

    if (message.type === "TOGGLE_EXTENSION") {
      console.log("Extensão", message.active ? "ativada" : "desativada");

      // Aqui você pode adicionar lógica para realmente ativar/desativar
      // o bloqueio (talvez enviando mensagem para content scripts)

      sendResponse({ success: true });
    }
  });

  console.log("✅ YouTube Shorts Blocker ativo com IndexDB!");
});
