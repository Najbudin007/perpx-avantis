"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebTradingBot = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const hyperliquid_1 = require("./hyperliquid");
const avantis_trading_1 = require("../avantis-trading");
const regime_1 = require("./regime");
const binanceHistorical_1 = require("./binanceHistorical");
const BudgetAndLeverage_1 = require("./BudgetAndLeverage");
const strategyEngine_1 = require("./strategyEngine");
const MAX_MONITORING_CYCLES = 10000; // Max cycles for monitoring (not trading)
const MONITORING_INTERVAL_MS = 10000; // 10 seconds between position checks
function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}
function log(tag, message) {
    const timestamp = new Date().toISOString();
    console.log(`[${tag}] ${timestamp} — ${message}`);
}
/**
 * EXECUTION-ONLY TRADING BOT
 *
 * This bot is deterministic and does NOT make autonomous trading decisions.
 *
 * RULES:
 * 1. Each startTrading() call opens EXACTLY ONE position (if maxPerSession allows)
 * 2. The bot then ONLY MONITORS that position until it closes
 * 3. After position closes, bot returns to IDLE
 * 4. NO auto-retry, NO signal scanning, NO autonomous trading
 * 5. maxPerSession is a HARD LOCK - no position opens if limit reached
 */
class WebTradingBot {
    constructor() {
        this.isRunning = false;
        this.shouldStop = false;
        this.sessionId = '';
        this.config = null;
        this.pnl = 0;
        this.openPositions = 0;
        this.cycle = 0;
    }
    /**
     * Start trading session - Opens ONE position, then monitors until close
     * This is the ONLY entry point for opening positions
     */
    async startTrading(config) {
        this.config = config;
        this.sessionId = config.sessionId;
        this.isRunning = true;
        this.shouldStop = false;
        this.pnl = 0;
        this.cycle = 0;
        log('EXEC_BOT', `🚀 EXECUTION-ONLY BOT STARTED`);
        log('EXEC_BOT', `Session: ${this.sessionId}`);
        log('EXEC_BOT', `Investment: $${config.maxBudget} | Target: $${config.profitGoal} | Max Positions: ${config.maxPerSession}`);
        log('EXEC_BOT', `Mode: DETERMINISTIC EXECUTION (NO AUTONOMOUS TRADING)`);
        if (!config.privateKey) {
            log('ERROR', `❌ No private key provided - cannot execute trades`);
            this.isRunning = false;
            return;
        }
        log('AVANTIS', `✅ Trading on Avantis with wallet ${config.privateKey.slice(0, 10)}...${config.privateKey.slice(-4)}`);
        try {
            // Start the execution flow
            await this.executeTradeAndMonitor();
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log('ERROR', `❌ Execution failed: ${errorMessage}`);
            this.isRunning = false;
        }
    }
    /**
     * Execute ONE trade (if allowed), then monitor until close
     * NO LOOPS, NO SCANNING, NO AUTONOMOUS BEHAVIOR
     */
    async executeTradeAndMonitor() {
        if (!this.config || !this.config.privateKey) {
            return { shouldRestart: false, reason: 'no_config', pnl: 0, finalStatus: 'error' };
        }
        const { maxBudget, profitGoal, maxPerSession, privateKey } = this.config;
        log('EXEC_BOT', `========================================`);
        log('EXEC_BOT', `STEP 1: CHECK IF POSITION CAN BE OPENED`);
        log('EXEC_BOT', `========================================`);
        // RULE 1: Check existing positions FIRST
        let existingPositions = [];
        try {
            existingPositions = await (0, avantis_trading_1.getAvantisPositions)(privateKey);
            this.openPositions = existingPositions.length;
            log('EXEC_BOT', `📊 Current open positions: ${this.openPositions}`);
        }
        catch (err) {
            log('WARN', `Could not fetch existing positions: ${err}`);
            this.openPositions = 0;
        }
        // RULE 2: HARD LOCK - Enforce max_positions
        if (this.openPositions >= maxPerSession) {
            log('EXEC_BOT', `🛑 REJECTED: Position limit reached (${this.openPositions}/${maxPerSession})`);
            log('EXEC_BOT', `🛑 Cannot open new position - max_positions is a HARD LOCK`);
            log('EXEC_BOT', `========================================`);
            // Still monitor existing positions
            return await this.monitorPositionsUntilClose();
        }
        log('EXEC_BOT', `✅ Position limit check passed (${this.openPositions}/${maxPerSession})`);
        log('EXEC_BOT', ``);
        log('EXEC_BOT', `========================================`);
        log('EXEC_BOT', `STEP 2: FIND BEST SIGNAL (ONE-TIME EVALUATION)`);
        log('EXEC_BOT', `========================================`);
        // Evaluate signals for available symbols (ONE TIME, NOT A LOOP)
        // IMPORTANT:
        // - BTC, ETH and SOL are PRIORITY assets and must be tried FIRST
        // - Only if none of them produce a valid signal should we look at other assets
        // - All symbols included here must be supported on BOTH:
        //   - Hyperliquid price feeds
        //   - Avantis on-chain symbol registry (see perpx-avantis-service logs)
        //
        // This prevents the bot from selecting symbols like ATOM that are not
        // tradable on the current Avantis deployment.
        const prioritySymbols = ['BTC', 'ETH', 'SOL'];
        const secondarySymbols = [
            'BNB',
            'ARB',
            'DOGE',
            'AVAX',
            'OP',
            'AAVE',
            'NEAR',
            'FET',
            'SUI',
            'JUP',
            'WIF',
            'WLD',
            'TAO',
            'EIGEN',
        ];
        let bestSignal = null;
        // Get market regime for evaluation
        const [btcOHLCV4h, btcOHLCV6h] = await Promise.all([
            (0, binanceHistorical_1.getCachedOHLCV)('BTC', '4h', 300).catch(() => null),
            (0, binanceHistorical_1.getCachedOHLCV)('BTC', '6h', 300).catch(() => null)
        ]);
        const regimeResult = (btcOHLCV4h && btcOHLCV6h) ? await (0, regime_1.guessMarketRegime)('BTC', btcOHLCV4h, btcOHLCV6h) : { regime: 'neutral' };
        const marketRegime = regimeResult.regime;
        log('EXEC_BOT', `Market regime: ${marketRegime}`);
        // Validate budget
        const validatedBudget = (0, BudgetAndLeverage_1.validateAndCapBudget)(maxBudget, maxPerSession, 'BTC');
        const collateral = validatedBudget.budgetPerPosition;
        // Helper to evaluate a list of symbols and return the best passing signal
        const evaluateSymbolList = async (symbolsToEvaluate, listName) => {
            let localBest = null;
            for (const symbol of symbolsToEvaluate) {
                try {
                    const [ohlcv4h, ohlcv6h] = await Promise.all([
                        (0, binanceHistorical_1.getCachedOHLCV)(symbol, '4h', 300).catch(() => null),
                        (0, binanceHistorical_1.getCachedOHLCV)(symbol, '6h', 300).catch(() => null),
                    ]);
                    if (!ohlcv4h || !ohlcv6h || ohlcv4h.close.length < 10 || ohlcv6h.close.length < 10) {
                        continue; // Skip if insufficient data
                    }
                    const { leverage } = (0, BudgetAndLeverage_1.getBudgetAndLeverage)(marketRegime, symbol, collateral);
                    const signalResult = await (0, strategyEngine_1.evaluateSignalOnly)(symbol, ohlcv4h, {
                        regimeOverride: marketRegime,
                        leverage,
                        bypassBacktestCheck: true,
                    });
                    const { direction, signalScore, passed } = signalResult;
                    if (passed && direction && signalScore) {
                        log('EXEC_BOT', `[${listName}] ${symbol}: score=${signalScore.toFixed(2)}, direction=${direction}, leverage=${leverage}x`);
                        if (!localBest || signalScore > localBest.score) {
                            localBest = { symbol, score: signalScore, direction, leverage };
                        }
                    }
                }
                catch (err) {
                    log('WARN', `Could not evaluate ${symbol} in ${listName}: ${err}`);
                }
            }
            return localBest;
        };
        // 1) Try BTC / ETH / SOL first
        log('EXEC_BOT', `Evaluating priority symbols first: ${prioritySymbols.join(', ')}`);
        bestSignal = await evaluateSymbolList(prioritySymbols, 'PRIORITY');
        // 2) Only if NONE of BTC/ETH/SOL have a valid signal, fall back to other assets
        if (!bestSignal) {
            log('EXEC_BOT', `No valid signal on priority assets (BTC/ETH/SOL). Falling back to secondary assets: ${secondarySymbols.join(', ')}`);
            bestSignal = await evaluateSymbolList(secondarySymbols, 'SECONDARY');
        }
        if (!bestSignal) {
            log('EXEC_BOT', `❌ No valid signal found - returning to IDLE`);
            log('EXEC_BOT', `========================================`);
            return { shouldRestart: false, reason: 'no_signal', pnl: 0, finalStatus: 'completed' };
        }
        log('EXEC_BOT', ``);
        log('EXEC_BOT', `✅ Best signal: ${bestSignal.symbol} (score=${bestSignal.score.toFixed(2)}, ${bestSignal.direction})`);
        log('EXEC_BOT', ``);
        log('EXEC_BOT', `========================================`);
        log('EXEC_BOT', `STEP 3: OPEN ONE POSITION`);
        log('EXEC_BOT', `========================================`);
        // Calculate SL/TP for risk management
        const isLong = bestSignal.direction === 'long';
        let sl;
        let tp;
        try {
            const currentPrice = await (0, hyperliquid_1.fetchPrice)(bestSignal.symbol);
            const slPercentage = Math.min(2.5, 50 / bestSignal.leverage);
            const tpPercentage = slPercentage * 2;
            if (isLong) {
                sl = currentPrice * (1 - slPercentage / 100);
                tp = currentPrice * (1 + tpPercentage / 100);
            }
            else {
                sl = currentPrice * (1 + slPercentage / 100);
                tp = currentPrice * (1 - tpPercentage / 100);
            }
            log('EXEC_BOT', `🛡️ Risk protection: SL=$${sl.toFixed(2)}, TP=$${tp.toFixed(2)}`);
        }
        catch (e) {
            log('WARN', `Could not calculate SL/TP: ${e}`);
        }
        // Open the position
        log('EXEC_BOT', `Opening ${bestSignal.symbol} ${isLong ? 'LONG' : 'SHORT'}`);
        log('EXEC_BOT', `Collateral: $${collateral} | Leverage: ${bestSignal.leverage}x`);
        const result = await (0, avantis_trading_1.openAvantisPositionSafe)({
            symbol: bestSignal.symbol,
            collateral,
            leverage: bestSignal.leverage,
            is_long: isLong,
            private_key: privateKey,
            sl,
            tp
        });
        if (!result.success) {
            log('EXEC_BOT', `❌ Failed to open position: ${result.error}`);
            log('EXEC_BOT', `========================================`);
            return { shouldRestart: false, reason: `open_failed: ${result.error}`, pnl: 0, finalStatus: 'error' };
        }
        log('EXEC_BOT', `✅ Position opened successfully!`);
        log('EXEC_BOT', `TX: ${result.tx_hash}`);
        log('EXEC_BOT', `Pair Index: ${result.pair_index}`);
        log('EXEC_BOT', `========================================`);
        log('EXEC_BOT', ``);
        log('EXEC_BOT', `========================================`);
        log('EXEC_BOT', `STEP 4: MONITOR POSITION UNTIL CLOSE`);
        log('EXEC_BOT', `========================================`);
        this.openPositions = 1; // We just opened one
        // Monitor until position closes
        return await this.monitorPositionsUntilClose();
    }
    /**
     * Monitor existing positions until they close
     * NO OPENING NEW POSITIONS - ONLY MONITORING
     *
     * CRITICAL: Do NOT return to IDLE when position fetch fails/times out!
     * Only return to IDLE when we have CONFIRMED that positions are closed.
     */
    async monitorPositionsUntilClose() {
        if (!this.config || !this.config.privateKey) {
            return { shouldRestart: false, reason: 'no_config', pnl: 0, finalStatus: 'error' };
        }
        const { profitGoal, privateKey } = this.config;
        let monitoringCycle = 0;
        let consecutiveFailures = 0;
        let consecutiveEmptyResults = 0;
        const MAX_CONSECUTIVE_FAILURES = 20; // Allow up to 20 consecutive failures before giving up
        const MAX_CONSECUTIVE_EMPTY = 5; // Require 5 consecutive empty results to confirm position closed
        let lastKnownPositionCount = this.openPositions; // Remember last known position count
        log('EXEC_BOT', `📊 Monitoring mode: Checking positions every ${MONITORING_INTERVAL_MS / 1000}s`);
        log('EXEC_BOT', `🛑 NO NEW POSITIONS WILL BE OPENED - MONITORING ONLY`);
        log('EXEC_BOT', `🔒 Will require ${MAX_CONSECUTIVE_EMPTY} consecutive empty results to confirm position closed`);
        while (this.isRunning && !this.shouldStop && monitoringCycle < MAX_MONITORING_CYCLES) {
            monitoringCycle++;
            try {
                // Get current positions with status (distinguishes between "no positions" and "fetch failed")
                const result = await (0, avantis_trading_1.getAvantisPositionsWithStatus)(privateKey, 3);
                // Check if fetch failed
                if (!result.success) {
                    consecutiveFailures++;
                    consecutiveEmptyResults = 0; // Reset empty counter on failure
                    log('WARN', `[Cycle ${monitoringCycle}] Position fetch failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${result.error}`);
                    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                        log('ERROR', `❌ Too many consecutive failures (${consecutiveFailures}) - Returning to IDLE`);
                        log('ERROR', `⚠️ Position may still be open! Check Avantis dashboard manually.`);
                        return { shouldRestart: false, reason: 'fetch_failures', pnl: this.pnl, finalStatus: 'error' };
                    }
                    // Continue monitoring - don't return to IDLE on failure
                    log('EXEC_BOT', `⏳ Fetch failed, continuing to monitor (last known positions: ${lastKnownPositionCount})`);
                    await delay(MONITORING_INTERVAL_MS);
                    continue;
                }
                // Fetch succeeded - reset failure counter
                consecutiveFailures = 0;
                const positions = result.positions;
                this.openPositions = positions.length;
                // Calculate total PnL
                const totalPnL = positions.reduce((sum, pos) => sum + (pos.pnl || 0), 0);
                this.pnl = totalPnL;
                this.cycle = monitoringCycle;
                if (positions.length === 0) {
                    consecutiveEmptyResults++;
                    log('EXEC_BOT', `[Cycle ${monitoringCycle}] No positions found (${consecutiveEmptyResults}/${MAX_CONSECUTIVE_EMPTY} confirmations needed)`);
                    // CRITICAL: Only return to IDLE after multiple consecutive empty results
                    // This prevents false "position closed" due to RPC inconsistencies
                    if (consecutiveEmptyResults >= MAX_CONSECUTIVE_EMPTY) {
                        log('EXEC_BOT', `✅ Position closure confirmed after ${consecutiveEmptyResults} consecutive empty results`);
                        log('EXEC_BOT', `✅ All positions closed - Returning to IDLE`);
                        log('EXEC_BOT', `Final PnL: $${totalPnL.toFixed(2)}`);
                        log('EXEC_BOT', `========================================`);
                        return { shouldRestart: false, reason: 'position_closed', pnl: totalPnL, finalStatus: 'completed' };
                    }
                    // Not enough confirmations yet - keep monitoring
                    await delay(MONITORING_INTERVAL_MS);
                    continue;
                }
                // We have positions - reset empty counter and update last known count
                consecutiveEmptyResults = 0;
                lastKnownPositionCount = positions.length;
                log('EXEC_BOT', `[Cycle ${monitoringCycle}] Open: ${positions.length} | PnL: $${totalPnL.toFixed(2)}`);
                // Check if profit goal reached
                if (totalPnL >= profitGoal) {
                    log('EXEC_BOT', `🎉 Profit goal reached! PnL: $${totalPnL.toFixed(2)} >= $${profitGoal}`);
                    log('EXEC_BOT', `✅ Returning to IDLE`);
                    return { shouldRestart: false, reason: 'profit_goal_reached', pnl: totalPnL, finalStatus: 'completed' };
                }
                // Wait before next check
                await delay(MONITORING_INTERVAL_MS);
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                consecutiveFailures++;
                consecutiveEmptyResults = 0;
                log('ERROR', `Error in monitoring cycle ${monitoringCycle} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${errorMessage}`);
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    log('ERROR', `❌ Too many consecutive errors - Returning to IDLE`);
                    return { shouldRestart: false, reason: 'monitoring_errors', pnl: this.pnl, finalStatus: 'error' };
                }
                await delay(MONITORING_INTERVAL_MS);
            }
        }
        // Max monitoring cycles reached
        const finalResult = await (0, avantis_trading_1.getAvantisPositionsWithStatus)(privateKey, 3);
        const finalPnL = finalResult.success
            ? finalResult.positions.reduce((sum, p) => sum + (p.pnl || 0), 0)
            : this.pnl;
        log('EXEC_BOT', `⏱️ Max monitoring cycles reached - Returning to IDLE`);
        return { shouldRestart: false, reason: 'max_monitoring_cycles', pnl: finalPnL, finalStatus: 'completed' };
    }
    /**
     * Stop the trading bot
     */
    async stopTrading() {
        log('EXEC_BOT', `🛑 Stop requested`);
        this.shouldStop = true;
        this.isRunning = false;
    }
    /**
     * Get current bot status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            sessionId: this.sessionId,
            config: this.config,
            pnl: this.pnl,
            openPositions: this.openPositions,
            cycle: this.cycle
        };
    }
}
exports.WebTradingBot = WebTradingBot;
//# sourceMappingURL=web-trading-bot.js.map