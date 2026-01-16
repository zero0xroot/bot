import axios from "axios";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

/* =====================================================
   CONFIG
===================================================== */

const MARKET_ID = process.env.MARKET_ID;
const RUN_DURATION_HOURS = 24;

const ENTRY_LADDERS = [
  { up: 0.30, down: 0.70 },
  { up: 0.32, down: 0.68 },
  { up: 0.35, down: 0.65 }
];

const STAKE_PER_SIDE = 1;
const PROFIT_EXIT = 0.85;
const TIME_STOP_MINUTES = 7;
const FORCE_EXIT_MINUTES = 2;
const POLL_INTERVAL_MS = 5000;

/* =====================================================
   STATE
===================================================== */

let position = null;
let startTime = Date.now();

/* =====================================================
   CSV SETUP
===================================================== */

const csvFile = "pnl.csv";
fs.writeFileSync(
  csvFile,
  "timestamp,entry_up,entry_down,exit_side,exit_price,pnl\n"
);

/* =====================================================
   API
===================================================== */

const api = axios.create({
  baseURL: "https://clob.polymarket.com"
});

async function getMarket() {
  const res = await api.get(`/markets/${MARKET_ID}`);
  return {
    up: parseFloat(res.data.outcomes[0].price),
    down: parseFloat(res.data.outcomes[1].price),
    expiry: new Date(res.data.expiry)
  };
}

/* =====================================================
   UTILS
===================================================== */

function minutesSince(ts) {
  return (Date.now() - ts) / 60000;
}

function minutesToExpiry(expiry) {
  return (expiry.getTime() - Date.now()) / 60000;
}

function logTrade(entryUp, entryDown, exitSide, exitPrice, pnl) {
  fs.appendFileSync(
    csvFile,
    `${new Date().toISOString()},${entryUp},${entryDown},${exitSide},${exitPrice},${pnl.toFixed(4)}\n`
  );
}

/* =====================================================
   CORE LOOP
===================================================== */

async function botLoop() {
  try {
    if ((Date.now() - startTime) > RUN_DURATION_HOURS * 3600000) {
      console.log("24 HOURS COMPLETE — STOPPING BOT");
      process.exit(0);
    }

    const m = await getMarket();

    /* ===== ENTRY ===== */
    if (!position) {
      for (const l of ENTRY_LADDERS) {
        if (m.up <= l.up && m.down >= l.down) {
          position = {
            entryUp: m.up,
            entryDown: m.down,
            entryTime: Date.now()
          };
          console.log("PAPER ENTRY", position);
          return;
        }
      }
    }

    /* ===== MANAGEMENT ===== */
    if (position) {
      // PROFIT EXIT
      if (m.up >= PROFIT_EXIT) {
        const pnl = (PROFIT_EXIT - position.entryUp) / position.entryUp - 1;
        logTrade(position.entryUp, position.entryDown, "UP", m.up, pnl);
        console.log("PROFIT EXIT UP", pnl);
        position = null;
        return;
      }

      if (m.down >= PROFIT_EXIT) {
        const pnl = (PROFIT_EXIT - position.entryDown) / position.entryDown - 1;
        logTrade(position.entryUp, position.entryDown, "DOWN", m.down, pnl);
        console.log("PROFIT EXIT DOWN", pnl);
        position = null;
        return;
      }

      // TIME STOP
      if (minutesSince(position.entryTime) >= TIME_STOP_MINUTES) {
        const loss = -0.05;
        logTrade(position.entryUp, position.entryDown, "TIME_STOP", 0, loss);
        console.log("TIME STOP EXIT", loss);
        position = null;
        return;
      }

      // FORCE EXIT
      if (minutesToExpiry(m.expiry) <= FORCE_EXIT_MINUTES) {
        const loss = -0.05;
        logTrade(position.entryUp, position.entryDown, "FORCED_EXIT", 0, loss);
        console.log("FORCED EXPIRY EXIT", loss);
        position = null;
        return;
      }
    }
  } catch (err) {
    console.error("ERROR:", err.message);
  }
}

/* =====================================================
   START
===================================================== */

console.log("PAPER BOT STARTED (15-MIN, 24H)");
setInterval(botLoop, POLL_INTERVAL_MS);
