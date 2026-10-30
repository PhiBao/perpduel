"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, fmtUsd, fmtPx, EXPLORER, API, type Duel } from "../../../lib/api";

function useDuel(id: string) {
  const [duel, setDuel] = useState<Duel | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try { const d = await api<Duel>(`/api/duels/${id}`); if (!stop) setDuel(d); }
      catch (e: any) { if (!stop) setErr(e.message ?? String(e)); }
    };
    load();
    const t = setInterval(load, 1000);
    return () => { stop = true; clearInterval(t); };
  }, [id]);
  return { duel, err, setDuel };
}

function TxLinks({ label, hash }: { label: string; hash: string | null }) {
  if (!hash) return <div>{label}: —</div>;
  return <div>{label}: <a href={`${EXPLORER}${hash}`} target="_blank" rel="noreferrer">{hash.slice(0, 10)}…{hash.slice(-6)}</a></div>;
}

export default function DuelPage() {
  const params = useParams();
  const id = String(params.id);
  const { duel, err } = useDuel(id);
  const [joinName, setJoinName] = useState("");
  const [busy, setBusy] = useState("");
  const [actErr, setActErr] = useState("");
  const [now, setNow] = useState(Date.now());
  const myName = useRef<string>("");

  useEffect(() => { myName.current = localStorage.getItem("perpduel_name") ?? ""; setJoinName(myName.current); const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);

  if (err) return <div className="card"><div className="err">{err}</div></div>;
  if (!duel) return <div className="card">Loading duel…</div>;

  const c = duel.creator, o = duel.opponent;
  const endsMs = duel.ends_at ? new Date(duel.ends_at).getTime() : null;
  const remain = endsMs ? Math.max(0, Math.ceil((endsMs - now) / 1000)) : null;
  const totalAbs = Math.abs(c.pnl_usd) + Math.abs(o?.pnl_usd ?? 0);
  const creatorShare = totalAbs < 1e-9 ? 50 : 50 + (c.pnl_usd / (Math.abs(c.pnl_usd) + Math.abs(o?.pnl_usd ?? 0) + 1e-9)) * 50;
  const isCreator = myName.current && myName.current === c.name;
  const challengeUrl = typeof window !== "undefined" ? window.location.href : "";
  const shareText = duel.status === "FINISHED"
    ? `PERPDUEL #${duel.id} on @DreamDEXSomnia — ${c.name} ${fmtUsd(c.pnl_usd)} vs ${o?.name} ${fmtUsd(o?.pnl_usd ?? 0)} on ${duel.market}-PERP. Winner: ${duel.winner}. Real testnet orders, proof on-chain:`
    : `I challenge you to a 1v1 ${duel.market}-PERP duel on @DreamDEXSomnia. I'm ${c.side}. Take the other side — real testnet orders, live PnL race, clock closes both:`;
  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(challengeUrl)}`;

  async function act(kind: "join" | "ghost") {
    setActErr(""); setBusy(kind);
    try {
      if (kind === "join") {
        if (!joinName.trim()) throw new Error("Enter your fighter name.");
        localStorage.setItem("perpduel_name", joinName.trim());
        await api(`/api/duels/${id}/join`, { method: "POST", body: JSON.stringify({ name: joinName.trim() }) });
      } else {
        await api(`/api/duels/${id}/ghost`, { method: "POST", body: "{}" });
      }
    } catch (e: any) { setActErr(e.message ?? String(e)); }
    setBusy("");
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <span className={`badge ${duel.status.toLowerCase()}`}>{duel.status}</span>
        <span style={{ color: "var(--dim)", fontSize: 12 }}>DUEL #{duel.id} · {duel.market}-PERP · ${duel.notional_usd}/side · mark {fmtPx(duel.mark_price)}</span>
      </div>

      <section className="vs">
        <div className={`fighter ${c.side === "LONG" ? "long" : "short"}`}>
          <div className="fname">{c.name}</div>
          <div className="fside">{c.side === "LONG" ? "▲ LONG" : "▼ SHORT"}</div>
          <div className="fpnl" style={{ color: c.pnl_usd >= 0 ? "var(--green)" : "var(--red)" }}>{fmtUsd(c.pnl_usd)}</div>
          <div style={{ fontSize: 13, color: "var(--dim)" }}>{(c.pnl_usd / duel.notional_usd * 100).toFixed(2)}% on ${duel.notional_usd} size</div>
          <div className="fmeta">entry {fmtPx(c.entry_price)} · qty {c.qty ?? "—"} {duel.market}<br />wallet {c.wallet}</div>
        </div>
        <div className="vsmid">
          <div className="vslabel">VS</div>
          <div className="clock">{duel.status === "LIVE" && remain !== null ? `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, "0")}` : duel.status === "FINISHED" ? "OVER" : "—"}</div>
          <div className="mkt">{duel.market}-PERP</div>
        </div>
        <div className={`fighter right ${o ? (o.side === "LONG" ? "long" : "short") : ""}`} style={!o ? { background: "#1a1917" } : undefined}>
          <div className="fname">{o ? o.name : "???"}</div>
          <div className="fside">{o ? (o.side === "LONG" ? "▲ LONG" : "▼ SHORT") : "WAITING FOR A RIVAL"}</div>
          <div className="fpnl" style={{ color: (o?.pnl_usd ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>{o ? fmtUsd(o.pnl_usd) : "—"}</div>
          {o && <div style={{ fontSize: 13, color: "var(--dim)" }}>{(o.pnl_usd / duel.notional_usd * 100).toFixed(2)}% on ${duel.notional_usd} size</div>}
          <div className="fmeta">{o ? <>entry {fmtPx(o.entry_price)} · qty {o.qty ?? "—"} {duel.market}<br />wallet {o.wallet}{o.ghost ? " · house ghost" : ""}</> : "Share the challenge link, or fight the Ghost."}</div>
        </div>
      </section>

      {duel.status === "LIVE" && (
        <>
          <div className="racebar"><div className="rl" style={{ width: `${creatorShare}%` }} /><div className="rr" /></div>
          <div className="racecap"><span>{c.name} {fmtUsd(c.pnl_usd)}</span><span>live race — clock auto-closes both positions on-chain</span><span>{o?.name} {fmtUsd(o?.pnl_usd ?? 0)}</span></div>
        </>
      )}

      {duel.status === "WAITING" && (
        <section className="card">
          <h2>{isCreator ? "Your challenge is live" : `Accept ${c.name}'s challenge`}</h2>
          <p style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.7 }}>
            {c.name} is <b style={{ color: c.side === "LONG" ? "var(--green)" : "var(--red)" }}>{c.side}</b> on {duel.market}-PERP for {duel.duration_sec}s.
            {isCreator ? " Send this link to a rival. The moment they accept, both real testnet orders open." : ` Accepting puts you ${c.side === "LONG" ? "SHORT" : "LONG"} with a real testnet order. No wallet needed.`}
          </p>
          <label>Challenge link</label>
          <input type="text" readOnly value={challengeUrl} onFocus={e => e.target.select()} />
          {!isCreator && (
            <>
              <label>Your fighter name</label>
              <input type="text" value={joinName} maxLength={24} onChange={e => setJoinName(e.target.value)} placeholder="e.g. LIQUIDATOR" />
              <button className="btn danger" disabled={busy === "join"} onClick={() => act("join")}>{busy === "join" ? "Opening orders…" : `Accept & fight (${c.side === "LONG" ? "SHORT" : "LONG"}) →`}</button>
            </>
          )}
          <div>
            <button className="btn ghost" disabled={busy === "ghost"} onClick={() => act("ghost")}>{busy === "ghost" ? "Opening orders…" : "No rival yet? Fight the Ghost →"}</button>
          </div>
          {actErr && <div className="err">{actErr}</div>}
          <div className="share"><a className="btn ghost" href={xUrl} target="_blank" rel="noreferrer">Post challenge on X ↗</a></div>
        </section>
      )}

      {(duel.status === "OPENING" || duel.status === "CLOSING") && <section className="card"><h2>{duel.status === "OPENING" ? "Opening both positions on-chain…" : "Clock's up — closing both positions on-chain…"}</h2></section>}

      {duel.status === "VOID" && (
        <section className="result" style={{ borderColor: "var(--red)", background: "#1d0d11" }}>
          <div className="win" style={{ color: "var(--red)" }}>Duel void</div>
          <p>{duel.void_reason}</p>
          <p style={{ color: "var(--dim)", fontSize: 13 }}>No result was recorded. Any partial position was closed by the executor. This state is shown honestly instead of pretending the duel happened.</p>
          <a className="btn" href="/">Start a new duel</a>
        </section>
      )}

      {duel.status === "FINISHED" && (
        <section className="result">
          <div className="win">★ {duel.winner} takes it ★</div>
          <p style={{ fontSize: 15 }}>{c.name} {fmtUsd(c.pnl_usd)} · {o?.name} {fmtUsd(o?.pnl_usd ?? 0)} — settled by real closing orders, not by a screenshot.</p>
          <div className="share" style={{ justifyContent: "center" }}>
            <a className="btn" href={xUrl} target="_blank" rel="noreferrer">Post result on X ↗</a>
            <a className="btn ghost" href="/">Rematch / new duel</a>
            <a className="btn ghost" href={`${API}/api/duels/${duel.id}/card.svg`} target="_blank" rel="noreferrer">Result card (SVG)</a>
          </div>
        </section>
      )}

      <section className="card proof">
        <h3>Proof — verify it yourself</h3>
        <div>{c.name} ({c.side}, wallet {c.wallet})</div>
        <TxLinks label="open" hash={c.open_tx} /><TxLinks label="close" hash={c.close_tx} />
        <div>entry {fmtPx(c.entry_price)} → exit {fmtPx(c.exit_price)} · qty {c.qty ?? "—"} {duel.market} · PnL {fmtUsd(c.pnl_usd)}</div>
        {o && (<>
          <div style={{ marginTop: 8 }}>{o.name} ({o.side}, wallet {o.wallet}){o.ghost ? " — house Ghost wallet, disclosed" : ""}</div>
          <TxLinks label="open" hash={o.open_tx} /><TxLinks label="close" hash={o.close_tx} />
          <div>entry {fmtPx(o.entry_price)} → exit {fmtPx(o.exit_price)} · qty {o.qty ?? "—"} {duel.market} · PnL {fmtUsd(o.pnl_usd)}</div>
        </>)}
        <div style={{ marginTop: 8, color: "var(--dim)" }}>PnL = (exit − entry) × signed qty, from actual fill prices. Funding over minutes is negligible and excluded — stated, not hidden. Chain: Somnia Hideki 50383 via @somnia-chain/markets-sdk.</div>
      </section>
    </>
  );
}
