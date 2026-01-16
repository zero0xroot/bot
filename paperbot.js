import axios from "axios";
import fs from "fs";

/* =====================================================
   CONFIG
===================================================== */

const RUN_HOURS = 24;
const POLL_MS = 5000;

const ENTRY_LADDERS = [
  { up: 0.30, down: 0.70 },
  { up: 0.32, down: 0.68 },
  { up: 0.35, down: 0.65 }
];

const PROFIT_EXIT = 0.85;
const TIME_STOP_MIN = 7;
const FORCE_EXIT_MIN = 2;

/* =====================================================
   STATE
===================================================== */

let activeMarketId = null;
let activeExpiry = null;
let position = null;
let startTime = Date.now();

/* =====================================================
   CSV
===================================================== */

const CSV = "pnl.csv";
fs.writeFileSync(
  CSV,
  "timestamp,market_id,entry_up,entry_down,exit_reason,exit_price,pnl\n"
);

/* =====================================================
   API
===================================================== */

const api = axios.create({
  baseURL: "https://clob.polymarket.com"
});

/* =====================================================
   HELPERS
===================================================== */

function minutes(ms) {
  return ms / 60000;
}

async function fetchActiveBTC15mMarket() {
  const res = await api.get("/markets");
  const now = Date.now();

  const markets = res.data
    .filter(m =>
      m.active &&
      m.question?.toLowerCase().includes("bitcoin") &&
      m.question?.includes("15")
    )
    .map(m => ({
      id: m.id,
      expiry: new Date(m.expiry).getTime()
    }))
    .filter(m => m.expiry > now)
    .sort((a, b) => a.expiry - b.expiry);

  return markets[0] || null;
}

async function getPrices(marketId) {
  const res = await api.get(`/markets/${marketId}`);
  return {
    up: parseFloat(res.data.outcomes[0].price),
    down: parseFloat(res.data.outcomes[1].price),
    expiry: new Date(res.data.expiry).getTime()
  };
}

function logTrade(marketId, entryUp, entryDown, reason, price, pnl) {
  fs.appendFileSync(
    CSV,
    `${new Date().toISOString()},${marketId},${entryUp},${entryDown},${reason},${price},${pnl.toFixed(4)}\n`
  );
}

/* =====================================================
   CORE LOOP
===================================================== */

async function loop() {
  try {
    if (minutes(Date.now() - startTime) >= RUN_HOURS * 60) {
      console.log("24 HOURS COMPLETE — STOPPING");
      process.exit(0);
    }

    const market = await fetchActiveBTC15mMarket();
    if (!market) return;

    // MARKET ROLL
    if (market.id !== activeMarketId) {
      if (position) {
        logTrade(
          activeMarketId,
          position.entryUp,
          position.entryDown,
          "MARKET_ROLL",
          0,
          -0.05
        );
        position = null;
      }
      activeMarketId = market.id;
      activeExpiry = market.expiry;
      console.log("NEW MARKET", activeMarketId);
    }

    const prices = await getPrices(activeMarketId);

    /* ===== ENTRY ===== */
    if (!position) {
      for (const l of ENTRY_LADDERS) {
        if (prices.up <= l.up && prices.down >= l.down) {
          position = {
            entryUp: prices.up,
            entryDown: prices.down,
            entryTime: Date.now()
          };
          console.log("PAPER ENTRY", position);
          return;
        }
      }
    }

    /* ===== MANAGEMENT ===== */
    if (position) {
      if (prices.up >= PROFIT_EXIT) {
        const pnl = (prices.up - position.entryUp) / position.entryUp;
        logTrade(activeMarketId, position.entryUp, position.entryDown, "UP_EXIT", prices.up, pnl);
        position = null;
        return;
      }

      if (prices.down >= PROFIT_EXIT) {
        const pnl = (prices.down - position.entryDown) / position.entryDown;
        logTrade(activeMarketId, position.entryUp, position.entryDown, "DOWN_EXIT", prices.down, pnl);
        position = null;
        return;
      }

      if (minutes(Date.now() - position.entryTime) >= TIME_STOP_MIN) {
        logTrade(activeMarketId, position.entryUp, position.entryDown, "TIME_STOP", 0, -0.05);
        position = null;
        return;
      }

      if (minutes(activeExpiry - Date.now()) <= FORCE_EXIT_MIN) {
        logTrade(activeMarketId, position.entryUp, position.entryDown, "FORCED_EXIT", 0, -0.05);
        position = null;
        return;
      }
    }

  } catch (e) {
    console.error("ERROR:", e.message);
  }
}

/* =====================================================
   START
===================================================== */

console.log("PROPER BTC 15-MIN PAPER BOT STARTED");
setInterval(loop, POLL_MS);
