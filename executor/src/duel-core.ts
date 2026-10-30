import { parseUnits, formatUnits } from "viem";
import { makeMarkets, pk, addressOf, getPerp, alignPrice, alignQty, sleep } from "./lib.js";

export type WalletId = "A" | "B";
const clients: Record<WalletId, any> = {} as any;
const wallets: Record<WalletId, { key: `0x${string}`; address: string }> = {} as any;

export function initWallets() {
  for (const id of ["A", "B"] as WalletId[]) {
    const key = pk(id === "A" ? "PRIVATE_KEY" : "PRIVATE_KEY_B");
    wallets[id] = { key, address: addressOf(key) };
    clients[id] = makeMarkets(key);
  }
  return wallets;
}
export function walletAddress(id: WalletId) { return wallets[id].address; }

const marketCache: Record<string, any> = {};
export async function market(symbol: string) {
  if (!marketCache[symbol]) marketCache[symbol] = await getPerp(clients.A, symbol);
  return marketCache[symbol];
}

export async function marketState(symbol: string) {
  const m = await market(symbol);
  const st: any = await clients.A.client.getPerpState(m.poolAddress);
  return {
    symbol, pool: m.poolAddress, marginBank: m.marginBank,
    markPrice: formatUnits(st.markPrice, m.quoteDecimals),
    indexPrice: formatUnits(st.indexPrice, m.quoteDecimals),
    markPriceOk: st.markPriceOk, openInterest: st.openInterest.toString(),
    baseDecimals: m.baseDecimals, quoteDecimals: m.quoteDecimals,
  };
}

/** Top of book: what closing a long (bid) or a short (ask) would actually face.
 *  The live race uses this, not the lagging mark, so it converges on settlement. */
const bookCache: Record<string, { at: number; v: any }> = {};
export async function bookTop(symbol: string) {
  const now = Date.now();
  if (bookCache[symbol] && now - bookCache[symbol].at < 700) return bookCache[symbol].v;
  const m = await market(symbol);
  const res: any = await clients.A.client.getBookTopsOnchain([{ id: m.id, poolAddress: m.poolAddress }]);
  const tops = res?.tops ?? res ?? {};
  const top = tops[m.id?.toLowerCase()] ?? tops[m.poolAddress?.toLowerCase()] ?? null;
  const bid = top?.bestBid ? Number(formatUnits(BigInt(top.bestBid), m.quoteDecimals)) : null;
  const ask = top?.bestAsk ? Number(formatUnits(BigInt(top.bestAsk), m.quoteDecimals)) : null;
  const mid = top?.mid ? Number(formatUnits(BigInt(top.mid), m.quoteDecimals)) : (bid && ask ? (bid + ask) / 2 : null);
  const v = { symbol, bid, ask, mid };
  bookCache[symbol] = { at: now, v };
  return v;
}

export interface PlaceResult {  wallet: WalletId; tx: string; orderId?: string;
  qtyFilled: string; qtyFilledNum: number; avgFillPrice: number;
  fills: { qty: string; price: string }[];
  positionSize: string; entryPrice: number;
  markAtPlace: number; marginLockedUsd: number; openedAt: string;
}

export async function placeOrder(walletId: WalletId, symbol: string, isBid: boolean, notionalUsd: number): Promise<PlaceResult> {
  const m = await market(symbol);
  const client = clients[walletId];
  const st: any = await client.client.getPerpState(m.poolAddress);
  if (!st.markPriceOk) throw Object.assign(new Error("STALE_MARK"), { code: "STALE_MARK" });
  const mark: bigint = st.markPrice;
  const markNum = Number(formatUnits(mark, m.quoteDecimals));
  let qty = alignQty(parseUnits((notionalUsd / markNum).toFixed(m.baseDecimals), m.baseDecimals), BigInt(m.lotSize));
  if (qty < BigInt(m.minQuantity)) qty = alignQty(BigInt(m.minQuantity) * 2n, BigInt(m.lotSize));
  const cross = isBid ? (mark * 1005n) / 1000n : (mark * 995n) / 1000n;
  const price = alignPrice(cross, BigInt(m.tickSize), isBid);
  const max: any = await client.client.getMaxPerpOrderSize({ pool: m.poolAddress, marginBank: m.marginBank, account: wallets[walletId].address, isBid, price });
  if (!max.priceable) throw Object.assign(new Error("STALE_MARK"), { code: "STALE_MARK" });
  if (!max.placeable || qty > BigInt(max.maxQuantity)) {
    throw Object.assign(new Error(`ORDER_TOO_LARGE limitedBy=${max.limitedBy}`), { code: "ORDER_TOO_LARGE" });
  }
  const res: any = await client.trader.placePerpOrder({ pool: m.poolAddress, isBid, price, quantity: qty, orderType: 2 });
  const fills = (res.fills ?? []).map((f: any) => ({ qty: f.quantityFilled.toString(), price: f.fillPrice.toString() }));
  let qtyFilled = 0n, notionalRaw = 0n;
  for (const f of (res.fills ?? []) as any[]) { qtyFilled += f.quantityFilled; notionalRaw += (BigInt(f.quantityFilled) * BigInt(f.fillPrice)) / (10n ** BigInt(m.baseDecimals)); }
  const avgFill = qtyFilled > 0n ? Number(formatUnits((notionalRaw * (10n ** BigInt(m.baseDecimals))) / qtyFilled, m.quoteDecimals)) : 0;
  // wait briefly then read authoritative position + locked margin
  await sleep(1200);
  const pos: any = await client.client.getPerpPosition({ marginBank: m.marginBank, account: wallets[walletId].address, pool: m.poolAddress });
  // margin locked: read the position's own IM requirement, but never trust a
  // figure below 1% of notional — a read taken mid-fill reports a stub margin
  const imfMargin = notionalUsd * (Number(m.initialMarginBps ?? 500) / 10000);
  let marginLockedUsd = imfMargin;
  try {
    const an: any = await client.client.getPerpPositionAnalytics({ marginBank: m.marginBank, pool: m.poolAddress, account: wallets[walletId].address });
    if (an?.initialMarginRequirement !== undefined) {
      const read = Number(formatUnits(BigInt(an.initialMarginRequirement), 18));
      if (read >= notionalUsd * 0.01) marginLockedUsd = read;
    }
  } catch {}
  return {
    wallet: walletId, tx: res.hash, orderId: res.orderId?.toString(),
    qtyFilled: qtyFilled.toString(), qtyFilledNum: Number(formatUnits(qtyFilled, m.baseDecimals)),
    avgFillPrice: avgFill, fills: fills.map((f: any) => ({ qty: formatUnits(BigInt(f.qty), m.baseDecimals), price: formatUnits(BigInt(f.price), m.quoteDecimals) })),
    positionSize: formatUnits(BigInt(pos.size), m.baseDecimals),
    entryPrice: pos.avgEntryPrice ? Number(formatUnits(BigInt(pos.avgEntryPrice), m.quoteDecimals)) : avgFill,
    markAtPlace: markNum, marginLockedUsd, openedAt: new Date().toISOString(),
  };
}

/** Close the wallet's entire position in symbol with opposite IOC. Returns exit info. */
export async function closePosition(walletId: WalletId, symbol: string) {
  const m = await market(symbol);
  const client = clients[walletId];
  const pos: any = await client.client.getPerpPosition({ marginBank: m.marginBank, account: wallets[walletId].address, pool: m.poolAddress });
  const size = BigInt(pos.size);
  if (size === 0n) return { wallet: walletId, tx: null, qtyFilledNum: 0, avgFillPrice: 0, flat: true, accruedFundingUsd: 0 };
  let accruedFundingUsd = 0;
  try {
    const an: any = await client.client.getPerpPositionAnalytics({ marginBank: m.marginBank, pool: m.poolAddress, account: wallets[walletId].address });
    if (an && an.accruedFunding !== undefined) accruedFundingUsd = Number(formatUnits(BigInt(an.accruedFunding), 18));
  } catch {}
  const isBid = size < 0n; // long position -> sell (isBid false); short -> buy
  const st: any = await client.client.getPerpState(m.poolAddress);
  const mark: bigint = st.markPrice;
  const cross = isBid ? (mark * 1005n) / 1000n : (mark * 995n) / 1000n;
  const price = alignPrice(cross, BigInt(m.tickSize), isBid);
  const qtyAbs = size < 0n ? -size : size;
  let res: any = await client.trader.placePerpOrder({ pool: m.poolAddress, isBid, price, quantity: qtyAbs, orderType: 2 });
  let qtyFilled = 0n, notionalRaw = 0n;
  const tally = (r: any) => {
    for (const f of (r.fills ?? []) as any[]) {
      qtyFilled += BigInt(f.quantityFilled);
      notionalRaw += (BigInt(f.quantityFilled) * BigInt(f.fillPrice)) / (10n ** BigInt(m.baseDecimals));
    }
  };
  tally(res);
  if (qtyFilled === 0n) {
    // a close that touched nothing must not be reported as a zero price:
    // retry once with a wider cross before giving up
    const wide = isBid ? (mark * 1020n) / 1000n : (mark * 980n) / 1000n;
    const price2 = alignPrice(wide, BigInt(m.tickSize), isBid);
    res = await client.trader.placePerpOrder({ pool: m.poolAddress, isBid, price: price2, quantity: qtyAbs, orderType: 2 });
    tally(res);
  }
  const avgFill = qtyFilled > 0n ? Number(formatUnits((notionalRaw * (10n ** BigInt(m.baseDecimals))) / qtyFilled, m.quoteDecimals)) : null;
  await sleep(1200);
  const after: any = await client.client.getPerpPosition({ marginBank: m.marginBank, account: wallets[walletId].address, pool: m.poolAddress });
  return { wallet: walletId, tx: res.hash, qtyFilledNum: Number(formatUnits(qtyFilled, m.baseDecimals)), avgFillPrice: avgFill, flat: BigInt(after.size) === 0n, remaining: formatUnits(BigInt(after.size), m.baseDecimals), accruedFundingUsd, closeFailed: qtyFilled === 0n || !avgFill };
}

export async function positionOf(walletId: WalletId, symbol: string) {
  const m = await market(symbol);
  const pos: any = await clients[walletId].client.getPerpPosition({ marginBank: m.marginBank, account: wallets[walletId].address, pool: m.poolAddress });
  const ma: any = await clients[walletId].client.getMarginAccount(m.marginBank, wallets[walletId].address);
  let liquidationPrice: number | null = null;
  if (BigInt(pos.size) !== 0n) {
    try {
      const lp: any = await clients[walletId].client.getLiquidationPrice({ marginBank: m.marginBank, pool: m.poolAddress, account: wallets[walletId].address });
      if (lp !== null && lp !== undefined && BigInt(lp) > 0n) liquidationPrice = Number(formatUnits(BigInt(lp), m.quoteDecimals));
    } catch {}
  }
  return {
    wallet: walletId, address: wallets[walletId].address,
    size: formatUnits(BigInt(pos.size), m.baseDecimals),
    entryPrice: pos.avgEntryPrice ? Number(formatUnits(BigInt(pos.avgEntryPrice), m.quoteDecimals)) : 0,
    equityUsd: Number(formatUnits(ma.equity, 18)), marginStatus: ma.marginStatus,
    lockedUsd: Number(formatUnits(ma.lockedCollateral, 18)), liquidationPrice,
  };
}

/** Close every open house position across duel markets. Used on startup so a
 *  crashed/restarted engine never leaves stale positions eating margin. */
export async function flattenAll() {
  const out: any[] = [];
  for (const w of ["A", "B"] as WalletId[]) {
    for (const sym of ["BTC", "ETH", "SOL", "HYPE"]) {
      const p = await positionOf(w, sym);
      if (p.size !== "0") out.push(await closePosition(w, sym));
    }
  }
  return out;
}

export async function ensureMargin(walletId: WalletId, symbol: string, minUsd = 18) {
  const m = await market(symbol);
  const ma: any = await clients[walletId].client.getMarginAccount(m.marginBank, wallets[walletId].address);
  const unlocked = Number(formatUnits(ma.unlockedCollateralBalance, 18));
  if (unlocked >= minUsd) return { toppedUp: false, unlocked };
  // try deposit from wallet token balance (works for A which holds wallet USDso)
  const bal: bigint = await clients[walletId].client.getErc20Balance(m.quoteToken, wallets[walletId].address);
  const balNum = Number(formatUnits(bal, 18));
  if (balNum < 5) return { toppedUp: false, unlocked, note: "low margin and low wallet USDso" };
  const amount = parseUnits(Math.min(30, balNum - 1).toFixed(2), 18);
  const res: any = await clients[walletId].trader.depositMargin({ marginBank: m.marginBank, amount });
  return { toppedUp: true, tx: res.hash, unlocked };
}
