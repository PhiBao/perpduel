use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

const NOTIONAL_USD: f64 = 100.0;
const EXPLORER: &str = "https://smk-dev-markets-explorer-hideki-euw4-uzavbo36ra-ez.a.run.app/tx/";

fn executor_url() -> String { std::env::var("EXECUTOR_URL").unwrap_or_else(|_| "http://127.0.0.1:4101".into()) }
fn executor_secret() -> String { std::env::var("EXECUTOR_SECRET").unwrap_or_else(|_| "perpduel-local".into()) }

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "UPPERCASE")]
enum Side { Long, Short }
impl Side { fn opposite(&self) -> Side { match self { Side::Long => Side::Short, Side::Short => Side::Long } }
            fn is_bid(&self) -> bool { matches!(self, Side::Long) } }

#[derive(Clone, Serialize, Deserialize, Debug)]
struct Player {
    name: String,
    side: Side,
    wallet: String, // "A" | "B"
    wallet_address: Option<String>,
    entry_price: Option<f64>,
    qty: Option<f64>,
    open_tx: Option<String>,
    close_tx: Option<String>,
    exit_price: Option<f64>,
    pnl_usd: f64,
    ghost: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct Duel {
    id: String,
    market: String,
    duration_sec: u64,
    status: String, // WAITING | OPENING | LIVE | CLOSING | FINISHED | VOID
    creator: Player,
    opponent: Option<Player>,
    created_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
    mark_price: Option<f64>,
    winner: Option<String>,
    void_reason: Option<String>,
    notional_usd: f64,
}

#[derive(Clone)]
struct AppState {
    duels: Arc<Mutex<HashMap<String, Duel>>>,
    http: reqwest::Client,
    store_path: String,
}

#[derive(Deserialize)]
struct CreateReq { name: String, market: String, side: Side, duration_sec: u64 }
#[derive(Deserialize)]
struct JoinReq { name: String }

async fn exec_get(state: &AppState, path: &str) -> Result<serde_json::Value, String> {
    let r = state.http.get(format!("{}{}", executor_url(), path))
        .header("x-executor-secret", executor_secret()).send().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
    if v.get("error").is_some() { return Err(v["error"].as_str().unwrap_or("executor error").to_string()); }
    Ok(v)
}
async fn exec_post(state: &AppState, path: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let r = state.http.post(format!("{}{}", executor_url(), path))
        .header("x-executor-secret", executor_secret()).json(&body).send().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
    if v.get("error").is_some() { return Err(format!("{} ({})", v["error"].as_str().unwrap_or("executor error"), v["code"].as_str().unwrap_or(""))); }
    Ok(v)
}
async fn mark_price(state: &AppState, market: &str) -> Result<f64, String> {
    let v = exec_get(state, &format!("/state?market={}", market)).await?;
    v["markPrice"].as_str().and_then(|s| s.parse::<f64>().ok()).ok_or_else(|| "no mark".to_string())
}
fn pnl(entry: f64, mark: f64, qty_signed: f64) -> f64 { (mark - entry) * qty_signed }

async fn persist(state: &AppState) {
    let duels = state.duels.lock().await;
    let mut list: Vec<Duel> = duels.values().cloned().collect();
    list.sort_by_key(|d| d.created_at);
    let _ = tokio::fs::write(&state.store_path, serde_json::to_string_pretty(&list).unwrap_or_default()).await;
}
async fn load(state: &AppState) {
    if let Ok(data) = tokio::fs::read_to_string(&state.store_path).await {
        if let Ok(list) = serde_json::from_str::<Vec<Duel>>(&data) {
            let mut map = state.duels.lock().await;
            for d in list { map.insert(d.id.clone(), d); }
        }
    }
}

async fn wallet_addr(s: &AppState, wallet: &str) -> Option<String> {
    let v = exec_get(s, &format!("/position?wallet={}&market=BTC", wallet)).await.ok()?;
    v["address"].as_str().map(|x| x.to_string())
}

async fn create_duel(State(s): State<AppState>, Json(req): Json<CreateReq>) -> Result<Json<Duel>, (StatusCode, String)> {
    let name = req.name.trim();
    if name.is_empty() || name.len() > 24 { return Err((StatusCode::BAD_REQUEST, "name 1-24 chars".into())); }
    if !["BTC", "ETH"].contains(&req.market.as_str()) { return Err((StatusCode::BAD_REQUEST, "market BTC or ETH".into())); }
    if ![60, 300, 900].contains(&req.duration_sec) { return Err((StatusCode::BAD_REQUEST, "duration 60, 300 or 900".into())); }
    let duel = Duel {
        id: Uuid::new_v4().to_string()[..8].to_string(),
        market: req.market, duration_sec: req.duration_sec,
        status: "WAITING".into(),
        creator: Player { name: name.to_string(), side: req.side, wallet: "A".into(), wallet_address: wallet_addr(&s, "A").await, entry_price: None, qty: None, open_tx: None, close_tx: None, exit_price: None, pnl_usd: 0.0, ghost: false },
        opponent: None, created_at: Utc::now(), started_at: None, ends_at: None, finished_at: None,
        mark_price: None, winner: None, void_reason: None, notional_usd: NOTIONAL_USD,
    };
    s.duels.lock().await.insert(duel.id.clone(), duel.clone());
    persist(&s).await;
    Ok(Json(duel))
}

async fn get_duel(State(s): State<AppState>, Path(id): Path<String>) -> Result<Json<Duel>, StatusCode> {
    let duels = s.duels.lock().await;
    duels.get(&id).cloned().map(Json).ok_or(StatusCode::NOT_FOUND)
}

async fn list_duels(State(s): State<AppState>) -> Json<Vec<Duel>> {
    let duels = s.duels.lock().await;
    let mut list: Vec<Duel> = duels.values().cloned().collect();
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Json(list.into_iter().take(20).collect())
}

async fn join_duel(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<JoinReq>) -> Result<Json<Duel>, (StatusCode, String)> {
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 24 { return Err((StatusCode::BAD_REQUEST, "name 1-24 chars".into())); }
    {
        let mut duels = s.duels.lock().await;
        let d = duels.get_mut(&id).ok_or((StatusCode::NOT_FOUND, "duel not found".into()))?;
        if d.status != "WAITING" { return Err((StatusCode::CONFLICT, "duel not waiting".into())); }
        if d.opponent.is_some() { return Err((StatusCode::CONFLICT, "already joined".into())); }
        d.opponent = Some(Player { name, side: d.creator.side.opposite(), wallet: "B".into(), wallet_address: None, entry_price: None, qty: None, open_tx: None, close_tx: None, exit_price: None, pnl_usd: 0.0, ghost: false });
    }
    persist(&s).await;
    start_duel_inner(&s, &id).await?;
    get_duel(State(s), Path(id)).await.map_err(|c| (c, "gone".into()))
}

async fn ghost_duel(State(s): State<AppState>, Path(id): Path<String>) -> Result<Json<Duel>, (StatusCode, String)> {
    {
        let mut duels = s.duels.lock().await;
        let d = duels.get_mut(&id).ok_or((StatusCode::NOT_FOUND, "duel not found".into()))?;
        if d.status != "WAITING" { return Err((StatusCode::CONFLICT, "duel not waiting".into())); }
        if d.opponent.is_some() { return Err((StatusCode::CONFLICT, "already joined".into())); }
        d.opponent = Some(Player { name: "GHOST".into(), side: d.creator.side.opposite(), wallet: "B".into(), wallet_address: None, entry_price: None, qty: None, open_tx: None, close_tx: None, exit_price: None, pnl_usd: 0.0, ghost: true });
    }
    persist(&s).await;
    start_duel_inner(&s, &id).await?;
    get_duel(State(s), Path(id)).await.map_err(|c| (c, "gone".into()))
}

async fn start_duel_inner(s: &AppState, id: &str) -> Result<(), (StatusCode, String)> {
    // global single-live-duel guard (two house wallets)
    {
        let duels = s.duels.lock().await;
        if duels.values().any(|d| (d.status == "LIVE" || d.status == "OPENING" || d.status == "CLOSING") && d.id != id) {
            // mark this duel back to waiting is complex; surface busy
            return Err((StatusCode::CONFLICT, "ARENA_BUSY: another duel is live on the house wallets".into()));
        }
        let d = duels.get(id).ok_or((StatusCode::NOT_FOUND, "not found".into()))?;
        if d.opponent.is_none() { return Err((StatusCode::CONFLICT, "no opponent yet".into())); }
    }
    let (market, creator_wallet, creator_bid, opp_wallet, opp_bid) = {
        let mut duels = s.duels.lock().await;
        let d = duels.get_mut(id).unwrap();
        d.status = "OPENING".into();
        (d.market.clone(), d.creator.wallet.clone(), d.creator.side.is_bid(), d.opponent.as_ref().unwrap().wallet.clone(), d.opponent.as_ref().unwrap().side.is_bid())
    };
    persist(s).await;

    // open both sides (creator first, then opponent)
    let open_c = exec_post(s, "/place", serde_json::json!({"wallet": creator_wallet, "market": market, "isBid": creator_bid, "notionalUsd": NOTIONAL_USD})).await;
    let open_o = match &open_c {
        Ok(_) => exec_post(s, "/place", serde_json::json!({"wallet": opp_wallet, "market": market, "isBid": opp_bid, "notionalUsd": NOTIONAL_USD})).await,
        Err(e) => Err(e.clone()),
    };

    match (open_c, open_o) {
        (Ok(c), Ok(o)) => {
            let now = Utc::now();
            let addr_a = wallet_addr(s, "A").await;
            let addr_b = wallet_addr(s, "B").await;
            let mut duels = s.duels.lock().await;
            let d = duels.get_mut(id).unwrap();
            let dur = d.duration_sec;
            d.creator.wallet_address = addr_a;
            if let Some(op) = d.opponent.as_mut() { op.wallet_address = addr_b.clone(); }
            d.creator.entry_price = c["entryPrice"].as_f64();
            d.creator.qty = c["qtyFilledNum"].as_f64();
            d.creator.open_tx = c["tx"].as_str().map(|x| x.to_string());
            if let Some(op) = d.opponent.as_mut() {
                op.entry_price = o["entryPrice"].as_f64();
                op.qty = o["qtyFilledNum"].as_f64();
                op.open_tx = o["tx"].as_str().map(|x| x.to_string());
            }
            // abort if either side got no fill
            if d.creator.qty.unwrap_or(0.0) <= 0.0 || d.opponent.as_ref().map(|o| o.qty.unwrap_or(0.0)).unwrap_or(0.0) <= 0.0 {
                d.status = "VOID".into();
                d.void_reason = Some("NO_FILL: one side filled nothing on the testnet book".into());
                d.finished_at = Some(now);
            } else {
                d.status = "LIVE".into();
                d.started_at = Some(now);
                d.ends_at = Some(now + chrono::Duration::seconds(dur as i64));
            }
            drop(duels);
            persist(s).await;
            // if void, best-effort close any partial position
            // (executor close is flat-safe)
            Ok(())
        }
        (Err(e), _) | (_, Err(e)) => {
            let mut duels = s.duels.lock().await;
            if let Some(d) = duels.get_mut(id) {
                d.status = "VOID".into();
                d.void_reason = Some(format!("OPEN_FAILED: {}", e));
                d.finished_at = Some(Utc::now());
            }
            drop(duels);
            persist(s).await;
            // best-effort flatten both wallets on this market
            let _ = exec_post(s, "/close", serde_json::json!({"wallet": "A", "market": market})).await;
            let _ = exec_post(s, "/close", serde_json::json!({"wallet": "B", "market": market})).await;
            Err((StatusCode::BAD_GATEWAY, e))
        }
    }
}

/// Background loop: update live PnL each second, close duels at expiry.
async fn duel_loop(s: AppState) {
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        let live_ids: Vec<String> = {
            let duels = s.duels.lock().await;
            duels.values().filter(|d| d.status == "LIVE").map(|d| d.id.clone()).collect()
        };
        for id in live_ids {
            let (market, ends_at) = {
                let duels = s.duels.lock().await;
                match duels.get(&id) { Some(d) => (d.market.clone(), d.ends_at), None => continue }
            };
            let mark = match mark_price(&s, &market).await { Ok(m) => m, Err(_) => continue };
            let expired = ends_at.map(|e| Utc::now() >= e).unwrap_or(false);
            if !expired {
                let mut duels = s.duels.lock().await;
                if let Some(d) = duels.get_mut(&id) {
                    d.mark_price = Some(mark);
                    if let (Some(e), Some(q)) = (d.creator.entry_price, d.creator.qty) {
                        let signed = if d.creator.side.is_bid() { q } else { -q };
                        d.creator.pnl_usd = pnl(e, mark, signed);
                    }
                    if let Some(op) = d.opponent.as_mut() {
                        if let (Some(e), Some(q)) = (op.entry_price, op.qty) {
                            let signed = if op.side.is_bid() { q } else { -q };
                            op.pnl_usd = pnl(e, mark, signed);
                        }
                    }
                }
                drop(duels);
                continue;
            }
            // expiry -> close both
            {
                let mut duels = s.duels.lock().await;
                if let Some(d) = duels.get_mut(&id) { d.status = "CLOSING".into(); d.mark_price = Some(mark); }
            }
            persist(&s).await;
            let close_a = exec_post(&s, "/close", serde_json::json!({"wallet": "A", "market": market})).await;
            let close_b = exec_post(&s, "/close", serde_json::json!({"wallet": "B", "market": market})).await;
            let mut duels = s.duels.lock().await;
            if let Some(d) = duels.get_mut(&id) {
                // creator is wallet A by construction, opponent wallet B
                if let Ok(c) = &close_a {
                    d.creator.close_tx = c["tx"].as_str().map(|x| x.to_string());
                    d.creator.exit_price = c["avgFillPrice"].as_f64();
                }
                if let Ok(c) = &close_b {
                    if let Some(op) = d.opponent.as_mut() {
                        op.close_tx = c["tx"].as_str().map(|x| x.to_string());
                        op.exit_price = c["avgFillPrice"].as_f64();
                    }
                }
                // final PnL from exit fills when available, else mark
                let exit_mark = mark;
                if let (Some(e), Some(q), ex) = (d.creator.entry_price, d.creator.qty, d.creator.exit_price) {
                    let signed = if d.creator.side.is_bid() { q } else { -q };
                    d.creator.pnl_usd = pnl(e, ex.unwrap_or(exit_mark), signed);
                }
                let mut winner = None;
                if let Some(op) = d.opponent.as_mut() {
                    if let (Some(e), Some(q), ex) = (op.entry_price, op.qty, op.exit_price) {
                        let signed = if op.side.is_bid() { q } else { -q };
                        op.pnl_usd = pnl(e, ex.unwrap_or(exit_mark), signed);
                    }
                    winner = Some(if d.creator.pnl_usd >= op.pnl_usd { d.creator.name.clone() } else { op.name.clone() });
                }
                d.winner = winner;
                d.status = "FINISHED".into();
                d.finished_at = Some(Utc::now());
            }
            drop(duels);
            persist(&s).await;
        }
    }
}

async fn markets(State(s): State<AppState>) -> Json<serde_json::Value> {
    let mut out = vec![];
    for sym in ["BTC", "ETH"] {
        if let Ok(m) = mark_price(&s, sym).await { out.push(serde_json::json!({"symbol": sym, "markPrice": m})); }
    }
    Json(serde_json::json!({"markets": out, "explorerTxBase": EXPLORER, "notionalUsd": NOTIONAL_USD}))
}

async fn card(State(s): State<AppState>, Path(id): Path<String>) -> Result<([(axum::http::HeaderName, &'static str); 1], String), StatusCode> {
    let duels = s.duels.lock().await;
    let d = duels.get(&id).ok_or(StatusCode::NOT_FOUND)?;
    let opp = d.opponent.clone().unwrap_or(Player { name: "—".into(), side: d.creator.side.opposite(), wallet: "B".into(), wallet_address: None, entry_price: None, qty: None, open_tx: None, close_tx: None, exit_price: None, pnl_usd: 0.0, ghost: false });
    let win = d.winner.clone().unwrap_or_else(|| "—".into());
    let _ = &s;
    let svg = format!(r##"<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#0a0a0a"/>
<rect x="0" y="0" width="600" height="630" fill="#0f2e1a"/><rect x="600" y="0" width="600" height="630" fill="#2e0f14"/>
<text x="600" y="90" text-anchor="middle" fill="#f5f0e6" font-family="monospace" font-size="34" letter-spacing="6">PERPDUEL · {market}-PERP · PROOF ON-CHAIN</text>
<text x="300" y="240" text-anchor="middle" fill="#3dff7a" font-family="monospace" font-size="52" font-weight="bold">{cname}</text>
<text x="300" y="310" text-anchor="middle" fill="#f5f0e6" font-family="monospace" font-size="36">{cpnl:+.2} USDso</text>
<text x="900" y="240" text-anchor="middle" fill="#ff3b5c" font-family="monospace" font-size="52" font-weight="bold">{oname}</text>
<text x="900" y="310" text-anchor="middle" fill="#f5f0e6" font-family="monospace" font-size="36">{opnl:+.2} USDso</text>
<text x="600" y="470" text-anchor="middle" fill="#ffd23f" font-family="monospace" font-size="64" font-weight="bold">WINNER: {win}</text>
<text x="600" y="560" text-anchor="middle" fill="#9a958a" font-family="monospace" font-size="26">dreamDEX perps · Somnia Hideki testnet · duel #{id}</text>
</svg>"##, market = d.market, cname = xml(&d.creator.name), cpnl = d.creator.pnl_usd, oname = xml(&opp.name), opnl = opp.pnl_usd, win = xml(&win), id = d.id);
    Ok(([(axum::http::header::CONTENT_TYPE, "image/svg+xml")], svg))
}
fn xml(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;") }

#[tokio::main]
async fn main() {
    let store_path = std::env::var("DUEL_STORE").unwrap_or_else(|_| "duels.json".into());
    let state = AppState { duels: Arc::new(Mutex::new(HashMap::new())), http: reqwest::Client::new(), store_path };
    load(&state).await;
    // any duel left LIVE/OPENING/CLOSING from a previous run cannot be trusted; void it
    {
        let mut duels = state.duels.lock().await;
        for d in duels.values_mut() {
            if ["LIVE", "OPENING", "CLOSING"].contains(&d.status.as_str()) {
                d.status = "VOID".into();
                d.void_reason = Some("SERVER_RESTART during duel; positions must be checked manually".into());
            }
        }
    }
    tokio::spawn(duel_loop(state.clone()));
    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/api/markets", get(markets))
        .route("/api/duels", post(create_duel).get(list_duels))
        .route("/api/duels/:id", get(get_duel))
        .route("/api/duels/:id/join", post(join_duel))
        .route("/api/duels/:id/ghost", post(ghost_duel))
        .route("/api/duels/:id/card.svg", get(card))
        .layer(cors)
        .with_state(state);
    let port: u16 = std::env::var("BACKEND_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(4102);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    println!("perpduel-backend on 127.0.0.1:{}", port);
    axum::serve(listener, app).await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pnl_long_and_short() {
        assert!((pnl(100.0, 110.0, 0.5) - 5.0).abs() < 1e-9);
        assert!((pnl(100.0, 110.0, -0.5) + 5.0).abs() < 1e-9);
        assert!((pnl(100.0, 90.0, 0.5) + 5.0).abs() < 1e-9);
    }
    #[test]
    fn opposite_sides() {
        assert!(Side::Long.opposite().is_bid() == false);
        assert!(Side::Short.opposite().is_bid() == true);
    }
}
