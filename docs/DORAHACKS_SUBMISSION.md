# DoraHacks — "Describe your Build"

Paste the block below into the submission field. It maps 1:1 to the points the form asks for.

---

## PERPDUEL — 1v1 perpetuals duels on dreamDEX

**Live app:** https://perpduel-web.pages.dev · **API:** https://perpduel-api.fly.dev · **Code:** https://github.com/PhiBao/perpduel
**109-second demo:** https://x.com/0xMemeshe/status/2116310475751440884 · **Category:** consumer perps

### The problem

dreamDEX's Perps Arena proved people will compete on a weekly ROI leaderboard — and its own Week 2 review
showed 35% of trades that went green still closed in the red. A leaderboard is abstract: you never beat
anyone in particular, there is no clock forcing a decision, and the proof of a result is a screenshot that
anyone can fake. Traders don't need another chart. They need an opponent and a reason to take profit.

### How it works

1. **Create** — type a name, pick BTC/ETH/SOL/HYPE-PERP, a side, a size ($100/$250/$500 a side) and a clock
   (60s / 5m / 15m). You get a challenge link. No wallet, no faucet, no signup.
2. **Accept** — a rival opens the link and takes the opposite side, or you fight the disclosed house Ghost.
3. **Fight** — the engine places two real IOC orders on the dreamDEX order book in parallel, one per house
   testnet wallet (~0.05s apart, disclosed on the proof page), then streams a live race priced at the book
   each side would actually close into: bid for a long, ask for a short.
4. **Decide** — either fighter can **CASH OUT**: both positions close at market immediately. Bank the lead
   or cut the loss. Only the fighter holding that seat's token can pull the trigger.
5. **Settle** — at cash-out or at zero, both positions close with real orders. The winner is scored on net
   ROE on the margin each position actually locked, from actual fill prices (price PnL minus funding owed).
6. **Prove** — the settlement statement lists entry, exit, funding, margin and ROE plus four transaction
   hashes. `scripts/verify-duel.sh <id>` re-checks all four receipts against the chain.

### Key features

- **Zero-friction**: a judge is watching a live duel within 15 seconds, with nothing installed and no wallet.
- **ROE, not cents**: results are percentages of margin locked, so a 60-second duel reads like a fight.
- **CASH OUT**: the one decision that makes it a game instead of a coin flip.
- **A loop with memory**: rematch swaps sides and reserves the rival's seat, a series keeps score, and a
  public standings board tracks wins, losses, net PnL, best ROE and streaks.
- **Proof over claims**: every duel is four public transactions; the app never asks to be trusted.
- **Honest failure**: stale marks, empty books or a failed close end in a visible `VOID` with positions
  flattened — never a simulated result.

### Tech stack

- **Rust** (Axum + Tokio) — duel state machine, 1s race loop, settlement from fills, proof ledger, SVG result
  cards, unit tests for PnL/side/ROE maths. The backend is the product.
- **TypeScript executor** — the only key-holder, using the official `@somnia-chain/markets-sdk` 0.32.1
  (`getMaxPerpOrderSize` guards, per-market tick/lot/decimals, IOC open/close). It sits on loopback behind a
  shared secret; the Rust core never sees a key.
- **Next.js static export** on Cloudflare Pages; **Fly.io** runs the Rust engine + executor in one container
  with a volume for the proof ledger (scale-to-zero, ~10s cold start handled in the UI).
- **Somnia Tokyo / Hideki testnet, chain 50383** — all orders, closes and proofs live there.

### Hackathon requirements

- **Real perps orders on Somnia Tokyo testnet** — yes. Example: duel `3065a7f0` (NOVA +2.7% vs RAVEN −5.8%,
  $500/side) with four confirmed receipts on chain 50383; `verify-duel.sh` re-checks them on demand.
- **README explains what it does, who it is for and how to run it** — repo README covers product, demo,
  architecture, run/test commands, real-vs-simulated table, security and limitations.
- **README has an X posts section with 2–3 posts tagging @DreamDEXSomnia** — three posts, linked there.
- **Category** — consumer perps.
- **Somnia primitives** — not used, and stated as such: Somnia Agents/Reactivity are documented on
  Shannon/mainnet, not verified on the Hideki perps chain, so the product does not depend on them.

### What is real vs. not

Real: orders, prices, fills, settlement, fees, transaction hashes. Not real: the money — paper USDso on
testnet — and the fighters' wallets, which are disclosed house wallets. The mainnet form (§Roadmap in the
README) puts each fighter on their own linked-bot wallet, which is the same flow with the duel as a scoring
layer.

---

## Shorter variant (if the field has a tight character limit)

**PERPDUEL** — 1v1 perpetuals duels on dreamDEX. Send a link; your rival takes the other side of a BTC/ETH
perp; both real orders hit the book within ~0.05s; a live ROE race runs on the margin each side locked; either
fighter can cash out, or the clock closes both; the winner is settled from actual fills and every duel ships
four tx hashes. No wallet, no faucet, no signup — a judge is in a live duel in 15 seconds.

Built with a Rust duel engine (Axum/Tokio), a TypeScript executor over `@somnia-chain/markets-sdk`, a Next.js
static export on Cloudflare Pages and a scale-to-zero Fly.io container; everything settles on Somnia Tokyo
(Hideki, chain 50383). Example: duel `3065a7f0`, four confirmed receipts.

Live: https://perpduel-web.pages.dev · Code: https://github.com/PhiBao/perpduel ·
Demo (109s): https://x.com/0xMemeshe/status/2116310475751440884
