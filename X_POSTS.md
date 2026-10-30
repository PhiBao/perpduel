# X posts — required for submission

The bounty asks for **2–3 public posts about the MVP that tag @DreamDEXSomnia** and a README section
linking them. **Done — posted and linked in the README.**

| # | Post | URL |
|---|---|---|
| 1 | Launch / challenge | https://x.com/0xMemeshe/status/2115553355397554449 |
| 2 | Proof / how it settles | https://x.com/0xMemeshe/status/2115810427380895785 |
| 3 | 109s demo video | https://x.com/0xMemeshe/status/2116310475751440884 |

**Live app:** https://perpduel-web.pages.dev
**Demo video:** `docs/perpduel-demo.mp4` (108.9 s, 1920×1080, H.264/AAC, 12 MB — inside X's 2:20 / 512 MB limits)

---

## Post 3 — the one with the video attached

Attach `docs/perpduel-demo.mp4`. Paste this text, then put the link in the **first reply** (X down-ranks
posts with outbound links; the video carries the reach, the reply carries the click).

```
A perps competition ranks you on a leaderboard. You never beat anyone in particular.

So I built PERPDUEL: send a link, your rival takes the other side of a BTC/ETH perp, both orders hit the
dreamDEX book, and the clock closes both. 109 seconds, real testnet orders, no wallet needed.

Winner is settled from actual fills — and every duel ships four tx hashes you can open.

@DreamDEXSomnia
```

Reply 1:

```
Play it: https://perpduel-web.pages.dev

Proof, not screenshots — duel b3cfea24, all four receipts confirmed on Somnia Tokyo (Hideki 50383):
0x26cca41aac… 0xb6c5f77de1… 0xa67c1e2166… 0xd450b3b707…

Code: https://github.com/PhiBao/perpduel
```

---

## Post 1 — launch / challenge (post this first, no video)

```
Sent a friend a link. He picked SHORT on BTC-PERP. I was LONG. Both orders went to the dreamDEX book
within 0.05s of each other, a live ROE race ran for five minutes, and either of us could cash out.

That is PERPDUEL — 1v1 perps duels on @DreamDEXSomnia testnet. No wallet, no faucet, no signup.

First challenger gets me. Who takes the other side?
```

Reply: `https://perpduel-web.pages.dev`

---

## Post 2 — proof / how it settles (post after the first real duel)

```
Every PERPDUEL result comes with its receipts: four transactions per duel — two opens, two closes —
confirmed on Somnia Tokyo (Hideki 50383).

The race is return on the margin each side actually locked, priced at the book its close would hit.
The settlement statement lists entry, exit, funding and net ROE from real fills.

No cropped PnL card. @DreamDEXSomnia
```

Reply: the four explorer links for the duel you quote.

---

## Posting checklist

1. Post 1 → pin it if you have nothing else pinned.
2. Post 3 with the video (the highest-reach one) — attach the file, link in the reply.
3. Post 2 after you have a fresh duel to point at (create one on the live app first, so the numbers are current).
4. Copy each post URL (click the post → copy link) into the README block below.
5. Optional but useful for the submission page: upload the same MP4 to YouTube (unlisted is fine) and use
   that link as the "demo video" field if DoraHacks asks for one — X links sometimes require a login.

## README block to paste (replace the placeholders)

```md
## X posts

- Post 1 — launch: <url>
- Post 2 — proof: <url>
- Post 3 — 109s demo video: <url>
```
