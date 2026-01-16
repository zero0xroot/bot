import axios from "axios";
import fs from "fs";

/* ================= CONFIG ================= */

const POLL_MS = 5000;
const CSV_FILE = "pnl.csv";

const ENTRY_LADDERS = [
  { up: 0.30, down: 0.70 },
  { up: 0.32, down: 0.68 },
  { up: 0.35, down: 0.65 }
];

const PROFIT_EXIT = 0.85;
const TIME_STOP_LOSS = -0.05;

/* ================= CSV INIT ================= */

if (!fs.existsSync(CSV_FILE)) {
  fs.writeFileSync(
    CSV_FILE,
    "timestamp,market_id,entry_up,entry_down,exit_reason,exit_price,pnl\n"
  );
}

/* ================= API ================= */

const api = axios.create({
  baseURL: "https://clob.polymarket.com"
});

/* ================= STATE ================= */

let currentMarketId = null;
let candleExpiry = null;
let position = null;

/* ================= HELPERS ================= */

async function fetchCurrentBTC15mMarket() {
  const res = await api.get(
    "/markets?slug=bitcoin-up-or-down-15-minutes"
  );

  const market = Array.isArray(res.data)
    ? res.data[0]
    : res.data?.markets?.[0];

  if (!market) return null;

  return {
    id: market.id,
    up: parseFloat(market.outcomes[0].price),
    down: parseFloat(market.outcomes[1].price),
    expiry: new Date(market.expiry).getTime()
  };
}

function logTrade(marketId, entryUp, entryDown, reason, price, pnl) {
  fs.appendFileSync(
    CSV_FILE,
    `${new Date().toISOString()},${marketId},${entryUp},${entryDown},${reason},${price},${pnl.toFixed(4)}\n`
  );
}

/* ================= CORE LOOP ================= */
console.log(
  "DEBUG",
  "MARKET:", currentMarketId,
  "UP:", m.up.toFixed(2),
  "DOWN:", m.down.toFixed(2),
  "POSITION:", position ? "YES" : "NO"
);

async function loop() {
  try {
    const m = await fetchCurrentBTC15mMarket();
    if (!m) return;

    /* ===== NEW CANDLE ===== */
    if (m.id !== currentMarketId) {
      if (position) {
        logTrade(
          currentMarketId,
          position.entryUp,
          position.entryDown,
          "TIME_STOP",
          0,
          TIME_STOP_LOSS
        );
        position = null;
      }

      currentMarketId = m.id;
      candleExpiry = m.expiry;
      console.log("NEW 15M CANDLE", currentMarketId);
    }

    /* ===== ENTRY ===== */
    if (!position) {
      for (const l of ENTRY_LADDERS) {
        if (m.up <= l.up && m.down >= l.down) {
          position = {
            entryUp: m.up,
            entryDown: m.down
          };
          console.log("PAPER ENTRY", position);
          return;
        }
      }
    }

    /* ===== EXIT ===== */
    if (position) {
      if (m.up >= PROFIT_EXIT) {
        const pnl = (m.up - position.entryUp) / position.entryUp;
        logTrade(currentMarketId, position.entryUp, position.entryDown, "UP_EXIT", m.up, pnl);
        position = null;
        return;
      }

      if (m.down >= PROFIT_EXIT) {
        const pnl = (m.down - position.entryDown) / position.entryDown;
        logTrade(currentMarketId, position.entryUp, position.entryDown, "DOWN_EXIT", m.down, pnl);
        position = null;
        return;
      }

      if (Date.now() >= candleExpiry) {
        logTrade(
          currentMarketId,
          position.entryUp,
          position.entryDown,
          "TIME_STOP",
          0,
          TIME_STOP_LOSS
        );
        position = null;
      }
    }
  } catch (e) {
    console.error("ERROR:", e.message);
  }
}

import http from "http";

const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot running");
}).listen(PORT, "0.0.0.0", () => {
  console.log("HTTP keepalive server on port", PORT);
});

/* ================= START ================= */

console.log("BTC 15-MIN PAPER STRATEGY BOT STARTED");
setInterval(loop, POLL_MS);
