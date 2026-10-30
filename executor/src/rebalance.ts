import { createWalletClient, http, parseUnits, formatUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { makeMarkets, pk, addressOf, getPerp, sleep } from "./lib.js";
const RPC = "https://api.hideki2.infra.testnet.somnia.network";
const keyA = pk("PRIVATE_KEY"), keyB = pk("PRIVATE_KEY_B");
const addrB = addressOf(keyB);
const mA = makeMarkets(keyA), mB = makeMarkets(keyB);
const btc = await getPerp(mA, "BTC");
const wA = createWalletClient({ account: privateKeyToAccount(keyA), chain: hidekiTestnet, transport: http(RPC) });
console.log("A withdraw 32:", (await mA.trader.withdrawMargin({ marginBank: btc.marginBank, amount: parseUnits("32", 18) })).hash);
await sleep(2000);
console.log("transfer:", await wA.writeContract({ address: btc.quoteToken, abi: erc20Abi, functionName: "transfer", args: [addrB, parseUnits("32", 18)] }));
await sleep(3000);
console.log("B deposit:", (await mB.trader.depositMargin({ marginBank: btc.marginBank, amount: parseUnits("32", 18) })).hash);
await sleep(2000);
for (const [l, m, a] of [["A", mA, addressOf(keyA)], ["B", mB, addrB]] as const) {
  const ma: any = await m.client.getMarginAccount(btc.marginBank, a);
  console.log(l, formatUnits(ma.unlockedCollateralBalance, 18));
}
process.exit(0);
