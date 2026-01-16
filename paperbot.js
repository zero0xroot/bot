import axios from "axios";
import fs from "fs";

/* ================= CONFIG ================= */

const POLL_MS = 15000; // 15 seconds
const CSV_FILE = "btc_15m_paper_log.csv";

/* ================= CSV INIT ================= */

if (!fs.existsSync(CSV_FILE)) {
  fs.writeFileSync(
    CSV_FILE,
    "timestamp,market_id,up_price,down_price,expiry\n"
  );
}

/* ================= API ================= */

const api = axios.create({
  baseURL: "https://clob.polymarket.com"
});

/* ================= HELPERS ================= */

async function fetchCurrentBTC15mMarket() {
  const res = await api.get(
    "/markets?slug=bitcoin-up-or-down-15-minutes"
  );

  // Polymarket returns newest first for slug queries
  const market = Array.isArray(res.data)
    ? res.data[0]
    : res.data?.markets?.[0];

  if (!market) return null;

  return {
    id: market.id,
    up: parseFloat(market.outcomes[0].price),
    down: parseFloat(market.outcomes[1].price),
    expiry: market.expiry
  };
}

/* ================= CORE LOOP ================= */

async function loop() {
  try {
    const market = await fetchCurrentBTC15mMarket();
    if (!market) return;

    const row = [
      new Date().toISOString(),
      market.id,
      market.up,
      market.down,
      market.expiry
    ].join(",");

    fs.appendFileSync(CSV_FILE, row + "\n");

    console.log(
      "LOGGED",
      market.id,
      "UP:", market.up,
      "DOWN:", market.down
    );
  } catch (e) {
    console.error("ERROR:", e.message);
  }
}

/* ================= START ================= */

console.log("BTC 15-MIN PAPER LOGGER STARTED");
setInterval(loop, POLL_MS);
