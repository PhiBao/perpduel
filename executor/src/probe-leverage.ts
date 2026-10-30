import { makeMarkets, pk, addressOf, getPerp } from "./lib.js";
for (const [l, k] of [["A", pk("PRIVATE_KEY")], ["B", pk("PRIVATE_KEY_B")]] as const) {
  const m = makeMarkets(k);
  const btc = await getPerp(m, "BTC");
  const lev: any = await m.client.getPerpLeverage({ marginBank: btc.marginBank, pool: btc.poolAddress, account: addressOf(k) });
  console.log(l, JSON.stringify(lev, (_, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 700));
  const imf: any = await m.client.getEffectiveImfBps(btc.poolAddress).catch((e: any) => String(e?.message ?? e).slice(0, 120));
  console.log(l, "effectiveImfBps:", String(imf));
}
process.exit(0);
