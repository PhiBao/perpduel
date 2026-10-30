import { makeMarkets, pk, addressOf, getPerp, fmt, INDEXER } from "./lib.js";
import { formatEther } from "viem";

async function main() {
  const keyA = pk("PRIVATE_KEY");
  const addrA = addressOf(keyA);
  console.log("Wallet A:", addrA);
  const keyB = process.env.PRIVATE_KEY_B as `0x${string}` | undefined;
  const addrB = keyB ? addressOf(keyB as `0x${string}`) : null;
  console.log("Wallet B:", addrB ?? "(not set)");

  const markets = makeMarkets(keyA);

  // native STT
  for (const [label, addr] of [["A", addrA], ...(addrB ? [["B", addrB] as const] : [])]) {
    try {
      const bal = await markets.client.getNativeBalance(addr as `0x${string}`);
      console.log(`STT[${label}] ${addr}: ${formatEther(bal)} STT`);
    } catch (e: any) { console.log(`STT[${label}] error:`, e?.message ?? e); }
  }

  const perps = await markets.client.listPerpMarkets();
  console.log(`\nPerp markets (${perps.length}):`);
  for (const m of perps) {
    console.log(`- ${m.baseSymbol} pool=${m.poolAddress} baseDec=${m.baseDecimals} quoteDec=${m.quoteDecimals} tick=${m.tickSize} lot=${m.lotSize} minQty=${m.minQuantity} marginBank=${m.marginBank}`);
  }

  for (const sym of ["BTC", "ETH"]) {
    const m = await getPerp(markets, sym);
    console.log(`\n=== ${sym} ===`);
    try {
      const st: any = await markets.client.getPerpState(m.poolAddress);
      console.log("state:", JSON.stringify(st, (_, v) => typeof v === "bigint" ? v.toString() : v, 2).slice(0, 1500));
    } catch (e: any) { console.log("getPerpState err:", e?.message ?? e); }
    try {
      const feed: any = await markets.client.getPerpFeedStatus(m.poolAddress);
      console.log("feed:", JSON.stringify(feed, (_, v) => typeof v === "bigint" ? v.toString() : v, 2).slice(0, 1000));
    } catch (e: any) { console.log("feed err:", e?.message ?? e); }
    // voucher + margin + position for A (and B)
    for (const [label, addr] of [["A", addrA], ...(addrB ? [["B", addrB] as const] : [])]) {
      try {
        const elig: any = await markets.client.getPerpVoucherEligibility(m.marginBank, addr as `0x${string}`);
        console.log(`voucher[${label}]:`, JSON.stringify(elig, (_, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 600));
      } catch (e: any) { console.log(`voucher[${label}] err:`, e?.message ?? e); }
      try {
        const ma: any = await markets.client.getMarginAccount(m.marginBank, addr as `0x${string}`);
        console.log(`margin[${label}]:`, JSON.stringify(ma, (_, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 800));
      } catch (e: any) { console.log(`margin[${label}] err:`, e?.message ?? e); }
      try {
        const pos: any = await markets.client.getPerpPosition({ marginBank: m.marginBank, account: addr as `0x${string}`, pool: m.poolAddress });
        console.log(`position ${sym}[${label}]:`, JSON.stringify(pos, (_, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 600));
      } catch (e: any) { console.log(`pos[${label}] err:`, e?.message ?? e); }
    }
    // order book via unified API if available
    try {
      const book: any = await (markets as any).fetchOrderBook(`${sym}/USDso:USDso`);
      console.log(`book ${sym}: bids=${book?.bids?.slice(0,3)} asks=${book?.asks?.slice(0,3)}`);
    } catch (e: any) { console.log(`book ${sym} err:`, (e?.message ?? String(e)).slice(0, 300)); }
  }
  process.exit(0);
}
main().catch(e => { console.error("DOCTOR FAILED:", e); process.exit(1); });
