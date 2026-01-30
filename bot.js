/**
 * Polymarket BTC 15-Minute Breakout Bot (Paper Trading)
 * Node 22 / Render compatible
 */

import axios from "axios";

// ================= CONFIG =================

const CONFIG = {
  TRADE_MODE: false,
  TICKER: "BTC",
  TIMEFRAME: 15,               // minutes
  OBSERVATION_WINDOW: 5,       // minutes
  TP_AMOUNT: 0.15,             // 15 cents
  SL_AMOUNT: 0.05,             // 5 cents
  MIN_RANGE: 0.40,
  MAX_RANGE: 0.60,
  POLL_INTERVAL: 10_000        // 10 seconds
};

const GAMMA_ENDPOINT = "https://gamma-api.polymarket.com";
const CLOB_ENDPOINT  = "https://clob.polymarket.com";

// ================= STATE =================

let state = {
  currentMarket: null,
  marketStartTime: null,
  rangeHigh: 0,
  rangeLow: 1,
  isObserving: false,
  hasPosition: false,
  entryPrice: 0,
  positionType: null,
  lastProcessedMarket: null
};

// ================= UTILS =================

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ================= API HELPERS =================

async function getMidPrice(tokenId) {
  try {
    const res = await axios.get(`${CLOB_ENDPOINT}/midpoint`, {
      params: { token_id: tokenId }
    });
    return parseFloat(res.data.mid);
  } catch {
    return null;
  }
}

// ================= MARKET DISCOVERY =================

async function findNextMarket() {
  try {
    const res = await axios.get(`${GAMMA_ENDPOINT}/markets`, {
      params: { active: true, closed: false, limit: 20 }
    });

    log(`Fetched ${res.data.length} markets`);

    const now = Date.now();

    const markets = res.data.filter(m => {
      const text = (m.title || m.question || "").toLowerCase();
      const start = new Date(m.startDate).getTime();
      const age = (now - start) / 60000;

      return (
        text.includes("bitcoin") &&
        text.includes("up") &&
        age >= 0 &&
        age <= CONFIG.OBSERVATION_WINDOW &&
        m.id !== state.lastProcessedMarket &&
        Array.isArray(m.tokens)
      );
    });

    if (!markets.length) return;

    const market = markets[0];
    const yesToken = market.tokens.find(t => t.outcome === "Yes");

    if (!yesToken) return;

    state.currentMarket = market;
    state.marketStartTime = new Date(market.startDate).getTime();
    state.rangeHigh = 0;
    state.rangeLow = 1;
    state.isObserving = true;
    state.hasPosition = false;
    state.lastProcessedMarket = market.id;

    log(`NEW MARKET → ${market.question}`);
  } catch (err) {
    log(`Market fetch error: ${err.message}`);
  }
}

// ================= TRADE LOGIC =================

function enterTrade(type, price) {
  state.hasPosition = true;
  state.positionType = type;
  state.entryPrice = price;
  log(`[ENTER] ${type} @ $${price.toFixed(2)}`);
}

function exitTrade(reason, price) {
  const pnl = price - state.entryPrice;
  log(`[EXIT] ${reason} @ $${price.toFixed(2)} | P/L: ${pnl.toFixed(2)}`);
  state.hasPosition = false;
}

// ================= MAIN LOOP =================

async function runBot() {
  if (!state.currentMarket) {
    await findNextMarket();
    return;
  }

  const now = Date.now();
  const elapsed = (now - state.marketStartTime) / 60000;
  const yesToken = state.currentMarket.tokens.find(t => t.outcome === "Yes");

  if (!yesToken) return;

  const yesPrice = await getMidPrice(yesToken.tokenId);
  if (yesPrice === null) return;

  // ===== OBSERVATION =====
  if (elapsed <= CONFIG.OBSERVATION_WINDOW) {
    state.rangeHigh = Math.max(state.rangeHigh, yesPrice);
    state.rangeLow  = Math.min(state.rangeLow, yesPrice);

    log(
      `OBSERVE | P:${yesPrice.toFixed(2)} ` +
      `H:${state.rangeHigh.toFixed(2)} ` +
      `L:${state.rangeLow.toFixed(2)}`
    );
    return;
  }

  // ===== BREAKOUT =====
  if (!state.hasPosition) {
    if (
      yesPrice > state.rangeHigh &&
      state.rangeHigh <= CONFIG.MAX_RANGE
    ) {
      enterTrade("YES", yesPrice);
    }

    if (
      yesPrice < state.rangeLow &&
      state.rangeLow >= CONFIG.MIN_RANGE
    ) {
      enterTrade("NO", 1 - yesPrice);
    }
    return;
  }

  // ===== POSITION MANAGEMENT =====
  const posPrice =
    state.positionType === "YES" ? yesPrice : 1 - yesPrice;

  const pnl = posPrice - state.entryPrice;

  if (pnl >= CONFIG.TP_AMOUNT) {
    exitTrade("TAKE PROFIT", posPrice);
  } else if (pnl <= -CONFIG.SL_AMOUNT) {
    exitTrade("STOP LOSS", posPrice);
  } else {
    log(
      `HOLD ${state.positionType} ` +
      `Entry:${state.entryPrice.toFixed(2)} ` +
      `Now:${posPrice.toFixed(2)} ` +
      `PnL:${pnl.toFixed(2)}`
    );
  }

  // ===== EXPIRY =====
  if (elapsed >= CONFIG.TIMEFRAME) {
    if (state.hasPosition) exitTrade("MARKET EXPIRED", posPrice);
    state.currentMarket = null;
  }
}

// ================= START =================

log("Polymarket BTC 15m Bot Started (Paper Mode)");
setInterval(runBot, CONFIG.POLL_INTERVAL);
