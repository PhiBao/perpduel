"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, fmtUsd, fmtRoe, storeToken, type Duel, type Standing } from "../lib/api";

const MARKET_LIST = ["BTC", "ETH", "SOL", "HYPE"];

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [market, setMarket] = useState("BTC");
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [duration, setDuration] = useState(60);
  const [notional, setNotional] = useState(100);
  const [markets, setMarkets] = useState<{ symbol: string; markPrice: number }[]>([]);
  const [duels, setDuels] = useState<Duel[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("perpduel_name");
    if (saved) setName(saved);
    const load = async () => {
      try {
        const m: any = await api("/api/markets", undefined, { retries: 1 });
        const ds = await api<Duel[]>("/api/duels", undefined, { retries: 1 });
        const st = await api<Standing[]>("/api/standings", undefined, { retries: 1 });
        setMarkets(m.markets);
        setDuels(ds.filter(d => d.status !== "VOID"));
        setStandings(st);
        setWaking(false);
      } catch {
        setWaking(true);
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  function needName() {
    if (!name.trim()) throw new Error("Enter your fighter name first.");
    localStorage.setItem("perpduel_name", name.trim());
  }

  async function create() {
    setErr(""); setBusy("create");
    try {
      needName();
      const d = await api<Duel>("/api/duels", { method: "POST", body: JSON.stringify({ name: name.trim(), market, side, duration_sec: duration, notional_usd: notional }) });
      storeToken(d.id, d.token);
      router.push(`/duel/${d.id}`);
    } catch (e: any) { setErr(e.message ?? String(e)); setBusy(""); }
  }

  async function instant() {
    setErr(""); setBusy("instant");
    try {
      needName();
      const d = await api<Duel>("/api/duels", { method: "POST", body: JSON.stringify({ name: name.trim(), market, side, duration_sec: 60, notional_usd: notional }) });
      storeToken(d.id, d.token);
      await api(`/api/duels/${d.id}/ghost`, { method: "POST", body: "{}" });
      router.push(`/duel/${d.id}`);
    } catch (e: any) { setErr(e.message ?? String(e)); setBusy(""); }
  }

  return (
    <>
      {waking && markets.length === 0 && (
        <div className="wake">
          <b>Waking the arena…</b> the backend sleeps when idle, so the first request can take up to ~20 seconds.
          This page will fill in by itself.
        </div>
      )}

      <section className="hero">
        <h1><span className="long">Long</span> or <span className="short">Short</span>.<br />Beat a person,<br />not a leaderboard.</h1>
        <p>
          PERPDUEL is a 1v1 perpetuals fight on dreamDEX. Send a challenge link, your rival takes the other side,
          both positions open with <b>real orders on Somnia Tokyo (Hideki 50383) testnet</b>, the PnL race runs live,
          and either fighter can <b>cash out early</b> — or the clock closes both positions on-chain.
          Winner is settled from actual fills, scored as ROE on margin actually locked. Every tx is public proof.
        </p>
        <div className="liveprices">
          {markets.map(m => <span key={m.symbol}>{m.symbol}-PERP mark <b>${m.markPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}</b></span>)}
          <span>FEES <b>zero</b></span><span>MONEY <b>paper USDso</b></span>
          {waking && markets.length > 0 && <span className="dim">reconnecting…</span>}
        </div>
      </section>

      <section className="card">
        <h2>Start a duel</h2>
        <label>Your fighter name (use your @handle to build a record)</label>
        <input type="text" value={name} maxLength={24} onChange={e => setName(e.target.value)} placeholder="e.g. @ROUNDTRIPPER" />
        <label>Market</label>
        <div className="seg">
          {MARKET_LIST.map(s => <button key={s} className={market === s ? "on" : ""} onClick={() => setMarket(s)}>{s}-PERP</button>)}
        </div>
        <label>Your side</label>
        <div className="seg">
          <button className={side === "LONG" ? "on-long" : ""} onClick={() => setSide("LONG")}>▲ Long</button>
          <button className={side === "SHORT" ? "on-short" : ""} onClick={() => setSide("SHORT")}>▼ Short</button>
        </div>
        <label>Size per side (paper USDso)</label>
        <div className="seg">
          {[100, 250, 500].map(s => <button key={s} className={notional === s ? "on" : ""} onClick={() => setNotional(s)}>${s}</button>)}
        </div>
        <label>Clock</label>
        <div className="seg">
          {[[60, "Blitz · 60s"], [300, "5 minutes"], [900, "15 minutes"]].map(([s, l]) => (
            <button key={s} className={duration === s ? "on" : ""} onClick={() => setDuration(s as number)}>{l}</button>
          ))}
        </div>
        <div className="share">
          <button className="btn" disabled={busy === "create"} onClick={create}>{busy === "create" ? "Creating…" : "Create challenge →"}</button>
          <button className="btn danger" disabled={busy === "instant"} onClick={instant}>{busy === "instant" ? "Opening orders…" : "⚡ Instant 60s duel vs Ghost"}</button>
        </div>
        {err && <div className="err">{err}</div>}
        <p style={{ color: "var(--dim)", fontSize: 12, lineHeight: 1.7 }}>
          No wallet. No faucet. No signup. Duels run on two house testnet wallets; one duel runs at a time.
          In a live duel you hold one weapon: <b>CASH OUT</b> — end it now and settle at market, or let the clock decide.
        </p>
      </section>

      {standings.length > 0 && (
        <section className="card">
          <h2>Fighter standings</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="ticker">
              <thead><tr><th>Fighter</th><th>W–L</th><th>Duels</th><th>Net PnL</th><th>Best ROE</th><th>Streak</th></tr></thead>
              <tbody>
                {standings.map(st => (
                  <tr key={st.name}>
                    <td>{st.name}</td><td>{st.wins}–{st.losses}</td><td>{st.duels}</td>
                    <td className={st.pnl_usd >= 0 ? "pos" : "neg"}>{fmtUsd(st.pnl_usd)}</td>
                    <td>{fmtRoe(st.best_roe_pct)}</td>
                    <td>{st.streak > 0 ? `W${st.streak}` : st.streak < 0 ? `L${-st.streak}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Recent duels — proof, not screenshots</h2>
        {duels.length === 0 ? <p style={{ color: "var(--dim)" }}>No duels yet. Be the first name on this board.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table className="ticker">
              <thead><tr><th>Duel</th><th>Market</th><th>Fight</th><th>Result (ROE)</th><th>Winner</th><th>Status</th></tr></thead>
              <tbody>
                {duels.map(d => (
                  <tr key={d.id}>
                    <td><a href={`/duel/${d.id}`}>#{d.id}</a></td>
                    <td>{d.market} · ${d.notional_usd}</td>
                    <td>{d.creator.name} vs {d.opponent?.name ?? "…"}{d.series_score ? ` · ${d.series_score}` : ""}</td>
                    <td><span className={(d.creator.roe_pct ?? 0) >= 0 ? "pos" : "neg"}>{fmtRoe(d.creator.roe_pct)}</span>{" / "}
                      <span className={(d.opponent?.roe_pct ?? 0) >= 0 ? "pos" : "neg"}>{fmtRoe(d.opponent?.roe_pct)}</span></td>
                    <td>{d.winner ?? "—"}</td>
                    <td><span className={`badge ${d.status.toLowerCase()}`}>{d.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
