import { makeMarkets, pk, getPerp, sleep } from "./lib.js";
for (const [l, k] of [["A", pk("PRIVATE_KEY")], ["B", pk("PRIVATE_KEY_B")]] as const) {
  const m = makeMarkets(k);
  for (const sym of ["BTC", "ETH", "SOL", "HYPE"]) {
    const mkt = await getPerp(m, sym);
    const r: any = await m.trader.setPerpLeverage({ pool: mkt.poolAddress, leverageX: 10 });
    console.log(l, sym, "setLeverage 10x tx:", r.hash);
    await sleep(800);
  }
}
process.exit(0);
