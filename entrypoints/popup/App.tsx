import { useState, useEffect } from "react";
import "./App.css";

function App() {
  const [isBlocking, setIsBlocking] = useState<boolean>(true);
  const [shotsBlocked, setShotsBlocked] = useState<number>(42);
  const [blockedSites, setBlockedSites] = useState<string[]>([
    "shots.so",
    "dribbble.com/shots",
    "pinterest.com",
  ]);

  // Load initial data from storage
  useEffect(() => {
    const savedBlocked = localStorage.getItem("shotsBlocked");
    const savedSites = localStorage.getItem("blockedSites");

    if (savedBlocked) setShotsBlocked(parseInt(savedBlocked));
    if (savedSites) setBlockedSites(JSON.parse(savedSites));
  }, []);

  // Save to storage
  useEffect(() => {
    localStorage.setItem("shotsBlocked", shotsBlocked.toString());
    localStorage.setItem("blockedSites", JSON.stringify(blockedSites));
  }, [shotsBlocked, blockedSites]);

  // Increment blocked counter (simulating when a site is blocked)
  useEffect(() => {
    if (isBlocking) {
      const interval = setInterval(() => {
        setShotsBlocked((prev) => prev + 1);
      }, 5000); // Increment every 5 seconds to simulate blocking activity

      return () => clearInterval(interval);
    }
  }, [isBlocking]);

  return (
    <div className="shots-blocker">
      <div className="blocker-message">
        <div className="message-header">
          Shots Blocker está {isBlocking ? "Ativo" : "Pausado"}
        </div>
      </div>
    </div>
  );
}

export default App;
