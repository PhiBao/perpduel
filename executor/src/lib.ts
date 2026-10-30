import "dotenv/config";
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, type PerpMarket } from "@somnia-chain/markets-sdk";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits } from "viem";

export const INDEXER = "https://hideki-dev.smk.somnia.host/v1/graphql";
export const EXPLORER_TX = "https://smk-dev-markets-explorer-hideki-euw4-uzavbo36ra-ez.a.run.app/tx/";

export function pk(name: string): `0x${string}` {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v as `0x${string}`;
}
export function addressOf(key: `0x${string}`) {
  return privateKeyToAccount(key).address;
}
export function makeMarkets(key?: `0x${string}`) {
  return new SomniaMarkets({
    chain: hidekiTestnet,
    indexerUrl: INDEXER,
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
    ...(key ? { privateKey: key } : {}),
  } as any);
}
export async function getPerp(markets: any, symbol: string): Promise<PerpMarket> {
  const perps: PerpMarket[] = await markets.client.listPerpMarkets();
  const m = perps.find((x) => x.baseSymbol === symbol);
  if (!m) throw new Error(`Perp market ${symbol} not found. Available: ${perps.map(p=>p.baseSymbol).join(",")}`);
  return m;
}
export function fmt(raw: bigint | string | null | undefined, decimals: number): string {
  if (raw === null || raw === undefined) return "null";
  return formatUnits(BigInt(raw), decimals);
}
/** Align price down/up to tick, quantity down to lot */
export function alignPrice(price: bigint, tick: bigint, roundUp: boolean): bigint {
  const r = price % tick;
  if (r === 0n) return price;
  return roundUp ? price + (tick - r) : price - r;
}
export function alignQty(qty: bigint, lot: bigint): bigint {
  return qty - (qty % lot);
}
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
