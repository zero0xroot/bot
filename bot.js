/**
 * Polymarket BTC 15-Minute "Bitcoin Up or Down" Bot
 * Paper Trading | Node 22 | Render-safe
 */

import axios from "axios";

/* ================= CONFIG ================= */

const CONFIG = {
  TRADE_MODE: false,            // true = real trades (not implemented yet)
  TIMEFRAME: 15,                // market length (minutes)
  OBSERVATION_WINDOW: 5,        // first N minutes to form range
  TP_AMOUNT: 0.15,              // +15c
  SL_AMOUNT: 0.05,              // -5c
  MIN_RANGE: 0.40,
  MAX_RANGE: 0.60,
  POLL_INTERVAL: 10_000         // 10 seconds
};

const GAMMA_ENDPOINT = "https://gamma-api.polymarket.com";
const CLOB_ENDPOINT  = "https://clob.polymarket.com";

/* ================= STATE ================= */

let state = {
  currentMarket: null,
  marketStartTime: null,
  rangeHigh: 0,
  rangeLow: 1,
  isObserving: false,
  hasPosition: false,
  entryPrice: 0,
  positionType: null,           // YES | NO
  lastProcessedMarket: null
};

/* ================= UTIL ================= */

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/* ================= PRICE ================= */

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

/* ================= MARKET DISCOVERY ================= */

async function findNextMarket() {
  try {
    const res = await axios.get(`${GAMMA_ENDPOINT}/markets`, {
      params: { active: true, closed: false, limit: 30 }
    });

    log(`Fetched ${res.data.length} markets`);

    const market = res.data.find(m => {
      const text = (m.question || "").toLowerCase();
      return (
        text === "bitcoin up or down" &&
        m.id !== state.lastProcessedMarket &&
        Array.isArray(m.tokens)
      );
    });

    if (!market) return;

    const yesToken = market.tokens.find(t => t.outcome === "Yes");
    if (!yesToken) return;

    state.currentMarket = market;
    state.marketStartTime = new Date(market.startDate).getTime();
    state.rangeHigh = 0;
    state.rangeLow = 1;
    state.isObserving = true;
    state.hasPosition = false;
    state.entryPrice = 0;
    state.positionType = null;
    state.lastProcessedMarket = market.id;

    log(`NEW MARKET FOUND → ${market.question}`);
  } catch (err) {
    log(`Market fetch error: ${err.message}`);
  }
}

/* ================= TRADING ================= */

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

/* ================= MAIN LOOP ================= */

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

  /* ===== OBSERVATION PHASE ===== */
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

  /* ===== ENTRY ===== */
  if (!state.hasPosition) {
    if (
      yesPrice > state.rangeHigh &&
      state.rangeHigh <= CONFIG.MAX_RANGE
    ) {
      enterTrade("YES", yesPrice);
      return;
    }

    if (
      yesPrice < state.rangeLow &&
      state.rangeLow >= CONFIG.MIN_RANGE
    ) {
      enterTrade("NO", 1 - yesPrice);
      return;
    }
  }

  /* ===== POSITION MGMT ===== */
  if (state.hasPosition) {
    const current =
      state.positionType === "YES" ? yesPrice : 1 - yesPrice;

    const pnl = current - state.entryPrice;

    if (pnl >= CONFIG.TP_AMOUNT) {
      exitTrade("TAKE PROFIT", current);
    } else if (pnl <= -CONFIG.SL_AMOUNT) {
      exitTrade("STOP LOSS", current);
    } else {
      log(
        `HOLD ${state.positionType} ` +
        `Entry:${state.entryPrice.toFixed(2)} ` +
        `Now:${current.toFixed(2)} ` +
        `PnL:${pnl.toFixed(2)}`
      );
    }
  }

  /* ===== EXPIRY ===== */
  if (elapsed >= CONFIG.TIMEFRAME) {
    if (state.hasPosition) {
      const exitPrice =
        state.positionType === "YES" ? yesPrice : 1 - yesPrice;
      exitTrade("MARKET EXPIRED", exitPrice);
    }
    log("Market expired. Waiting for next.");
    state.currentMarket = null;
  }
}

/* ================= START ================= */

log("Polymarket BTC 15m Bot Started (Paper Mode)");
setInterval(runBot, CONFIG.POLL_INTERVAL);
