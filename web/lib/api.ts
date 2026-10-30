export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4102";
export const EXPLORER = "https://smk-dev-markets-explorer-hideki-euw4-uzavbo36ra-ez.a.run.app/tx/";

export type Player = {
  name: string; side: "LONG" | "SHORT"; wallet: string;
  entry_price: number | null; qty: number | null;
  open_tx: string | null; close_tx: string | null; exit_price: number | null;
  pnl_usd: number; ghost: boolean;
};
export type Duel = {
  id: string; market: string; duration_sec: number; status: string;
  creator: Player; opponent: Player | null;
  created_at: string; started_at: string | null; ends_at: string | null;
  mark_price: number | null; winner: string | null; void_reason: string | null;
  notional_usd: number;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const text = await r.text();
  let data: any; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  return data as T;
}
export const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)} USDso`;
export const fmtPx = (n: number | null) => n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
