import { generatePrivateKey } from "viem/accounts";
import { createWalletClient, http, parseEther, formatEther } from "viem";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { makeMarkets, pk, addressOf, getPerp, sleep } from "./lib.js";
import * as fs from "node:fs";

async function main() {
  // 1. Generate B if needed
  let keyB = process.env.PRIVATE_KEY_B as `0x${string}` | undefined;
  if (!keyB) {
    keyB = generatePrivateKey();
    fs.appendFileSync(".env", `\nPRIVATE_KEY_B=${keyB}\n`);
    console.log("Generated Wallet B, appended PRIVATE_KEY_B to .env (gitignored, never commit)");
  }
  const keyA = pk("PRIVATE_KEY");
  const addrA = addressOf(keyA), addrB = addressOf(keyB);
  console.log("A:", addrA, "\nB:", addrB);

  // 2. Fund B with STT from A if low
  const ro = makeMarkets();
  const balB = await ro.client.getNativeBalance(addrB);
  console.log("B STT before:", formatEther(balB));
  if (balB < parseEther("5")) {
    const account = (await import("viem/accounts")).privateKeyToAccount(keyA);
    const wallet = createWalletClient({ account, chain: hidekiTestnet, transport: http("https://api.hideki2.infra.testnet.somnia.network") });
    const hash = await wallet.sendTransaction({ to: addrB, value: parseEther("10") });
    console.log("STT transfer A->B tx:", hash);
    await sleep(4000);
    console.log("B STT after:", formatEther(await ro.client.getNativeBalance(addrB)));
  }

  // 3. Claim vouchers for both (BTC market's marginBank)
  const probe = makeMarkets(keyA);
  const btc = await getPerp(probe, "BTC");
  for (const [label, key] of [["A", keyA], ["B", keyB]] as const) {
    const m = makeMarkets(key);
    const addr = addressOf(key);
    const elig: any = await m.client.getPerpVoucherEligibility(btc.marginBank, addr);
    console.log(`${label} voucher eligible=${elig.eligible} grant=${elig.grantAmount}`);
    try {
      const existing: any = await m.client.getPerpVoucher(btc.marginBank, addr);
      console.log(`${label} existing voucher:`, JSON.stringify(existing, (_, v) => typeof v === "bigint" ? v.toString() : v)?.slice(0, 400));
    } catch (e: any) { console.log(`${label} getPerpVoucher err:`, (e?.message ?? String(e)).slice(0, 200)); }
    if (elig.eligible) {
      try {
        const res: any = await m.trader.claimPerpVoucher({ marginBank: btc.marginBank });
        console.log(`${label} claim tx:`, res.hash);
      } catch (e: any) { console.log(`${label} claim FAILED (continuing):`, (e?.message ?? String(e)).slice(0, 200)); }
      await sleep(2000);
    }
    const ma: any = await m.client.getMarginAccount(btc.marginBank, addr);
    console.log(`${label} margin unlocked=${ma.unlockedCollateralBalance} equity=${ma.equity} status=${ma.marginStatus}`);
  }
  process.exit(0);
}
main().catch(e => { console.error("SETUP FAILED:", e?.message ?? e, e); process.exit(1); });
