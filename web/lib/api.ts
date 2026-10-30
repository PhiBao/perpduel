export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4102";
export const EXPLORER = "https://smk-dev-markets-explorer-hideki-euw4-uzavbo36ra-ez.a.run.app/tx/";

export type Player = {
  name: string; side: "LONG" | "SHORT"; wallet: string; wallet_address: string | null;
  entry_price: number | null; qty: number | null;
  open_tx: string | null; close_tx: string | null; exit_price: number | null;
  pnl_usd: number; price_pnl_usd: number; funding_usd: number; spread_cost_usd: number;
  margin_locked_usd: number | null; roe_pct: number | null; mark_at_open: number | null;
  opened_at: string | null; liq_price: number | null; cashed_out: boolean; ghost: boolean;
};
export type Duel = {
  id: string; market: string; duration_sec: number; status: string;
  creator: Player; opponent: Player | null; reserved_opponent: string | null;
  created_at: string; started_at: string | null; ends_at: string | null;
  mark_price: number | null; winner: string | null; void_reason: string | null;
  settle_reason: string | null; cashed_out_by: string | null; entry_gap_sec: number | null;
  price_history: [number, number][]; series_id: string | null; series_score: string | null;
  notional_usd: number; token?: string | null;
};
export type Standing = {
  name: string; wins: number; losses: number; duels: number;
  pnl_usd: number; best_roe_pct: number | null; streak: number;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const text = await r.text();
  let data: any; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  return data as T;
}
export const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)} USDso`;
export const fmtRoe = (n: number | null | undefined) => n === null || n === undefined ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
export const fmtPx = (n: number | null) => n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
export function storeToken(duelId: string, token: string | null | undefined) {
  if (token) localStorage.setItem(`perpduel_token_${duelId}`, token);
}
export function loadToken(duelId: string) {
  return localStorage.getItem(`perpduel_token_${duelId}`);
}
