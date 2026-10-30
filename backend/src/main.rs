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

const EXPLORER: &str = "https://smk-dev-markets-explorer-hideki-euw4-uzavbo36ra-ez.a.run.app/tx/";
const MARKETS: [&str; 4] = ["BTC", "ETH", "SOL", "HYPE"];
const NOTIONALS: [f64; 3] = [100.0, 250.0, 500.0];

fn executor_url() -> String { std::env::var("EXECUTOR_URL").unwrap_or_else(|_| "http://127.0.0.1:4101".into()) }
fn executor_secret() -> String { std::env::var("EXECUTOR_SECRET").unwrap_or_else(|_| "perpduel-local".into()) }

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "UPPERCASE")]
enum Side { Long, Short }
impl Side {
    fn opposite(&self) -> Side { match self { Side::Long => Side::Short, Side::Short => Side::Long } }
    fn is_bid(&self) -> bool { matches!(self, Side::Long) }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct Player {
    name: String,
    side: Side,
    wallet: String,
    wallet_address: Option<String>,
    entry_price: Option<f64>,
    qty: Option<f64>,
    open_tx: Option<String>,
    close_tx: Option<String>,
    exit_price: Option<f64>,
    pnl_usd: f64,
    #[serde(default)]
    price_pnl_usd: f64,
    #[serde(default)]
    funding_usd: f64,
    #[serde(default)]
    spread_cost_usd: f64,
    #[serde(default)]
    margin_locked_usd: Option<f64>,
    #[serde(default)]
    roe_pct: Option<f64>,
    #[serde(default)]
    mark_at_open: Option<f64>,
    #[serde(default)]
    opened_at: Option<DateTime<Utc>>,
    #[serde(default)]
    liq_price: Option<f64>,
    #[serde(default)]
    cashed_out: bool,
    #[serde(default)]
    close_failed: bool,
    ghost: bool,
    #[serde(skip_serializing)]
    token: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct Duel {
    id: String,
    market: String,
    duration_sec: u64,
    status: String, // WAITING | OPENING | LIVE | CLOSING | FINISHED | VOID
    creator: Player,
    opponent: Option<Player>,
    #[serde(default)]
    reserved_opponent: Option<String>,
    created_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
    mark_price: Option<f64>,
    winner: Option<String>,
    void_reason: Option<String>,
    #[serde(default)]
    settle_reason: Option<String>,
    #[serde(default)]
    cashed_out_by: Option<String>,
    #[serde(default)]
    entry_gap_sec: Option<f64>,
    #[serde(default)]
    price_history: Vec<[f64; 2]>,
    #[serde(default)]
    series_id: Option<String>,
    notional_usd: f64,
    #[serde(default)]
    series_score: Option<String>,
}

#[derive(Clone)]
struct AppState {
    duels: Arc<Mutex<HashMap<String, Duel>>>,
    http: reqwest::Client,
    store_path: String,
}

#[derive(Deserialize)]
struct CreateReq { name: String, market: String, side: Side, duration_sec: u64, notional_usd: Option<f64> }
#[derive(Deserialize)]
struct JoinReq { name: String }
#[derive(Deserialize)]
struct TokenReq { token: String }

#[derive(Serialize)]
struct DuelResp { #[serde(flatten)] duel: Duel, token: Option<String> }

fn blank_player(name: String, side: Side, wallet: &str, ghost: bool) -> Player {
    Player { name, side, wallet: wallet.into(), wallet_address: None, entry_price: None, qty: None,
        open_tx: None, close_tx: None, exit_price: None, pnl_usd: 0.0, price_pnl_usd: 0.0, funding_usd: 0.0,
        spread_cost_usd: 0.0, margin_locked_usd: None, roe_pct: None, mark_at_open: None, opened_at: None,
        liq_price: None, cashed_out: false, close_failed: false, ghost, token: None }
}
fn signed_qty(p: &Player) -> f64 {
    let q = p.qty.unwrap_or(0.0);
    if p.side.is_bid() { q } else { -q }
}
fn roe(pnl: f64, margin: Option<f64>) -> Option<f64> {
    margin.filter(|m| *m > 0.01).map(|m| pnl / m * 100.0)
}

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
fn pnl_at(entry: f64, price: f64, qty_signed: f64) -> f64 { (price - entry) * qty_signed }
async fn wallet_addr(s: &AppState, wallet: &str) -> Option<String> {
    let v = exec_get(s, &format!("/position?wallet={}&market=BTC", wallet)).await.ok()?;
    v["address"].as_str().map(|x| x.to_string())
}

async fn persist(state: &AppState) {
    let duels = state.duels.lock().await;
    let mut list: Vec<Duel> = duels.values().cloned().collect();
    list.sort_by_key(|d| d.created_at);
    let tmp = format!("{}.tmp", state.store_path);
    if tokio::fs::write(&tmp, serde_json::to_string_pretty(&list).unwrap_or_default()).await.is_ok() {
        let _ = tokio::fs::rename(&tmp, &state.store_path).await;
    }
}
async fn load(state: &AppState) {
    if let Ok(data) = tokio::fs::read_to_string(&state.store_path).await {
        if let Ok(list) = serde_json::from_str::<Vec<Duel>>(&data) {
            let mut map = state.duels.lock().await;
            for d in list { map.insert(d.id.clone(), d); }
        }
    }
}

async fn enrich(s: &AppState, d: &mut Duel) {
    if let Some(sid) = d.series_id.clone() {
        let duels = s.duels.lock().await;
        let (mut cw, mut ow) = (0, 0);
        let opp_name = d.opponent.as_ref().map(|o| o.name.to_lowercase());
        for x in duels.values() {
            if x.series_id.as_deref() == Some(sid.as_str()) && x.status == "FINISHED" {
                if let Some(w) = &x.winner {
                    if *w == d.creator.name { cw += 1; }
                    else if Some(w.to_lowercase()) == opp_name { ow += 1; }
                }
            }
        }
        if cw + ow >= 2 { d.series_score = Some(format!("{} - {}", cw, ow)); }
    }
}

async fn create_duel(State(s): State<AppState>, Json(req): Json<CreateReq>) -> Result<Json<DuelResp>, (StatusCode, String)> {
    let name = req.name.trim();
    if name.is_empty() || name.len() > 24 { return Err((StatusCode::BAD_REQUEST, "name 1-24 chars".into())); }
    if !MARKETS.contains(&req.market.as_str()) { return Err((StatusCode::BAD_REQUEST, "market BTC, ETH, SOL or HYPE".into())); }
    if ![60, 300, 900].contains(&req.duration_sec) { return Err((StatusCode::BAD_REQUEST, "duration 60, 300 or 900".into())); }
    let notional = req.notional_usd.unwrap_or(100.0);
    if !NOTIONALS.contains(&notional) { return Err((StatusCode::BAD_REQUEST, "size 100, 250 or 500".into())); }
    {
        let duels = s.duels.lock().await;
        if duels.values().filter(|d| d.status == "WAITING").count() >= 30 {
            return Err((StatusCode::TOO_MANY_REQUESTS, "too many open challenges; try again shortly".into()));
        }
    }
    let token = Uuid::new_v4().to_string();
    let mut creator = blank_player(name.to_string(), req.side, "A", false);
    creator.wallet_address = wallet_addr(&s, "A").await;
    creator.token = Some(token.clone());
    let duel = Duel {
        id: Uuid::new_v4().to_string()[..8].to_string(),
        market: req.market, duration_sec: req.duration_sec, status: "WAITING".into(),
        creator, opponent: None, reserved_opponent: None,
        created_at: Utc::now(), started_at: None, ends_at: None, finished_at: None,
        mark_price: None, winner: None, void_reason: None, settle_reason: None, cashed_out_by: None,
        entry_gap_sec: None, price_history: vec![], series_id: None, notional_usd: notional, series_score: None,
    };
    s.duels.lock().await.insert(duel.id.clone(), duel.clone());
    {
        // drop unanswered challenges older than an hour
        let mut duels = s.duels.lock().await;
        let now = Utc::now();
        for d in duels.values_mut() {
            if d.status == "WAITING" && d.opponent.is_none() && (now - d.created_at).num_hours() >= 1 {
                d.status = "VOID".into();
                d.void_reason = Some("EXPIRED: challenge was never accepted".into());
            }
        }
    }
    persist(&s).await;
    Ok(Json(DuelResp { duel, token: Some(token) }))
}

async fn get_duel(State(s): State<AppState>, Path(id): Path<String>) -> Result<Json<Duel>, StatusCode> {
    let mut d = { s.duels.lock().await.get(&id).cloned().ok_or(StatusCode::NOT_FOUND)? };
    enrich(&s, &mut d).await;
    Ok(Json(d))
}
async fn list_duels(State(s): State<AppState>) -> Json<Vec<Duel>> {
    let mut list: Vec<Duel> = { s.duels.lock().await.values().cloned().collect() };
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let mut out = vec![];
    for mut d in list.into_iter().take(20) { enrich(&s, &mut d).await; out.push(d); }
    Json(out)
}

#[derive(Serialize)]
struct Standing { name: String, wins: i64, losses: i64, duels: i64, pnl_usd: f64, best_roe_pct: Option<f64>, streak: i64 }
async fn standings(State(s): State<AppState>) -> Json<Vec<Standing>> {
    let duels = s.duels.lock().await;
    let mut finished: Vec<Duel> = duels.values().filter(|d| d.status == "FINISHED").cloned().collect();
    finished.sort_by_key(|d| d.finished_at);
    let mut map: HashMap<String, Standing> = HashMap::new();
    for d in &finished {
        let players = [&d.creator, d.opponent.as_ref().unwrap()];
        if players.iter().any(|p| p.close_failed || p.pnl_usd.abs() > d.notional_usd * 0.9) { continue; }
        for p in players {
            let e = map.entry(p.name.clone()).or_insert(Standing { name: p.name.clone(), wins: 0, losses: 0, duels: 0, pnl_usd: 0.0, best_roe_pct: None, streak: 0 });
            e.duels += 1; e.pnl_usd += p.pnl_usd;
            if let Some(r) = p.roe_pct { e.best_roe_pct = Some(e.best_roe_pct.map(|b: f64| b.max(r)).unwrap_or(r)); }
            if d.winner.as_deref() == Some(p.name.as_str()) { e.wins += 1; e.streak = if e.streak >= 0 { e.streak + 1 } else { 1 }; }
            else { e.losses += 1; e.streak = if e.streak <= 0 { e.streak - 1 } else { -1 }; }
        }
    }
    let mut out: Vec<Standing> = map.into_values().collect();
    out.sort_by(|a, b| b.wins.cmp(&a.wins).then(b.pnl_usd.partial_cmp(&a.pnl_usd).unwrap_or(std::cmp::Ordering::Equal)));
    Json(out.into_iter().take(10).collect())
}

async fn join_duel(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<JoinReq>) -> Result<Json<DuelResp>, (StatusCode, String)> {
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 24 { return Err((StatusCode::BAD_REQUEST, "name 1-24 chars".into())); }
    let token = Uuid::new_v4().to_string();
    {
        let mut duels = s.duels.lock().await;
        let d = duels.get_mut(&id).ok_or((StatusCode::NOT_FOUND, "duel not found".into()))?;
        if d.status != "WAITING" { return Err((StatusCode::CONFLICT, "duel not waiting".into())); }
        if d.opponent.is_some() { return Err((StatusCode::CONFLICT, "already joined".into())); }
        if let Some(r) = &d.reserved_opponent {
            if !r.eq_ignore_ascii_case(&name) { return Err((StatusCode::FORBIDDEN, format!("this rematch is reserved for {}", r))); }
        }
        let mut opp = blank_player(name, d.creator.side.opposite(), "B", false);
        opp.token = Some(token.clone());
        d.opponent = Some(opp);
    }
    persist(&s).await;
    match start_duel_inner(&s, &id).await {
        Ok(()) => { let mut d = s.duels.lock().await.get(&id).cloned().unwrap(); enrich(&s, &mut d).await; Ok(Json(DuelResp { duel: d, token: Some(token) })) }
        Err(e) => {
            // roll back so the challenge can be accepted again (no stuck WAITING with opponent)
            let mut duels = s.duels.lock().await;
            if let Some(d) = duels.get_mut(&id) { if d.status == "WAITING" { d.opponent = None; } }
            drop(duels); persist(&s).await; Err(e)
        }
    }
}

async fn ghost_duel(State(s): State<AppState>, Path(id): Path<String>) -> Result<Json<Duel>, (StatusCode, String)> {
    {
        let mut duels = s.duels.lock().await;
        let d = duels.get_mut(&id).ok_or((StatusCode::NOT_FOUND, "duel not found".into()))?;
        if d.status != "WAITING" { return Err((StatusCode::CONFLICT, "duel not waiting".into())); }
        if d.opponent.is_some() { return Err((StatusCode::CONFLICT, "already joined".into())); }
        d.reserved_opponent = None;
        d.opponent = Some(blank_player("GHOST".into(), d.creator.side.opposite(), "B", true));
    }
    persist(&s).await;
    match start_duel_inner(&s, &id).await {
        Ok(()) => { let mut d = s.duels.lock().await.get(&id).cloned().unwrap(); enrich(&s, &mut d).await; Ok(Json(d)) }
        Err(e) => {
            let mut duels = s.duels.lock().await;
            if let Some(d) = duels.get_mut(&id) { if d.status == "WAITING" { d.opponent = None; } }
            drop(duels); persist(&s).await; Err(e)
        }
    }
}

async fn rematch(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<TokenReq>) -> Result<Json<DuelResp>, (StatusCode, String)> {
    let old = { s.duels.lock().await.get(&id).cloned().ok_or((StatusCode::NOT_FOUND, "duel not found".into()))? };
    if old.status != "FINISHED" { return Err((StatusCode::CONFLICT, "duel not finished".into())); }
    let opp_old = old.opponent.clone().ok_or((StatusCode::CONFLICT, "no opponent".into()))?;
    let mine = if old.creator.token.as_deref() == Some(req.token.as_str()) { old.creator.name.clone() }
        else if opp_old.token.as_deref() == Some(req.token.as_str()) { opp_old.name.clone() }
        else { return Err((StatusCode::FORBIDDEN, "only a fighter can call a rematch".into())); };
    let rival = if mine == old.creator.name { opp_old.name.clone() } else { old.creator.name.clone() };
    if rival == "GHOST" { return Err((StatusCode::CONFLICT, "the Ghost always accepts instantly — use Fight the Ghost on a new duel".into())); }
    {
        let duels = s.duels.lock().await;
        if duels.values().filter(|d| d.status == "WAITING").count() >= 30 { return Err((StatusCode::TOO_MANY_REQUESTS, "too many open challenges".into())); }
    }
    let token = Uuid::new_v4().to_string();
    // sides swap relative to the previous duel
    let my_old_side = if mine == old.creator.name { old.creator.side.clone() } else { opp_old.side.clone() };
    let mut creator = blank_player(mine, my_old_side.opposite(), "A", false);
    creator.wallet_address = wallet_addr(&s, "A").await;
    creator.token = Some(token.clone());
    let duel = Duel {
        id: Uuid::new_v4().to_string()[..8].to_string(),
        market: old.market.clone(), duration_sec: old.duration_sec, status: "WAITING".into(),
        creator, opponent: None, reserved_opponent: Some(rival),
        created_at: Utc::now(), started_at: None, ends_at: None, finished_at: None,
        mark_price: None, winner: None, void_reason: None, settle_reason: None, cashed_out_by: None,
        entry_gap_sec: None, price_history: vec![],
        series_id: Some(old.series_id.clone().unwrap_or_else(|| old.id.clone())),
        notional_usd: old.notional_usd, series_score: None,
    };
    s.duels.lock().await.insert(duel.id.clone(), duel.clone());
    persist(&s).await;
    Ok(Json(DuelResp { duel, token: Some(token) }))
}

async fn cashout(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<TokenReq>) -> Result<Json<Duel>, (StatusCode, String)> {
    let who = {
        let duels = s.duels.lock().await;
        let d = duels.get(&id).ok_or((StatusCode::NOT_FOUND, "duel not found".into()))?;
        if d.status != "LIVE" { return Err((StatusCode::CONFLICT, "duel not live".into())); }
        if d.creator.token.as_deref() == Some(req.token.as_str()) { d.creator.name.clone() }
        else if d.opponent.as_ref().and_then(|o| o.token.as_deref()) == Some(req.token.as_str()) { d.opponent.as_ref().unwrap().name.clone() }
        else { return Err((StatusCode::FORBIDDEN, "only a fighter can cash out".into())); }
    };
    settle(&s, &id, "CASHOUT", Some(who)).await;
    let mut d = s.duels.lock().await.get(&id).cloned().unwrap();
    enrich(&s, &mut d).await;
    Ok(Json(d))
}

async fn start_duel_inner(s: &AppState, id: &str) -> Result<(), (StatusCode, String)> {
    let (market, notional, creator_bid, opp_bid) = {
        let duels = s.duels.lock().await;
        if duels.values().any(|d| (d.status == "LIVE" || d.status == "OPENING" || d.status == "CLOSING") && d.id != id) {
            return Err((StatusCode::CONFLICT, "ARENA_BUSY: another duel is live on the house wallets — this challenge stays open, try again in a minute".into()));
        }
        let d = duels.get(id).ok_or((StatusCode::NOT_FOUND, "not found".into()))?;
        if d.opponent.is_none() { return Err((StatusCode::CONFLICT, "no opponent yet".into())); }
        (d.market.clone(), d.notional_usd, d.creator.side.is_bid(), d.opponent.as_ref().unwrap().side.is_bid())
    };
    {
        let mut duels = s.duels.lock().await;
        if let Some(d) = duels.get_mut(id) { d.status = "OPENING".into(); }
    }
    persist(s).await;

    // open both sides in parallel (different wallets — no nonce contention)
    let (open_c, open_o) = tokio::join!(
        exec_post(s, "/place", serde_json::json!({"wallet": "A", "market": market, "isBid": creator_bid, "notionalUsd": notional})),
        exec_post(s, "/place", serde_json::json!({"wallet": "B", "market": market, "isBid": opp_bid, "notionalUsd": notional}))
    );

    match (open_c, open_o) {
        (Ok(c), Ok(o)) => {
            let now = Utc::now();
            let (addr_a, addr_b) = tokio::join!(wallet_addr(s, "A"), wallet_addr(s, "B"));
            let mut duels = s.duels.lock().await;
            let d = duels.get_mut(id).unwrap();
            let dur = d.duration_sec;
            d.creator.wallet_address = addr_a;
            d.creator.entry_price = c["entryPrice"].as_f64();
            d.creator.qty = c["qtyFilledNum"].as_f64();
            d.creator.open_tx = c["tx"].as_str().map(|x| x.to_string());
            d.creator.mark_at_open = c["markAtPlace"].as_f64();
            d.creator.margin_locked_usd = c["marginLockedUsd"].as_f64();
            d.creator.opened_at = c["openedAt"].as_str().and_then(|x| x.parse::<DateTime<Utc>>().ok()).or(Some(now));
            if let Some(op) = d.opponent.as_mut() {
                op.wallet_address = addr_b;
                op.entry_price = o["entryPrice"].as_f64();
                op.qty = o["qtyFilledNum"].as_f64();
                op.open_tx = o["tx"].as_str().map(|x| x.to_string());
                op.mark_at_open = o["markAtPlace"].as_f64();
                op.margin_locked_usd = o["marginLockedUsd"].as_f64();
                op.opened_at = o["openedAt"].as_str().and_then(|x| x.parse::<DateTime<Utc>>().ok()).or(Some(now));
            }
            // spread cost at open: how much worse than the mark each entry was
            for p in [&mut d.creator] {
                if let (Some(e), Some(m)) = (p.entry_price, p.mark_at_open) { p.spread_cost_usd = -(m - e) * signed_qty(p); }
            }
            if let Some(op) = d.opponent.as_mut() {
                if let (Some(e), Some(m)) = (op.entry_price, op.mark_at_open) { op.spread_cost_usd = -(m - e) * signed_qty(op); }
            }
            if let (Some(a), Some(b)) = (d.creator.opened_at, d.opponent.as_ref().and_then(|o| o.opened_at)) {
                d.entry_gap_sec = Some((b - a).num_milliseconds() as f64 / 1000.0);
            }
            if d.creator.qty.unwrap_or(0.0) <= 0.0 || d.opponent.as_ref().map(|o| o.qty.unwrap_or(0.0)).unwrap_or(0.0) <= 0.0 {
                d.status = "VOID".into();
                d.void_reason = Some("NO_FILL: one side filled nothing on the testnet book".into());
                d.finished_at = Some(now);
            } else {
                d.status = "LIVE".into();
                d.started_at = Some(now);
                d.ends_at = Some(now + chrono::Duration::seconds(dur as i64));
                if let Some(m) = d.creator.mark_at_open { d.price_history.push([now.timestamp() as f64, m]); }
            }
            drop(duels);
            persist(s).await;
            Ok(())
        }
        (Err(e), _) | (_, Err(e)) => {
            {
                let mut duels = s.duels.lock().await;
                if let Some(d) = duels.get_mut(id) {
                    d.status = "VOID".into();
                    d.void_reason = Some(format!("OPEN_FAILED: {}", e));
                    d.finished_at = Some(Utc::now());
                }
            }
            persist(s).await;
            let _ = exec_post(s, "/close", serde_json::json!({"wallet": "A", "market": market})).await;
            let _ = exec_post(s, "/close", serde_json::json!({"wallet": "B", "market": market})).await;
            Err((StatusCode::BAD_GATEWAY, e))
        }
    }
}

/// Settle a live duel: close both positions in parallel, score from fills.
async fn settle(s: &AppState, id: &str, reason: &str, cashed_out_by: Option<String>) {
    let market = {
        let mut duels = s.duels.lock().await;
        match duels.get_mut(id) {
            Some(d) if d.status == "LIVE" || d.status == "CLOSING" => {
                d.status = "CLOSING".into();
                d.settle_reason = Some(reason.to_string());
                d.cashed_out_by = cashed_out_by.clone();
                if let Some(who) = &cashed_out_by {
                    if d.creator.name == *who { d.creator.cashed_out = true; }
                    if let Some(op) = d.opponent.as_mut() { if op.name == *who { op.cashed_out = true; } }
                }
                d.market.clone()
            }
            _ => return,
        }
    };
    persist(s).await;
    let (close_a, close_b) = tokio::join!(
        exec_post(s, "/close", serde_json::json!({"wallet": "A", "market": market})),
        exec_post(s, "/close", serde_json::json!({"wallet": "B", "market": market}))
    );
    let mut duels = s.duels.lock().await;
    if let Some(d) = duels.get_mut(id) {
        if let Ok(c) = &close_a {
            d.creator.close_tx = c["tx"].as_str().map(|x| x.to_string());
            d.creator.exit_price = c["avgFillPrice"].as_f64().filter(|v| *v > 0.0);
            d.creator.funding_usd = c["accruedFundingUsd"].as_f64().unwrap_or(0.0);
            d.creator.close_failed = c["closeFailed"].as_bool().unwrap_or(false);
        } else {
            d.creator.close_failed = true;
        }
        let mut opp_exit = None; let mut opp_funding = 0.0; let mut opp_tx = None; let opp_failed;
        if let Ok(c) = &close_b {
            opp_tx = c["tx"].as_str().map(|x| x.to_string());
            opp_exit = c["avgFillPrice"].as_f64().filter(|v| *v > 0.0);
            opp_funding = c["accruedFundingUsd"].as_f64().unwrap_or(0.0);
            opp_failed = c["closeFailed"].as_bool().unwrap_or(false);
        } else {
            opp_failed = true;
        }
        if let Some(op) = d.opponent.as_mut() {
            op.close_tx = opp_tx; op.exit_price = opp_exit; op.funding_usd = opp_funding; op.close_failed = opp_failed;
        }
        // final scoring: price PnL from fills, minus funding owed (positive accruedFunding = pays)
        let fallback = d.mark_price.unwrap_or(0.0);
        let imf_margin = d.notional_usd * 0.05;
        let mut score = |p: &mut Player| {
            if let (Some(e), Some(_q)) = (p.entry_price, p.qty) {
                let exit = p.exit_price.filter(|v| *v > 0.0).unwrap_or(fallback);
                if exit <= 0.0 { p.close_failed = true; return; }
                p.price_pnl_usd = pnl_at(e, exit, signed_qty(p));
                p.pnl_usd = p.price_pnl_usd - p.funding_usd;
                // a margin figure below 1% of notional is a failed read, not leverage
                let margin = p.margin_locked_usd.filter(|m| *m >= d.notional_usd * 0.01).or(Some(imf_margin));
                p.roe_pct = roe(p.pnl_usd, margin);
            }
        };
        // creator and opponent scored separately to satisfy the borrow checker
        let mut c = d.creator.clone(); score(&mut c); d.creator = c;
        if let Some(mut o) = d.opponent.clone() { score(&mut o); d.opponent = Some(o); }
        d.winner = d.opponent.as_ref().map(|op| {
            if d.creator.pnl_usd >= op.pnl_usd { d.creator.name.clone() } else { op.name.clone() }
        });
        d.status = "FINISHED".into();
        d.finished_at = Some(Utc::now());
        if d.series_id.is_none() { d.series_id = Some(d.id.clone()); }
    }
    drop(duels);
    persist(s).await;
}

/// Background loop: live PnL race, price tape, liquidation read, expiry.
async fn duel_loop(s: AppState) {
    let mut tick: u64 = 0;
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        tick += 1;
        // watchdog: a duel stuck mid-open or mid-close (hung RPC, restarted
        // executor) must not hold the arena hostage. Void it and free the wallets.
        {
            let mut duels = s.duels.lock().await;
            let now = Utc::now();
            let mut stuck_markets: Vec<String> = vec![];
            for d in duels.values_mut() {
                if d.status == "OPENING" || d.status == "CLOSING" {
                    let since = d.started_at.unwrap_or(d.created_at);
                    if (now - since).num_seconds() > 120 {
                        d.status = "VOID".into();
                        d.void_reason = Some("STALLED: settlement did not complete in time; positions were flattened".into());
                        d.finished_at = Some(now);
                        stuck_markets.push(d.market.clone());
                    }
                }
            }
            for m in stuck_markets {
                let st = s.clone();
                tokio::spawn(async move { let _ = exec_post(&st, "/flatten-all", serde_json::json!({})).await; let _ = m; });
            }
        }
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
            // exit values from the book: closing a long hits the bid, a short the ask
            let (bid, ask) = match exec_get(&s, &format!("/book?market={}", market)).await {
                Ok(v) => (v["bid"].as_f64(), v["ask"].as_f64()),
                Err(_) => (None, None),
            };
            let expired = ends_at.map(|e| Utc::now() >= e).unwrap_or(false);
            if expired { settle(&s, &id, "CLOCK", None).await; continue; }
            // every 5s, refresh liquidation prices for both fighters
            let (liq_a, liq_b) = if tick % 5 == 0 {
                let (ua, ub) = (format!("/position?wallet=A&market={}", market), format!("/position?wallet=B&market={}", market));
                let (pa, pb) = tokio::join!(exec_get(&s, &ua), exec_get(&s, &ub));
                (pa.ok().and_then(|v| v["liquidationPrice"].as_f64()), pb.ok().and_then(|v| v["liquidationPrice"].as_f64()))
            } else { (None, None) };
            let tape_price = match (bid, ask) { (Some(b), Some(a)) => (b + a) / 2.0, _ => mark };
            let mut duels = s.duels.lock().await;
            if let Some(d) = duels.get_mut(&id) {
                // a stub margin read would turn a small PnL into a three-digit ROE
                let imf_margin = d.notional_usd * 0.05;
                for p in [&mut d.creator] {
                    if p.margin_locked_usd.map(|m| m < d.notional_usd * 0.01).unwrap_or(true) { p.margin_locked_usd = Some(imf_margin); }
                }
                if let Some(op) = d.opponent.as_mut() {
                    if op.margin_locked_usd.map(|m| m < d.notional_usd * 0.01).unwrap_or(true) { op.margin_locked_usd = Some(imf_margin); }
                }
                d.mark_price = Some(tape_price);
                d.price_history.push([Utc::now().timestamp() as f64, tape_price]);
                if d.price_history.len() > 1800 { d.price_history.drain(..200); }
                // a long would exit at the bid, a short at the ask — the same side
                // the close will actually hit, so the race converges on settlement
                let c_exit = if d.creator.side.is_bid() { bid } else { ask };
                if let (Some(e), Some(_), Some(x)) = (d.creator.entry_price, d.creator.qty, c_exit) {
                    let sq = signed_qty(&d.creator.clone());
                    d.creator.price_pnl_usd = pnl_at(e, x, sq);
                    d.creator.pnl_usd = d.creator.price_pnl_usd;
                    d.creator.roe_pct = roe(d.creator.pnl_usd, d.creator.margin_locked_usd);
                }
                if liq_a.is_some() { d.creator.liq_price = liq_a; }
                if let Some(op) = d.opponent.as_mut() {
                    let o_exit = if op.side.is_bid() { bid } else { ask };
                    if let (Some(e), Some(_), Some(x)) = (op.entry_price, op.qty, o_exit) {
                        let sq = signed_qty(op);
                        op.price_pnl_usd = pnl_at(e, x, sq);
                        op.pnl_usd = op.price_pnl_usd;
                        op.roe_pct = roe(op.pnl_usd, op.margin_locked_usd);
                    }
                    if liq_b.is_some() { op.liq_price = liq_b; }
                }
            }
            drop(duels);
        }
    }
}

async fn markets(State(s): State<AppState>) -> Json<serde_json::Value> {
    let mut out = vec![];
    for sym in MARKETS {
        if let Ok(m) = mark_price(&s, sym).await { out.push(serde_json::json!({"symbol": sym, "markPrice": m})); }
    }
    Json(serde_json::json!({"markets": out, "explorerTxBase": EXPLORER}))
}

async fn card(State(s): State<AppState>, Path(id): Path<String>) -> Result<([(axum::http::HeaderName, &'static str); 1], String), StatusCode> {
    let duels = s.duels.lock().await;
    let d = duels.get(&id).ok_or(StatusCode::NOT_FOUND)?;
    let opp = d.opponent.clone().unwrap_or_else(|| blank_player("—".into(), d.creator.side.opposite(), "B", false));
    let win = d.winner.clone().unwrap_or_else(|| "—".into());
    let svg = format!(r##"<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#0a0a0a"/>
<rect x="0" y="0" width="600" height="630" fill="#0f2e1a"/><rect x="600" y="0" width="600" height="630" fill="#2e0f14"/>
<text x="600" y="90" text-anchor="middle" fill="#f5f0e6" font-family="monospace" font-size="34" letter-spacing="6">PERPDUEL · {market}-PERP · PROOF ON-CHAIN</text>
<text x="300" y="240" text-anchor="middle" fill="#3dff7a" font-family="monospace" font-size="52" font-weight="bold">{cname}</text>
<text x="300" y="300" text-anchor="middle" fill="#f5f0e6" font-family="monospace" font-size="34">{croe}</text>
<text x="300" y="345" text-anchor="middle" fill="#9a958a" font-family="monospace" font-size="28">{cpnl:+.2} USDso</text>
<text x="900" y="240" text-anchor="middle" fill="#ff3b5c" font-family="monospace" font-size="52" font-weight="bold">{oname}</text>
<text x="900" y="300" text-anchor="middle" fill="#f5f0e6" font-family="monospace" font-size="34">{oroe}</text>
<text x="900" y="345" text-anchor="middle" fill="#9a958a" font-family="monospace" font-size="28">{opnl:+.2} USDso</text>
<text x="600" y="470" text-anchor="middle" fill="#ffd23f" font-family="monospace" font-size="64" font-weight="bold">WINNER: {win}</text>
<text x="600" y="560" text-anchor="middle" fill="#9a958a" font-family="monospace" font-size="26">dreamDEX perps · Somnia Tokyo (Hideki 50383) testnet · duel #{id}</text>
</svg>"##,
        market = d.market, cname = xml(&d.creator.name), croe = d.creator.roe_pct.map(|r| format!("{:+.1}% ROE", r)).unwrap_or_default(), cpnl = d.creator.pnl_usd,
        oname = xml(&opp.name), oroe = opp.roe_pct.map(|r| format!("{:+.1}% ROE", r)).unwrap_or_default(), opnl = opp.pnl_usd,
        win = xml(&win), id = d.id);
    Ok(([(axum::http::header::CONTENT_TYPE, "image/svg+xml")], svg))
}
fn xml(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;") }

#[tokio::main]
async fn main() {
    let store_path = std::env::var("DUEL_STORE").unwrap_or_else(|_| "duels.json".into());
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("http client");
    let state = AppState { duels: Arc::new(Mutex::new(HashMap::new())), http, store_path };
    load(&state).await;
    {
        let mut duels = state.duels.lock().await;
        for d in duels.values_mut() {
            if ["LIVE", "OPENING", "CLOSING"].contains(&d.status.as_str()) {
                d.status = "VOID".into();
                d.void_reason = Some("SERVER_RESTART during duel; positions must be checked manually".into());
            }
            if d.series_id.is_none() && d.status == "FINISHED" { d.series_id = Some(d.id.clone()); }
        }
    }
    // Flatten any house positions left open by a previous crashed run (retry until executor is up)
    {
        let st = state.clone();
        tokio::spawn(async move {
            for _ in 0..6 {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                if exec_post(&st, "/flatten-all", serde_json::json!({})).await.is_ok() { break; }
            }
        });
    }
    tokio::spawn(duel_loop(state.clone()));
    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/api/markets", get(markets))
        .route("/api/standings", get(standings))
        .route("/api/duels", post(create_duel).get(list_duels))
        .route("/api/duels/:id", get(get_duel))
        .route("/api/duels/:id/join", post(join_duel))
        .route("/api/duels/:id/ghost", post(ghost_duel))
        .route("/api/duels/:id/cashout", post(cashout))
        .route("/api/duels/:id/rematch", post(rematch))
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
    fn p(side: Side, qty: f64, entry: f64) -> Player {
        let mut pl = blank_player("T".into(), side, "A", false);
        pl.qty = Some(qty); pl.entry_price = Some(entry); pl
    }
    #[test]
    fn pnl_long_and_short() {
        assert!((pnl_at(100.0, 110.0, 0.5) - 5.0).abs() < 1e-9);
        assert!((pnl_at(100.0, 110.0, -0.5) + 5.0).abs() < 1e-9);
    }
    #[test]
    fn signed_qty_by_side() {
        assert_eq!(signed_qty(&p(Side::Long, 2.0, 100.0)), 2.0);
        assert_eq!(signed_qty(&p(Side::Short, 2.0, 100.0)), -2.0);
    }
    #[test]
    fn roe_on_locked_margin() {
        assert!((roe(5.0, Some(50.0)).unwrap() - 10.0).abs() < 1e-9);
        assert!(roe(5.0, Some(0.0)).is_none());
        assert!(roe(5.0, None).is_none());
    }
    #[test]
    fn spread_cost_signs() {
        // long entering above mark pays spread; short entering below mark pays spread
        let long = p(Side::Long, 1.0, 101.0);
        assert!((-(100.0 - 101.0) * signed_qty(&long) - 1.0).abs() < 1e-9);
        let short = p(Side::Short, 1.0, 99.0);
        assert!((-(100.0 - 99.0) * signed_qty(&short) - 1.0).abs() < 1e-9);
    }
}
