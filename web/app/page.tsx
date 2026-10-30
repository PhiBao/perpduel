"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, fmtUsd, type Duel } from "../lib/api";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [market, setMarket] = useState("BTC");
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [duration, setDuration] = useState(60);
  const [markets, setMarkets] = useState<{ symbol: string; markPrice: number }[]>([]);
  const [duels, setDuels] = useState<Duel[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("perpduel_name");
    if (saved) setName(saved);
    const load = async () => {
      try {
        const m: any = await api("/api/markets");
        setMarkets(m.markets);
        setDuels(await api<Duel[]>("/api/duels"));
      } catch {}
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function create() {
    setErr(""); setBusy(true);
    try {
      if (!name.trim()) throw new Error("Enter your fighter name first.");
      localStorage.setItem("perpduel_name", name.trim());
      const d = await api<Duel>("/api/duels", { method: "POST", body: JSON.stringify({ name: name.trim(), market, side, duration_sec: duration }) });
      router.push(`/duel/${d.id}`);
    } catch (e: any) { setErr(e.message ?? String(e)); setBusy(false); }
  }

  return (
    <>
      <section className="hero">
        <h1><span className="long">Long</span> or <span className="short">Short</span>.<br />Beat a person,<br />not a leaderboard.</h1>
        <p>
          PERPDUEL is a 1v1 perpetuals fight on dreamDEX. Send a challenge link, your rival takes the other side,
          both positions open with <b>real orders on Somnia Hideki testnet</b>, the PnL race runs live, and the clock
          closes both positions on-chain. Winner gets the card. Every tx is public proof.
        </p>
        <div className="liveprices">
          {markets.map(m => <span key={m.symbol}>{m.symbol}-PERP mark <b>${m.markPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}</b></span>)}
          <span>SIZE <b>$100 / side</b></span><span>FEES <b>zero</b></span><span>MONEY <b>paper USDso</b></span>
        </div>
      </section>

      <section className="card">
        <h2>Start a duel</h2>
        <label>Your fighter name</label>
        <input type="text" value={name} maxLength={24} onChange={e => setName(e.target.value)} placeholder="e.g. ROUNDTRIPPER" />
        <label>Market</label>
        <div className="seg">
          {["BTC", "ETH"].map(s => <button key={s} className={market === s ? "on" : ""} onClick={() => setMarket(s)}>{s}-PERP · 20x max</button>)}
        </div>
        <label>Your side</label>
        <div className="seg">
          <button className={side === "LONG" ? "on-long" : ""} onClick={() => setSide("LONG")}>▲ Long</button>
          <button className={side === "SHORT" ? "on-short" : ""} onClick={() => setSide("SHORT")}>▼ Short</button>
        </div>
        <label>Clock</label>
        <div className="seg">
          {[[60, "Blitz · 60s"], [300, "5 minutes"], [900, "15 minutes"]].map(([s, l]) => (
            <button key={s} className={duration === s ? "on" : ""} onClick={() => setDuration(s as number)}>{l}</button>
          ))}
        </div>
        <button className="btn" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create challenge →"}</button>
        {err && <div className="err">{err}</div>}
        <p style={{ color: "var(--dim)", fontSize: 12, lineHeight: 1.7 }}>
          No wallet. No faucet. No signup. The duel runs on two house testnet wallets (yours-long / rival-short settle to them);
          the mainnet form puts each fighter on their own linked-bot wallet. One duel runs at a time.
        </p>
      </section>

      <section className="card">
        <h2>Recent duels — proof, not screenshots</h2>
        {duels.length === 0 ? <p style={{ color: "var(--dim)" }}>No duels yet. Be the first name on this board.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table className="ticker">
              <thead><tr><th>Duel</th><th>Market</th><th>Fight</th><th>PnL</th><th>Winner</th><th>Status</th></tr></thead>
              <tbody>
                {duels.map(d => (
                  <tr key={d.id}>
                    <td><a href={`/duel/${d.id}`}>#{d.id}</a></td>
                    <td>{d.market}</td>
                    <td>{d.creator.name} vs {d.opponent?.name ?? "…"}</td>
                    <td><span className={d.creator.pnl_usd >= 0 ? "pos" : "neg"}>{fmtUsd(d.creator.pnl_usd)}</span>{" / "}
                      <span className={(d.opponent?.pnl_usd ?? 0) >= 0 ? "pos" : "neg"}>{fmtUsd(d.opponent?.pnl_usd ?? 0)}</span></td>
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
