import { createWalletClient, http, parseUnits, formatUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { makeMarkets, pk, addressOf, getPerp, sleep } from "./lib.js";

const RPC = "https://api.hideki2.infra.testnet.somnia.network";
async function main() {
  const keyA = pk("PRIVATE_KEY"), keyB = pk("PRIVATE_KEY_B");
  const addrA = addressOf(keyA), addrB = addressOf(keyB);
  const mA = makeMarkets(keyA), mB = makeMarkets(keyB);
  const btc = await getPerp(mA, "BTC");
  const bank = btc.marginBank, token = btc.quoteToken;
  console.log("bank", bank, "token", token);

  const amt = parseUnits("60", 18);
  const wA = createWalletClient({ account: privateKeyToAccount(keyA), chain: hidekiTestnet, transport: http(RPC) });

  const balTokA = await mA.client.getErc20Balance(token, addrA).catch(() => null);
  console.log("A wallet USDso:", balTokA !== null ? formatUnits(balTokA as bigint, 18) : "?");

  console.log("A withdrawMargin 60...");
  const w = await mA.trader.withdrawMargin({ marginBank: bank, amount: amt });
  console.log("withdraw tx:", w.hash);
  await sleep(2000);

  console.log("A -> B transfer 55 USDso...");
  const t = await wA.writeContract({ address: token, abi: erc20Abi, functionName: "transfer", args: [addrB, parseUnits("55", 18)] });
  console.log("transfer tx:", t);
  await sleep(3000);

  console.log("B depositMargin 55...");
  const d = await mB.trader.depositMargin({ marginBank: bank, amount: parseUnits("55", 18) });
  console.log("deposit tx:", d.hash);
  await sleep(2000);

  for (const [label, m, addr] of [["A", mA, addrA], ["B", mB, addrB]] as const) {
    const ma: any = await m.client.getMarginAccount(bank, addr);
    console.log(`${label} margin unlocked=${formatUnits(ma.unlockedCollateralBalance, 18)} equity=${formatUnits(ma.equity, 18)}`);
  }
  process.exit(0);
}
main().catch(e => { console.error("FUND-B FAILED:", e?.message ?? e); process.exit(1); });
