import { createWalletClient, http, parseUnits, formatUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { makeMarkets, pk, addressOf, getPerp, sleep } from "./lib.js";

const RPC = "https://api.hideki2.infra.testnet.somnia.network";
const TARGET = 130; // USDso margin per wallet

async function main() {
  const keyA = pk("PRIVATE_KEY"), keyB = pk("PRIVATE_KEY_B");
  const addrA = addressOf(keyA), addrB = addressOf(keyB);
  const mA = makeMarkets(keyA), mB = makeMarkets(keyB);
  const btc = await getPerp(mA, "BTC");
  const bank = btc.marginBank, token = btc.quoteToken;
  const wA = createWalletClient({ account: privateKeyToAccount(keyA), chain: hidekiTestnet, transport: http(RPC) });

  async function margin(m: any, addr: string) {
    const ma: any = await m.client.getMarginAccount(bank, addr);
    return Number(formatUnits(ma.unlockedCollateralBalance, 18));
  }
  console.log(`before: A margin=${await margin(mA, addrA)} B margin=${await margin(mB, addrB)}`);
  console.log(`A wallet USDso=${formatUnits(await mA.client.getErc20Balance(token, addrA), 18)}`);

  // A: deposit from own wallet to TARGET
  let aMargin = await margin(mA, addrA);
  if (aMargin < TARGET) {
    const amt = Math.min(TARGET - aMargin, 90);
    console.log(`A depositMargin ${amt}...`);
    const r: any = await mA.trader.depositMargin({ marginBank: bank, amount: parseUnits(amt.toFixed(2), 18) });
    console.log(" tx:", r.hash); await sleep(2000);
  }
  // B: transfer from A's wallet then deposit
  let bMargin = await margin(mB, addrB);
  if (bMargin < TARGET) {
    const need = TARGET - bMargin;
    const aWallet = Number(formatUnits(await mA.client.getErc20Balance(token, addrA), 18));
    const amt = Math.min(need, Math.max(0, aWallet - 5));
    if (amt > 1) {
      console.log(`A -> B transfer ${amt} USDso...`);
      const t = await wA.writeContract({ address: token, abi: erc20Abi, functionName: "transfer", args: [addrB, parseUnits(amt.toFixed(2), 18)] });
      console.log(" tx:", t); await sleep(3000);
      console.log(`B depositMargin ${amt}...`);
      const r: any = await mB.trader.depositMargin({ marginBank: bank, amount: parseUnits(amt.toFixed(2), 18) });
      console.log(" tx:", r.hash); await sleep(2000);
    } else console.log("A wallet too low to fund B");
  }
  console.log(`after: A margin=${await margin(mA, addrA)} B margin=${await margin(mB, addrB)}`);
  console.log(`A wallet USDso=${formatUnits(await mA.client.getErc20Balance(token, addrA), 18)} B wallet USDso=${formatUnits(await mB.client.getErc20Balance(token, addrB), 18)}`);
  process.exit(0);
}
main().catch(e => { console.error("TOPUP FAILED:", e?.message ?? e); process.exit(1); });
