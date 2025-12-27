export default defineContentScript({
  matches: ["*://*.youtube.com/*"],
  cssInjectionMode: "ui",
  runAt: "document_start",

  async main() {
    console.log("YouTube Shorts Blocker - Iniciando");

    // Verifica se a extensão está ativa no IndexDB
    const isActive = await checkExtensionState();

    if (!isActive) {
      console.log("🚫 Extensão desativada - Saindo");
      return;
    }

    console.log("✅ Extensão ativa - Iniciando bloqueio");

    // 1. BLOQUEIO VIA CSS NO CARREGAMENTO
    injectCSSBlocker();

    // 2. MONKEY PATCHING DE FETCH/XHR
    const originalFetch = window.fetch;
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    setupFetchMonkeyPatch(originalFetch);
    setupXHRMonkeyPatch(originalXHROpen, originalXHRSend);

    console.log("✅ Monkey patching de APIs aplicado");

    // 3. CONTADOR DE BLOQUEIOS
    let blockedCount = {
      dom: 0,
      fetch: 0,
      xhr: 0,
      clicks: 0,
    };

    // 4. BLOQUEIO DE MUTAÇÕES DO DOM
    const elementCache = new WeakSet();
    const observer = setupDOMMutationObserver(elementCache, blockedCount);

    // 5. BLOQUEIO DE CLICKS
    setupClickBlocker(blockedCount);

    // 6. BLOQUEIO DE NAVEGAÇÃO SPA
    setupSPANavigationBlocker();

    // 7. VERIFICAÇÃO PERIÓDICA
    const checkInterval = setupPeriodicCheck(elementCache, blockedCount);

    // 8. SALVA ESTATÍSTICAS PERIODICAMENTE
    const statsInterval = setInterval(async () => {
      await saveBlockedCount(blockedCount);
      // Reseta contadores após salvar
      blockedCount = { dom: 0, fetch: 0, xhr: 0, clicks: 0 };
    }, 10000); // Salva a cada 10 segundos

    // 9. LIMPEZA
    setupCleanup(
      checkInterval,
      statsInterval,
      observer,
      originalFetch,
      originalXHROpen,
      originalXHRSend
    );

    console.log("✅ Bloqueador de Shorts totalmente ativo");
  },
});

// ==================== FUNÇÕES AUXILIARES ====================

/**
 * Verifica estado da extensão no IndexDB
 */
async function checkExtensionState(): Promise<boolean> {
  return new Promise((resolve) => {
    const request = indexedDB.open("youtubeShortsBlocker", 2);

    request.onsuccess = () => {
      const db = request.result;

      try {
        const transaction = db.transaction(["extensionState"], "readonly");
        const store = transaction.objectStore("extensionState");
        const getRequest = store.get("extensionState");

        getRequest.onsuccess = () => {
          if (getRequest.result) {
            const state = getRequest.result;
            console.log("📁 Estado encontrado:", state.isActive);
            resolve(state.isActive);
          } else {
            console.log("📁 Estado padrão (ativo)");
            resolve(true); // Padrão: ativo
          }
        };

        getRequest.onerror = () => {
          console.log("📁 Erro ao ler estado, usando padrão");
          resolve(true);
        };
      } catch (error) {
        console.log("📁 IndexDB não acessível, usando padrão");
        resolve(true);
      }
    };

    request.onerror = () => {
      console.log("📁 IndexDB não disponível, usando padrão");
      resolve(true);
    };

    // Timeout de segurança
    setTimeout(() => {
      console.log("📁 Timeout IndexDB, usando padrão");
      resolve(true);
    }, 1000);
  });
}

/**
 * Injeta CSS para bloquear elementos
 */
function injectCSSBlocker(): void {
  const cssBlocker = `
    <style id="shorts-blocker-css">
      /* Bloqueio TOTAL via CSS - ANTES de qualquer renderização */
      ytd-reel-shelf-renderer,
      ytd-shorts,
      #shorts-player,
      .shorts-player,
      ytd-reel-item-renderer,
      reel-shelf-view-model,
      grid-shelf-view-model[data-is-shorts],
      [is-shorts],
      [data-is-shorts],
      [href*="/shorts/"],
      a[href*="/shorts/"],
      ytd-rich-section-renderer:has(ytd-reel-shelf-renderer),
      ytd-rich-section-renderer:has([href*="/shorts/"]),
      ytd-guide-entry-renderer[href*="/shorts"],
      ytd-mini-guide-entry-renderer[href*="/shorts"],
      yt-chip-cloud-chip-renderer.iron-selected:has([title*="Shorts" i]),
      yt-chip-cloud-chip-renderer[aria-label*="Shorts" i].iron-selected {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        opacity: 0 !important;
        pointer-events: none !important;
        position: absolute !important;
        left: -9999px !important;
        contain: strict !important;
      }
      
      /* Remove espaço vazio ANTES do JS carregar */
      ytd-rich-section-renderer:empty {
        min-height: 0 !important;
        height: 0 !important;
      }
    </style>
  `;

  if (!document.getElementById("shorts-blocker-css")) {
    document.head.insertAdjacentHTML("beforeend", cssBlocker);
  }
}

/**
 * Configura monkey patch para fetch
 */
function setupFetchMonkeyPatch(originalFetch: typeof window.fetch): void {
  const SHORTS_API_PATTERNS = [
    /\/youtubei\/v1\/reel\//,
    /\/youtubei\/v1\/shorts\//,
    /\/youtubei\/v1\/browse.*shorts/i,
    /reelItems/,
    /reelWatchSequence/,
    /get_reel_watch_sequence/,
    /get_shorts_sequence/,
    /\/browse.*params.*shorts/i,
  ];

  window.fetch = function (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : (input as Request).url;

    // Verifica se é requisição de Shorts
    for (const pattern of SHORTS_API_PATTERNS) {
      if (pattern.test(url)) {
        console.log("🚫 Bloqueando fetch para Shorts:", url);

        // Incrementa contador
        incrementBlockedCount("fetch");

        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 404,
                message: "Shorts bloqueados",
                status: "NOT_FOUND",
              },
            }),
            {
              status: 404,
              statusText: "Not Found",
              headers: { "Content-Type": "application/json" },
            }
          )
        );
      }
    }

    // Verifica corpo da requisição
    if (init?.body) {
      const bodyStr =
        typeof init.body === "string"
          ? init.body
          : init.body instanceof FormData
          ? "FormData"
          : init.body instanceof ArrayBuffer
          ? "ArrayBuffer"
          : "Unknown";

      if (
        bodyStr.toLowerCase().includes("shorts") ||
        bodyStr.includes("REEL") ||
        bodyStr.includes("reelItems")
      ) {
        console.log("🚫 Bloqueando fetch com corpo de Shorts");
        incrementBlockedCount("fetch");

        return Promise.resolve(
          new Response(JSON.stringify({ contents: [] }), {
            headers: { "Content-Type": "application/json" },
          })
        );
      }
    }

    return originalFetch.apply(this, arguments as any);
  };
}

/**
 * Configura monkey patch para XMLHttpRequest
 */
function setupXHRMonkeyPatch(
  originalXHROpen: typeof XMLHttpRequest.prototype.open,
  originalXHRSend: typeof XMLHttpRequest.prototype.send
): void {
  const SHORTS_API_PATTERNS = [
    /\/youtubei\/v1\/reel\//,
    /\/youtubei\/v1\/shorts\//,
    /\/youtubei\/v1\/browse.*shorts/i,
    /reelItems/,
    /reelWatchSequence/,
    /get_reel_watch_sequence/,
    /get_shorts_sequence/,
    /\/browse.*params.*shorts/i,
  ];

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL) {
    const urlStr = typeof url === "string" ? url : url.href;

    for (const pattern of SHORTS_API_PATTERNS) {
      if (pattern.test(urlStr)) {
        console.log("🚫 Bloqueando XHR para Shorts:", urlStr);

        // Sobrescreve send para retornar dados falsos
        this.send = function () {
          // Dispara evento de load com dados falsos
          setTimeout(() => {
            if (this.onload) {
              this.responseText = JSON.stringify({ contents: [] });
              this.status = 200;
              this.onload.call(this, new Event("load"));

              // Incrementa contador
              incrementBlockedCount("xhr");
            }
          }, 10);
        };

        return;
      }
    }

    return originalXHROpen.apply(this, arguments as any);
  };

  XMLHttpRequest.prototype.send = function (
    body?: Document | XMLHttpRequestBodyInit | null
  ) {
    if (body) {
      const bodyStr = typeof body === "string" ? body : "Binary data";

      if (
        bodyStr.toLowerCase().includes("shorts") ||
        bodyStr.includes("REEL") ||
        bodyStr.includes("reelItems")
      ) {
        console.log("🚫 Bloqueando XHR com corpo de Shorts");

        // Retorna dados falsos
        setTimeout(() => {
          if (this.onload) {
            this.responseText = JSON.stringify({
              contents: [],
              responseContext: {
                serviceTrackingParams: [],
              },
            });
            this.status = 200;
            this.onload.call(this, new Event("load"));

            // Incrementa contador
            incrementBlockedCount("xhr");
          }
        }, 10);
        return;
      }
    }

    return originalXHRSend.apply(this, arguments as any);
  };
}

/**
 * Configura observer para mutações do DOM
 */
function setupDOMMutationObserver(
  elementCache: WeakSet<Element>,
  blockedCount: any
): MutationObserver {
  const processElement = (element: Element): void => {
    if (elementCache.has(element)) return;

    // Verificações rápidas
    const tagName = element.tagName.toLowerCase();
    const attrs = element.attributes;

    // Verifica por atributos de Shorts
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      if (
        attr.value.includes("/shorts/") ||
        attr.value.toLowerCase().includes("shorts")
      ) {
        element.remove();
        elementCache.add(element);
        incrementBlockedCount("dom");
        return;
      }
    }

    // Verifica conteúdo
    const text = element.textContent?.toLowerCase() || "";
    if (
      text.includes("shorts") &&
      (tagName.includes("chip") || tagName.includes("tab"))
    ) {
      element.remove();
      elementCache.add(element);
      incrementBlockedCount("dom");
      return;
    }

    // Verifica elementos específicos do YouTube
    if (
      tagName === "ytd-reel-shelf-renderer" ||
      tagName === "ytd-shorts" ||
      tagName === "ytd-reel-item-renderer" ||
      (tagName === "ytd-rich-section-renderer" && text.includes("shorts"))
    ) {
      element.remove();
      elementCache.add(element);
      incrementBlockedCount("dom");
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          processElement(node as Element);

          // Processa filhos
          const elements = (node as Element).querySelectorAll(
            'ytd-reel-shelf-renderer, ytd-shorts, [href*="/shorts/"], yt-chip-cloud-chip-renderer.iron-selected'
          );

          elements.forEach(processElement);
        }
      }
    }
  });

  const observerConfig = {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false,
  };

  if (document.body) {
    observer.observe(document.body, observerConfig);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, observerConfig);
    });
  }

  return observer;
}

/**
 * Configura bloqueio de cliques
 */
function setupClickBlocker(blockedCount: any): void {
  document.addEventListener(
    "click",
    (e) => {
      let target = e.target as HTMLElement;

      // Verifica até 3 níveis acima (para performance)
      for (let i = 0; i < 3; i++) {
        if (!target) break;

        if (
          target.tagName === "A" &&
          target.getAttribute("href")?.includes("/shorts/")
        ) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          // Redireciona para página inicial
          if (window.location.pathname.includes("/shorts/")) {
            window.location.href = "https://www.youtube.com/";
          }

          incrementBlockedCount("clicks");
          return false;
        }

        target = target.parentElement as HTMLElement;
      }
    },
    true
  );
}

/**
 * Configura bloqueio de navegação SPA
 */
function setupSPANavigationBlocker(): void {
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;

      // Bloqueia navegação para Shorts
      if (location.pathname.includes("/shorts/")) {
        history.replaceState(null, "", "https://www.youtube.com/");
        location.href = "https://www.youtube.com/";
      }
    }
  });

  urlObserver.observe(document, {
    subtree: true,
    childList: true,
  });

  // Guarda referência para limpeza
  (window as any).__shortsBlocker_urlObserver = urlObserver;
}

/**
 * Configura verificação periódica
 */
function setupPeriodicCheck(
  elementCache: WeakSet<Element>,
  blockedCount: any
): NodeJS.Timeout {
  return setInterval(() => {
    // Verifica apenas elementos visíveis
    const visibleShorts = document.querySelectorAll(
      'ytd-reel-shelf-renderer:not([style*="display: none"]), ' +
        '[href*="/shorts/"]:not([style*="display: none"])'
    );

    visibleShorts.forEach((element) => {
      if (!elementCache.has(element)) {
        element.remove();
        elementCache.add(element);
        incrementBlockedCount("dom");
      }
    });
  }, 3000);
}

/**
 * Incrementa contador de bloqueios
 */
function incrementBlockedCount(type: "dom" | "fetch" | "xhr" | "clicks"): void {
  // Esta função será sobrescrita no main()
}

/**
 * Salva contagem de bloqueios no IndexDB
 */
async function saveBlockedCount(blockedCount: any): Promise<void> {
  if (
    blockedCount.dom +
      blockedCount.fetch +
      blockedCount.xhr +
      blockedCount.clicks ===
    0
  ) {
    return; // Nada para salvar
  }

  return new Promise((resolve) => {
    const request = indexedDB.open("youtubeShortsBlocker", 2);

    request.onsuccess = () => {
      const db = request.result;

      try {
        const transaction = db.transaction(["stats"], "readwrite");
        const store = transaction.objectStore("stats");

        // Pega estatísticas atuais
        const getRequest = store.get("contentStats");

        getRequest.onsuccess = () => {
          let currentStats = getRequest.result || {
            id: "contentStats",
            totalBlocked: 0,
            domBlocks: 0,
            fetchBlocks: 0,
            xhrBlocks: 0,
            clickBlocks: 0,
            lastUpdated: new Date().toISOString(),
          };

          // Atualiza contagem
          currentStats.totalBlocked +=
            blockedCount.dom +
            blockedCount.fetch +
            blockedCount.xhr +
            blockedCount.clicks;
          currentStats.domBlocks += blockedCount.dom;
          currentStats.fetchBlocks += blockedCount.fetch;
          currentStats.xhrBlocks += blockedCount.xhr;
          currentStats.clickBlocks += blockedCount.clicks;
          currentStats.lastUpdated = new Date().toISOString();

          // Salva de volta
          const putRequest = store.put(currentStats);

          putRequest.onsuccess = () => {
            console.log("💾 Estatísticas salvas:", currentStats);
            resolve();
          };

          putRequest.onerror = () => {
            console.error("❌ Erro ao salvar estatísticas");
            resolve();
          };
        };

        getRequest.onerror = () => {
          console.error("❌ Erro ao carregar estatísticas");
          resolve();
        };
      } catch (error) {
        console.error("❌ Erro na transação:", error);
        resolve();
      }
    };

    request.onerror = () => {
      console.error("❌ IndexDB não disponível para salvar estatísticas");
      resolve();
    };
  });
}

/**
 * Configura limpeza de recursos
 */
function setupCleanup(
  checkInterval: NodeJS.Timeout,
  statsInterval: NodeJS.Timeout,
  observer: MutationObserver,
  originalFetch: typeof window.fetch,
  originalXHROpen: typeof XMLHttpRequest.prototype.open,
  originalXHRSend: typeof XMLHttpRequest.prototype.send
): void {
  const cleanup = () => {
    clearInterval(checkInterval);
    clearInterval(statsInterval);
    observer.disconnect();

    // Desconecta URL observer
    if ((window as any).__shortsBlocker_urlObserver) {
      (window as any).__shortsBlocker_urlObserver.disconnect();
    }

    // Restaura APIs originais
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalXHROpen;
    XMLHttpRequest.prototype.send = originalXHRSend;

    console.log("🧹 Recursos limpos");
  };

  window.addEventListener("unload", cleanup, { once: true });

  // Também limpa quando a página fica oculta
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // Salva estatísticas antes de limpar
      saveBlockedCount({ dom: 0, fetch: 0, xhr: 0, clicks: 0 });
    }
  });
}
