"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, fmtUsd, fmtRoe, fmtPx, EXPLORER, API, loadToken, storeToken, type Duel } from "../../../lib/api";

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
  return { duel, err };
}

function TxLinks({ label, hash }: { label: string; hash: string | null }) {
  if (!hash) return <div>{label}: —</div>;
  return <div>{label}: <a href={`${EXPLORER}${hash}`} target="_blank" rel="noreferrer">{hash.slice(0, 10)}…{hash.slice(-6)}</a></div>;
}

function Tape({ duel }: { duel: Duel }) {
  const hist = duel.price_history ?? [];
  if (hist.length < 2) return null;
  const prices = hist.map(h => h[1]);
  const entries = [duel.creator.entry_price, duel.opponent?.entry_price].filter((x): x is number => !!x);
  const min = Math.min(...prices, ...entries), max = Math.max(...prices, ...entries);
  const span = max - min || 1;
  const W = 640, H = 130, pad = 6;
  const x = (i: number) => pad + (i / (hist.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - pad * 2);
  const pts = hist.map((h, i) => `${x(i)},${y(h[1])}`).join(" ");
  return (
    <div style={{ marginTop: 18 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", background: "#0a0a0a", border: "1px solid var(--line)" }} preserveAspectRatio="none">
        {duel.creator.entry_price && <line x1={0} x2={W} y1={y(duel.creator.entry_price)} y2={y(duel.creator.entry_price)} stroke="#3dff7a" strokeDasharray="5,4" strokeWidth="1" />}
        {duel.opponent?.entry_price && <line x1={0} x2={W} y1={y(duel.opponent.entry_price)} y2={y(duel.opponent.entry_price)} stroke="#ff3b5c" strokeDasharray="5,4" strokeWidth="1" />}
        <polyline points={pts} fill="none" stroke="#f5f0e6" strokeWidth="1.6" />
      </svg>
      <div className="racecap"><span>price tape · dashed = entries</span><span>low {fmtPx(min)} · high {fmtPx(max)}</span></div>
    </div>
  );
}

function FighterCard({ p, duel, align }: { p: Duel["creator"]; duel: Duel; align?: "right" }) {
  return (
    <div className={`fighter ${align ? "right" : ""} ${p.side === "LONG" ? "long" : "short"}`}>
      <div className="fname">{p.name}{p.cashed_out ? " · CHICKEN" : ""}</div>
      <div className="fside">{p.side === "LONG" ? "▲ LONG" : "▼ SHORT"}</div>
      <div className="fpnl" style={{ color: p.pnl_usd >= 0 ? "var(--green)" : "var(--red)" }}>{fmtRoe(p.roe_pct)}</div>
      <div style={{ fontSize: 14 }}>{fmtUsd(p.pnl_usd)} · on ${duel.notional_usd} size</div>
      <div className="fmeta">
        entry {fmtPx(p.entry_price)} · qty {p.qty ?? "—"} {duel.market}<br />
        margin locked {p.margin_locked_usd ? `$${p.margin_locked_usd.toFixed(2)}` : "—"}
        {p.liq_price ? <> · liq ≈ {fmtPx(p.liq_price)}</> : null}
        <br />wallet {p.wallet}{p.ghost ? " · house ghost" : ""}
      </div>
    </div>
  );
}

export default function DuelPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const { duel, err } = useDuel(id);
  const [joinName, setJoinName] = useState("");
  const [busy, setBusy] = useState("");
  const [actErr, setActErr] = useState("");
  const [now, setNow] = useState(Date.now());
  const myName = useRef<string>("");

  useEffect(() => {
    myName.current = localStorage.getItem("perpduel_name") ?? "";
    setJoinName(myName.current);
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  if (err) return <div className="card"><div className="err">{err}</div></div>;
  if (!duel) return <div className="card">Loading duel…</div>;

  const c = duel.creator, o = duel.opponent;
  const endsMs = duel.ends_at ? new Date(duel.ends_at).getTime() : null;
  const remain = endsMs ? Math.max(0, Math.ceil((endsMs - now) / 1000)) : null;
  const creatorShare = 50 + (c.pnl_usd / (Math.abs(c.pnl_usd) + Math.abs(o?.pnl_usd ?? 0) + 1e-9)) * 50;
  const isCreator = myName.current && myName.current === c.name;
  const myToken = typeof window !== "undefined" ? loadToken(id) : null;
  const challengeUrl = typeof window !== "undefined" ? window.location.href : "";
  const shareText = duel.status === "FINISHED"
    ? `PERPDUEL #${duel.id} on @DreamDEXSomnia — ${c.name} ${fmtRoe(c.roe_pct)} vs ${o?.name} ${fmtRoe(o?.roe_pct)} ROE on ${duel.market}-PERP. Winner: ${duel.winner}. Settled from real fills, proof on-chain:`
    : `I challenge you to a 1v1 ${duel.market}-PERP duel on @DreamDEXSomnia. I'm ${c.side}. Take the other side — real testnet orders, live PnL race, cash out or let the clock close both:`;
  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(challengeUrl)}`;

  async function act(kind: "join" | "ghost" | "cashout" | "rematch") {
    setActErr(""); setBusy(kind);
    try {
      if (kind === "join") {
        if (!joinName.trim()) throw new Error("Enter your fighter name.");
        localStorage.setItem("perpduel_name", joinName.trim());
        const d = await api<Duel>(`/api/duels/${id}/join`, { method: "POST", body: JSON.stringify({ name: joinName.trim() }) });
        storeToken(id, d.token);
      } else if (kind === "ghost") {
        await api(`/api/duels/${id}/ghost`, { method: "POST", body: "{}" });
      } else if (kind === "cashout") {
        if (!myToken) throw new Error("Only a fighter in this duel can cash out (token is in the browser that joined).");
        await api(`/api/duels/${id}/cashout`, { method: "POST", body: JSON.stringify({ token: myToken }) });
      } else if (kind === "rematch") {
        if (!myToken) throw new Error("Only a fighter can call a rematch.");
        const d = await api<Duel>(`/api/duels/${id}/rematch`, { method: "POST", body: JSON.stringify({ token: myToken }) });
        storeToken(d.id, d.token);
        router.push(`/duel/${d.id}`);
        return;
      }
    } catch (e: any) { setActErr(e.message ?? String(e)); }
    setBusy("");
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <span className={`badge ${duel.status.toLowerCase()}`}>{duel.status}</span>
        <span style={{ color: "var(--dim)", fontSize: 12 }}>
          DUEL #{duel.id} · {duel.market}-PERP · ${duel.notional_usd}/side · mark {fmtPx(duel.mark_price)}
          {duel.series_score ? ` · SERIES ${duel.series_score}` : ""}
        </span>
      </div>

      <section className="vs">
        <FighterCard p={c} duel={duel} />
        <div className="vsmid">
          <div className="vslabel">VS</div>
          <div className="clock">{duel.status === "LIVE" && remain !== null ? `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, "0")}` : duel.status === "FINISHED" ? "OVER" : "—"}</div>
          <div className="mkt">{duel.market}-PERP</div>
        </div>
        {o ? <FighterCard p={o} duel={duel} align="right" /> : (
          <div className="fighter right" style={{ background: "#1a1917" }}>
            <div className="fname">???</div>
            <div className="fside">{duel.reserved_opponent ? `RESERVED FOR ${duel.reserved_opponent}` : "WAITING FOR A RIVAL"}</div>
            <div className="fpnl">—</div>
            <div className="fmeta">Share the challenge link, or fight the Ghost.</div>
          </div>
        )}
      </section>

      {duel.status === "LIVE" && (
        <>
          <div className="racebar"><div className="rl" style={{ width: `${creatorShare}%` }} /><div className="rr" /></div>
          <div className="racecap"><span>{c.name} {fmtRoe(c.roe_pct)}</span><span>live race — ROE on locked margin · indicative until settlement</span><span>{o?.name} {fmtRoe(o?.roe_pct)}</span></div>
          <Tape duel={duel} />
          {myToken ? (
            <div style={{ marginTop: 16 }}>
              <button className="btn danger" disabled={busy === "cashout"} onClick={() => act("cashout")}>
                {busy === "cashout" ? "Closing both positions…" : "CASH OUT (CHICKEN) — end it now, settle at market"}
              </button>
              <span style={{ color: "var(--dim)", fontSize: 12, marginLeft: 12 }}>Bank your lead or cut your loss. Both positions close immediately, for both fighters.</span>
            </div>
          ) : (
            <p style={{ color: "var(--dim)", fontSize: 12, marginTop: 12 }}>You're spectating. Fighters holding a seat in this duel see a CASH OUT button here.</p>
          )}
        </>
      )}

      {duel.status === "WAITING" && (
        <section className="card">
          <h2>{isCreator ? "Your challenge is live" : duel.reserved_opponent ? `Rematch — ${duel.reserved_opponent}, your seat is reserved` : `Accept ${c.name}'s challenge`}</h2>
          <p style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.7 }}>
            {c.name} is <b style={{ color: c.side === "LONG" ? "var(--green)" : "var(--red)" }}>{c.side}</b> on {duel.market}-PERP, ${duel.notional_usd} a side, {duel.duration_sec}s.
            {isCreator ? " Send this link to a rival. The moment they accept, both real testnet orders open." : ` Accepting puts you ${c.side === "LONG" ? "SHORT" : "LONG"} with a real testnet order. No wallet needed.`}
          </p>
          <label>Challenge link</label>
          <input type="text" readOnly value={challengeUrl} onFocus={e => e.target.select()} />
          {!isCreator && (
            <>
              <label>Your fighter name</label>
              <input type="text" value={joinName} maxLength={24} onChange={e => setJoinName(e.target.value)} placeholder="e.g. @LIQUIDATOR" />
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

      {(duel.status === "OPENING" || duel.status === "CLOSING") && <section className="card"><h2>{duel.status === "OPENING" ? "Opening both positions on-chain…" : duel.settle_reason === "CASHOUT" ? `${duel.cashed_out_by} cashed out — closing both positions on-chain…` : "Clock's up — closing both positions on-chain…"}</h2></section>}

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
          <p style={{ fontSize: 15 }}>
            {c.name} {fmtRoe(c.roe_pct)} ({fmtUsd(c.pnl_usd)}) · {o?.name} {fmtRoe(o?.roe_pct)} ({fmtUsd(o?.pnl_usd ?? 0)})
            {duel.settle_reason === "CASHOUT" ? ` — ${duel.cashed_out_by} cashed out (chicken) and the market settled it.` : " — settled by real closing orders, not by a screenshot."}
            {duel.series_score ? ` Series: ${duel.series_score}.` : ""}
          </p>
          <div className="share" style={{ justifyContent: "center" }}>
            <a className="btn" href={xUrl} target="_blank" rel="noreferrer">Post result on X ↗</a>
            {myToken && o && o.name !== "GHOST" && <button className="btn" disabled={busy === "rematch"} onClick={() => act("rematch")}>{busy === "rematch" ? "Setting up…" : "↩ Rematch — sides swap"}</button>}
            <a className="btn ghost" href="/">New duel</a>
            <a className="btn ghost" href={`${API}/api/duels/${duel.id}/card.svg`} target="_blank" rel="noreferrer">Result card (SVG)</a>
          </div>
          {actErr && <div className="err">{actErr}</div>}
        </section>
      )}

      <section className="card proof">
        <h3>Settlement statement — verify it yourself</h3>
        {[c, ...(o ? [o] : [])].map(p => (
          <div key={p.name} style={{ marginBottom: 10 }}>
            <div>{p.name} ({p.side}, wallet {p.wallet}{p.ghost ? " — house Ghost wallet, disclosed" : ""}){p.cashed_out ? " · cashed out (chicken)" : ""}</div>
            <TxLinks label="open" hash={p.open_tx} /><TxLinks label="close" hash={p.close_tx} />
            <div>
              entry {fmtPx(p.entry_price)} → exit {fmtPx(p.exit_price)} · qty {p.qty ?? "—"} {duel.market}<br />
              price PnL {fmtUsd(p.price_pnl_usd)} · funding settled {fmtUsd(-p.funding_usd)}
              <br />margin locked {p.margin_locked_usd ? `$${p.margin_locked_usd.toFixed(2)}` : "—"} · <b>net {fmtUsd(p.pnl_usd)} = {fmtRoe(p.roe_pct)} ROE</b>
            </div>
          </div>
        ))}
        <div style={{ color: "var(--dim)" }}>
          Winner is scored on net PnL (price PnL minus funding owed) from actual fill prices. Live race ROE is indicative; settlement uses fills, so a photo-finish can flip the live leader — that's the market, not a bug.
          {duel.entry_gap_sec !== null && duel.entry_gap_sec !== undefined ? ` Entries landed ${Math.abs(duel.entry_gap_sec).toFixed(1)}s apart (parallel orders, disclosed).` : ""}
          Chain: Somnia Tokyo (Hideki 50383) via @somnia-chain/markets-sdk.
        </div>
      </section>
    </>
  );
}
