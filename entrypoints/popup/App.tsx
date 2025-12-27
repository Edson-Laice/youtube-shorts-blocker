import { useState, useEffect } from "react";
import "./App.css";

// Interface para o estado e as estatísticas
interface Stats {
  totalBlocked: number;
  apiBlocks: number;
  domBlocks: number;
  redirects: number;
  isBlocking: boolean; // Adicionado para controlar o estado
  lastUpdated: string;
}

function App() {
  const [stats, setStats] = useState<Stats>({
    totalBlocked: 0,
    apiBlocks: 0,
    domBlocks: 0,
    redirects: 0,
    isBlocking: true,
    lastUpdated: "...",
  });

  // Carrega os dados iniciais e ouve atualizações
  useEffect(() => {
    // Pede os dados iniciais ao background script
    browser.runtime.sendMessage({ type: "GET_STATS" }).then((initialStats) => {
      if (initialStats) {
        setStats(initialStats);
      }
    });

    // Ouve mensagens de atualização do background script
    const messageListener = (message: any) => {
      if (message.type === "STATS_UPDATE") {
        setStats(message.stats);
      }
    };

    browser.runtime.onMessage.addListener(messageListener);

    // Limpa o listener quando o componente é desmontado
    return () => {
      browser.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  // Função para ativar/desativar o bloqueio
  const handleToggleBlocking = () => {
    browser.runtime.sendMessage({ type: "TOGGLE_EXTENSION" });
  };

  // Função para resetar as estatísticas
  const handleResetStats = () => {
    browser.runtime.sendMessage({ type: "RESET_STATS" }).then(() => {
      // Pede os dados atualizados para zerar a UI
      browser.runtime.sendMessage({ type: "GET_STATS" }).then(setStats);
    });
  };

  const statusClass = stats.isBlocking ? "blocking" : "not-blocking";
  const statusText = stats.isBlocking ? "Ativo" : "Pausado";

  return (
    <div className="shots-blocker">
      <div className="blocker-message">
        <div className="message-header">
          Shorts Blocker está {statusText}
        </div>

        <div className="message-content">
          <p className="message-text">
            <strong>{stats.totalBlocked}</strong> Shorts bloqueados até agora.
          </p>
          <p className="message-detail">
            API: {stats.apiBlocks} | DOM: {stats.domBlocks} | Redirects:{" "}
            {stats.redirects}
          </p>
        </div>

        <div className="blocking-status">
          <div
            className={`status-indicator ${statusClass}`}
            onClick={handleToggleBlocking}
          >
            <div className="status-dot"></div>
            <span className="status-text">
              {stats.isBlocking ? "Clique para pausar" : "Clique para ativar"}
            </span>
          </div>
        </div>

        <button
          onClick={handleResetStats}
          style={{ marginTop: "15px", cursor: "pointer" }}
        >
          Resetar Estatísticas
        </button>
      </div>
    </div>
  );
}

export default App;
