import { parseUnits, formatUnits } from "viem";
import { makeMarkets, pk, addressOf, getPerp, alignPrice, alignQty, sleep } from "./lib.js";

const NOTIONAL = 30; // USDso
async function place(m: any, market: any, isBid: boolean, notionalUsd: number) {
  const st: any = await m.client.getPerpState(market.poolAddress);
  const mark: bigint = st.markPrice;
  const markNum = Number(formatUnits(mark, market.quoteDecimals));
  const qtyRaw = parseUnits((notionalUsd / markNum).toFixed(market.baseDecimals), market.baseDecimals);
  const qty = alignQty(qtyRaw, BigInt(market.lotSize));
  const cross = isBid ? (mark * 1005n) / 1000n : (mark * 995n) / 1000n;
  const price = alignPrice(cross, BigInt(market.tickSize), isBid);
  console.log(`place ${isBid ? "LONG/bid" : "SHORT/ask"} mark=${markNum} qty=${formatUnits(qty, market.baseDecimals)} price=${formatUnits(price, market.quoteDecimals)}`);
  const max: any = await m.client.getMaxPerpOrderSize({ pool: market.poolAddress, marginBank: market.marginBank, account: m.walletAddress, isBid, price });
  console.log("  max:", JSON.stringify(max, (_, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 400));
  const res: any = await m.trader.placePerpOrder({ pool: market.poolAddress, isBid, price, quantity: qty, orderType: 2 });
  console.log("  tx:", res.hash, "orderId:", res.orderId?.toString(), "fills:", res.fills?.map((f: any) => `qty=${f.quantityFilled} @${formatUnits(f.fillPrice, market.quoteDecimals)}`).join(",") || "none");
  return { tx: res.hash, qty, fills: res.fills };
}
async function pos(m: any, market: any, addr: string, label: string) {
  const p: any = await m.client.getPerpPosition({ marginBank: market.marginBank, account: addr, pool: market.poolAddress });
  console.log(`position[${label}] size=${formatUnits(BigInt(p.size), market.baseDecimals)} entry=${p.avgEntryPrice ? formatUnits(BigInt(p.avgEntryPrice), market.quoteDecimals) : "0"}`);
  return p;
}
async function main() {
  const keyA = pk("PRIVATE_KEY"), keyB = pk("PRIVATE_KEY_B");
  const mA = makeMarkets(keyA), mB = makeMarkets(keyB);
  const addrA = addressOf(keyA), addrB = addressOf(keyB);
  const btc = await getPerp(mA, "BTC");
  console.log("--- OPEN A LONG / B SHORT ---");
  const openA = await place(mA, btc, true, NOTIONAL);
  await sleep(1500);
  const openB = await place(mB, btc, false, NOTIONAL);
  await sleep(3000);
  await pos(mA, btc, addrA, "A");
  await pos(mB, btc, addrB, "B");
  console.log("--- CLOSE BOTH (opposite IOC) ---");
  if (openA.fills?.length) await place(mA, btc, false, NOTIONAL);
  await sleep(1500);
  if (openB.fills?.length) await place(mB, btc, true, NOTIONAL);
  await sleep(3000);
  await pos(mA, btc, addrA, "A-after");
  await pos(mB, btc, addrB, "B-after");
  process.exit(0);
}
main().catch(e => { console.error("SPIKE FAILED:", e?.message ?? e); process.exit(1); });
