/**
 * Polymarket 15-Minute BTC Breakout Bot
 * Strategy:
 * 1. Identify the high and low within the first 5 minutes of a 15-minute market.
 * 2. If range is within 40c-60c, wait for a breakout.
 * 3. Buy if price > High (Target +15c, SL -5c).
 * 4. Sells if price < Low (Target +15c, SL -5c).
 * * Requirements: npm install axios ethers
 */

const axios = require('axios');
const { Wallet } = require('ethers');

// --- CONFIGURATION ---
const CONFIG = {
    TRADE_MODE: false, // Set to true for real trading
    TICKER: "BTC",
    TIMEFRAME: 15, // minutes
    OBSERVATION_WINDOW: 5, // minutes
    TP_AMOUNT: 0.15, // 15 cents
    SL_AMOUNT: 0.05, // 5 cents
    MIN_RANGE: 0.40,
    MAX_RANGE: 0.60,
    POLL_INTERVAL: 10000, // 10 seconds
};

// --- API CREDENTIALS (Add your keys here for live trading) ---
const AUTH = {
    PRIVATE_KEY: "", 
    API_KEY: "",
    API_SECRET: "",
    API_PASSPHRASE: ""
};

const CLOB_ENDPOINT = "https://clob.polymarket.com";
const GAMMA_ENDPOINT = "https://gamma-api.polymarket.com";

// --- STATE MANAGEMENT ---
let state = {
    currentMarket: null,
    marketStartTime: null,
    rangeHigh: 0,
    rangeLow: 1,
    isObserving: false,
    hasPosition: false,
    entryPrice: 0,
    positionType: null, // 'YES' or 'NO'
    lastProcessedMarket: null
};

/**
 * Log with timestamp
 */
function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

/**
 * Fetch active Bitcoin 15-minute markets
 */
async function findNextMarket() {
    try {
        // Search for active BTC markets ending soon
        const response = await axios.get(`${GAMMA_ENDPOINT}/markets`, {
            params: {
                query: "Bitcoin Price",
                active: true,
                closed: false,
                limit: 10
            }
        });

        const now = Date.now();
        // Filter for markets that started recently (within the last 15 mins) 
        // and match the 15-min interval pattern
        const markets = response.data.filter(m => {
            const startTime = new Date(m.startDate).getTime();
            return m.title.includes("Bitcoin") && 
                   m.title.toLowerCase().includes("up") &&
                   m.id !== state.lastProcessedMarket;
        });

        if (markets.length > 0) {
            const target = markets[0];
            state.currentMarket = target;
            state.marketStartTime = new Date(target.startDate).getTime();
            state.rangeHigh = 0;
            state.rangeLow = 1;
            state.isObserving = true;
            state.hasPosition = false;
            state.lastProcessedMarket = target.id;
            
            log(`NEW MARKET DETECTED: ${target.question}`);
            log(`Start Time: ${new Date(state.marketStartTime).toLocaleString()}`);
        }
    } catch (error) {
        log(`Error fetching markets: ${error.message}`);
    }
}

/**
 * Get current price (Midpoint) for a specific outcome
 */
async function getPrice(tokenId) {
    try {
        const response = await axios.get(`${CLOB_ENDPOINT}/midpoint`, {
            params: { token_id: tokenId }
        });
        return parseFloat(response.data.mid);
    } catch (error) {
        return null;
    }
}

/**
 * Main Logic Loop
 */
async function runBot() {
    if (!state.currentMarket) {
        await findNextMarket();
        return;
    }

    const now = Date.now();
    const elapsedMinutes = (now - state.marketStartTime) / 60000;

    // 1. OBSERVATION PHASE (First 5 Minutes)
    if (elapsedMinutes <= CONFIG.OBSERVATION_WINDOW) {
        const currentPrice = await getPrice(state.currentMarket.tokens[0].tokenId); // YES token
        if (currentPrice) {
            if (currentPrice > state.rangeHigh) state.rangeHigh = currentPrice;
            if (currentPrice < state.rangeLow) state.rangeLow = currentPrice;
            log(`Observing Range... Current: $${currentPrice.toFixed(2)} | High: $${state.rangeHigh.toFixed(2)} | Low: $${state.rangeLow.toFixed(2)}`);
        }
        return;
    }

    // 2. BREAKOUT/TRADING PHASE
    if (state.isObserving) {
        log(`Observation Ended. Final Range: Low $${state.rangeLow.toFixed(2)} - High $${state.rangeHigh.toFixed(2)}`);
        
        // Ensure high and low are outside the 40c-60c range as requested
        if (state.rangeHigh <= CONFIG.MAX_RANGE && state.rangeLow >= CONFIG.MIN_RANGE) {
            log("Range strictly inside 40c-60c. Waiting for breakout beyond these bounds.");
        }
        state.isObserving = false;
    }

    const currentPrice = await getPrice(state.currentMarket.tokens[0].tokenId);
    if (!currentPrice) return;

    if (!state.hasPosition) {
        // BREAKOUT HIGH -> BUY YES
        if (currentPrice > state.rangeHigh && state.rangeHigh > CONFIG.MAX_RANGE) {
            executeTrade('YES', currentPrice);
        } 
        // BREAKDOWN LOW -> BUY NO (Price of YES drops, meaning NO goes up)
        else if (currentPrice < state.rangeLow && state.rangeLow < CONFIG.MIN_RANGE) {
            executeTrade('NO', 1 - currentPrice);
        }
    } else {
        // MONITOR POSITION (TP/SL)
        const currentPosPrice = state.positionType === 'YES' ? currentPrice : (1 - currentPrice);
        const profit = currentPosPrice - state.entryPrice;

        if (profit >= CONFIG.TP_AMOUNT) {
            closePosition("TAKE PROFIT", currentPosPrice);
        } else if (profit <= -CONFIG.SL_AMOUNT) {
            closePosition("STOP LOSS", currentPosPrice);
        } else {
            log(`Position: ${state.positionType} | Entry: ${state.entryPrice.toFixed(2)} | Current: ${currentPosPrice.toFixed(2)} | P/L: ${profit.toFixed(2)}`);
        }
    }

    // Reset if market expired
    if (elapsedMinutes >= CONFIG.TIMEFRAME) {
        log("Market Time Expired. Resetting for next cycle.");
        if (state.hasPosition) closePosition("EXPIRY", currentPrice);
        state.currentMarket = null;
    }
}

function executeTrade(type, price) {
    state.hasPosition = true;
    state.positionType = type;
    state.entryPrice = price;
    log(`[TRADE] Entered ${type} at $${price.toFixed(2)} (Breakout detected)`);
    
    if (CONFIG.TRADE_MODE) {
        log("Real Trade Execution: Call POST /order here with signed payload.");
        // Logic for ethers.js signing would go here
    } else {
        log("PAPER TRADE: Simulated execution complete.");
    }
}

function closePosition(reason, price) {
    const pnl = price - state.entryPrice;
    log(`[CLOSE] ${reason} at $${price.toFixed(2)}. Net P/L: ${pnl.toFixed(2)}`);
    state.hasPosition = false;
    
    if (CONFIG.TRADE_MODE) {
        log("Real Trade Exit: Call DELETE /order or Market Sell here.");
    }
}

// Start the bot
log("Polymarket BTC 15m Bot Started (Paper Trading Mode)");
setInterval(runBot, CONFIG.POLL_INTERVAL);
