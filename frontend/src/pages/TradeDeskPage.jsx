// TradeDesk — standalone page mounted at /tradedesk. Loads the user's
// cards + executed-trade history once on mount and hands them down to
// the TradeTab UI.
//
// On a successful trade-confirm, navigates to /portfolio?tab=collection with
// a pulse=<ids> query param. PortfolioPage reads that param, applies
// the gold-pulse highlight to the matching tiles for 3s, then strips
// the param from the URL.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCards, listTrades } from "../services/api.js";
import TradeTab from "../components/TradeTab.jsx";

export default function TradeDeskPage() {
  const navigate = useNavigate();
  const [cards,         setCards]         = useState([]);
  const [pastTrades,    setPastTrades]    = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError,   setHistoryError]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCards(), listTrades()])
      .then(([cardsData, trades]) => {
        if (cancelled) return;
        setCards(cardsData);
        setPastTrades(trades);
        setLoading(false);
        setHistoryLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
        setHistoryError(e.message);
        setLoading(false);
        setHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  function handleTradeComplete(newCardIds) {
    // Refresh history so the new trade lands in Past Trades on the
    // user's next visit to TradeDesk.
    listTrades().then(setPastTrades).catch(() => {});
    // Navigate back to the portfolio's My Collection tab. The pulse param
    // is read by PortfolioPage to drive the gold highlight effect.
    const params = new URLSearchParams({ tab: "collection" });
    if (newCardIds && newCardIds.length > 0) {
      params.set("pulse", newCardIds.join(","));
    }
    navigate(`/portfolio?${params.toString()}`);
  }

  return (
    <>
      <header style={st.header}>
        <p style={st.eyebrow}>
          <span style={st.dot} />
          TradeDesk
          <span style={st.beta}>BETA</span>
        </p>
        <h1 style={st.title}>Build, execute, and review trades.</h1>
      </header>

      {loading ? (
        <div style={st.loading}>Loading your portfolio…</div>
      ) : error ? (
        <div style={st.error}>Error: {error}</div>
      ) : (
        <TradeTab
          cards={cards}
          pastTrades={pastTrades}
          historyLoading={historyLoading}
          historyError={historyError}
          onTradeComplete={handleTradeComplete}
        />
      )}
    </>
  );
}

const st = {
  header: { marginBottom: "1.5rem" },
  eyebrow: {
    display: "flex", alignItems: "center", gap: "0.5rem",
    fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.18em",
    textTransform: "uppercase", color: "#e6c463", margin: 0,
  },
  dot: {
    width: 8, height: 8, borderRadius: "50%",
    background: "#d4af37",
    boxShadow: "0 0 8px rgba(212,175,55,0.8)",
  },
  beta: {
    display: "inline-block",
    fontSize: "8px", lineHeight: 1,
    padding: "2px 4px", borderRadius: 3,
    background: "#d4af37", color: "#000",
    fontWeight: 700, letterSpacing: "0.5px",
    verticalAlign: "super",
    position: "relative", top: "-0.2em",
  },
  title: {
    fontSize: "1.6rem", fontWeight: 800,
    color: "#f1f5f9",
    letterSpacing: "-0.02em",
    margin: "0.6rem 0 0",
  },
  loading: { color: "#94a3b8", fontSize: "0.9rem", padding: "2rem 0" },
  error:   { color: "#f87171",  fontSize: "0.9rem", padding: "2rem 0" },
};
