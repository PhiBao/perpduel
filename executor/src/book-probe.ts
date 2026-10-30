import { makeMarkets, pk, getPerp } from "./lib.js";
async function main() {
  const m = makeMarkets(pk("PRIVATE_KEY"));
  const btc = await getPerp(m, "BTC");
  const tops: any = await m.client.getBookTopsOnchain([{ id: btc.id, poolAddress: btc.poolAddress }]);
  console.log("id", btc.id, "pool", btc.poolAddress);
  console.log(JSON.stringify(tops, (_, v) => typeof v === "bigint" ? v.toString() : v, 1).slice(0, 1500));
  process.exit(0);
}
main();
