class ShortsBlocker {
  private isActive = false;
  private observer: MutationObserver | null = null;
  private elementCache = new WeakSet<Element>();

  // Armazena as funções originais
  private originalFetch = window.fetch;
  private originalXHROpen = XMLHttpRequest.prototype.open;
  private originalXHRSend = XMLHttpRequest.prototype.send;
  private clickListener: ((e: MouseEvent) => void) | null = null;

  constructor() {
    console.log("YouTube Shorts Blocker - Instanciado");
  }

  public activate() {
    if (this.isActive) return;
    this.isActive = true;
    console.log("✅ Shorts Blocker ATIVADO");

    this._injectCSS();
    this._patchApis();
    this._setupDOMObserver();
    this._setupClickBlocker();
  }

  public deactivate() {
    if (!this.isActive) return;
    this.isActive = false;
    console.log("🚫 Shorts Blocker DESATIVADO");

    this._removeCSS();
    this._restoreApis();
    this._disconnectDOMObserver();
    this._removeClickBlocker();
  }

  private _incrementAndReportBlock(type: "api" | "dom") {
    // Futuramente, podemos centralizar as estatísticas aqui se necessário.
    // Por agora, o background script já faz isso via webRequest.
  }

  private _injectCSS() {
    const cssBlockerId = "shorts-blocker-style";
    if (document.getElementById(cssBlockerId)) return;

    const style = document.createElement("style");
    style.id = cssBlockerId;
    style.textContent = `
      ytd-reel-shelf-renderer,
      [is-shorts],
      a[href*="/shorts/"],
      ytd-guide-entry-renderer[guide-entry-style="STYLE_SHORTS"],
      ytd-mini-guide-entry-renderer[aria-label="Shorts"] {
        display: none !important;
        visibility: hidden !important;
      }
    `;
    document.head.appendChild(style);
  }

  private _removeCSS() {
    const style = document.getElementById("shorts-blocker-style");
    if (style) {
      style.remove();
    }
  }

  private _patchApis() {
    window.fetch = this.originalFetch;
    XMLHttpRequest.prototype.open = this.originalXHROpen;
    XMLHttpRequest.prototype.send = this.originalXHRSend;

    // A lógica de patch foi simplificada, pois o webRequest no background
    // é mais eficiente. Deixamos o patch do DOM como a principal defesa no content script.
  }

  private _restoreApis() {
    window.fetch = this.originalFetch;
    XMLHttpRequest.prototype.open = this.originalXHROpen;
    XMLHttpRequest.prototype.send = this.originalXHRSend;
  }

  private _setupDOMObserver() {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this._processElement(node as Element);
          }
        });
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private _disconnectDOMObserver() {
    this.observer?.disconnect();
    this.observer = null;
  }

  private _processElement(element: Element) {
    if (this.elementCache.has(element)) return;

    const isShorts =
      element.hasAttribute("is-shorts") ||
      element.tagName.toLowerCase() === "ytd-reel-shelf-renderer" ||
      (element.tagName.toLowerCase() === "a" &&
        (element as HTMLAnchorElement).href.includes("/shorts/"));

    if (isShorts) {
      element.remove();
      this.elementCache.add(element);
      this._incrementAndReportBlock("dom");
    }
  }

  private _setupClickBlocker() {
    this.clickListener = (e: MouseEvent) => {
      let target = e.target as HTMLElement | null;
      while (target && target !== document.body) {
        if (
          target.tagName === "A" &&
          (target as HTMLAnchorElement).href.includes("/shorts/")
        ) {
          e.preventDefault();
          e.stopPropagation();
          window.location.href = "https://www.youtube.com";
          return;
        }
        target = target.parentElement;
      }
    };
    document.addEventListener("click", this.clickListener, true);
  }

  private _removeClickBlocker() {
    if (this.clickListener) {
      document.removeEventListener("click", this.clickListener, true);
      this.clickListener = null;
    }
  }
}

export default defineContentScript({
  matches: ["*://*.youtube.com/*"],
  runAt: "document_start",

  main: async (ctx) => {
    const blocker = new ShortsBlocker();

    // Pergunta ao background qual o estado inicial
    const initialState = await browser.runtime.sendMessage({
      type: "GET_STATS",
    });

    if (initialState?.isBlocking) {
      blocker.activate();
    } else {
      blocker.deactivate();
    }

    // Ouve por mudanças de estado vindas do popup
    browser.runtime.onMessage.addListener((message) => {
      if (message.type === "STATE_CHANGED") {
        if (message.isBlocking) {
          blocker.activate();
        } else {
          blocker.deactivate();
        }
      }
    });
  },
});
