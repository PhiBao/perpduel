import { createServer } from "node:http";
import { initWallets, walletAddress, marketState, placeOrder, closePosition, positionOf, ensureMargin } from "./duel-core.js";

const PORT = Number(process.env.EXECUTOR_PORT ?? 4101);
const SECRET = process.env.EXECUTOR_SECRET ?? "perpduel-local";
initWallets();

function send(res: any, code: number, obj: any) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(body);
}
async function body(req: any): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

const server = createServer(async (req, res) => {
  try {
    if (req.headers["x-executor-secret"] !== SECRET) return send(res, 401, { error: "unauthorized" });
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, walletA: walletAddress("A"), walletB: walletAddress("B") });
    }
    if (req.method === "GET" && url.pathname === "/state") {
      return send(res, 200, await marketState(url.searchParams.get("market") ?? "BTC"));
    }
    if (req.method === "GET" && url.pathname === "/position") {
      return send(res, 200, await positionOf((url.searchParams.get("wallet") ?? "A") as any, url.searchParams.get("market") ?? "BTC"));
    }
    if (req.method === "POST" && url.pathname === "/place") {
      const b = await body(req);
      await ensureMargin(b.wallet, b.market ?? "BTC");
      return send(res, 200, await placeOrder(b.wallet, b.market ?? "BTC", Boolean(b.isBid), Number(b.notionalUsd ?? 30)));
    }
    if (req.method === "POST" && url.pathname === "/close") {
      const b = await body(req);
      return send(res, 200, await closePosition(b.wallet, b.market ?? "BTC"));
    }
    return send(res, 404, { error: "not found" });
  } catch (e: any) {
    return send(res, 500, { error: e?.message ?? String(e), code: e?.code ?? "EXECUTOR_ERROR" });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`executor on 127.0.0.1:${PORT} A=${walletAddress("A")} B=${walletAddress("B")}`));
