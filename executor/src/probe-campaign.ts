import { makeMarkets, pk, getPerp } from "./lib.js";
const m = makeMarkets(pk("PRIVATE_KEY"));
const btc = await getPerp(m, "BTC");
const camp: any = await m.client.getPerpVoucherCampaign(btc.marginBank);
console.log(JSON.stringify(camp, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
process.exit(0);
