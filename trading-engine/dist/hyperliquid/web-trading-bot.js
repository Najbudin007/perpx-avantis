"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webTradingBot = exports.WebTradingBot = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const hyperliquid_1 = require("./hyperliquid");
const avantis_trading_1 = require("../avantis-trading");
const regime_1 = require("./regime");
const binanceHistorical_1 = require("./binanceHistorical");
const BudgetAndLeverage_1 = require("./BudgetAndLeverage");
const hyperliquid_2 = require("./hyperliquid");
const strategyEngine_1 = require("./strategyEngine");
const MAX_CYCLES = 10000;
function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}
function log(tag, message) {
    const timestamp = new Date().toISOString();
    console.log(`[${tag}] ${timestamp} — ${message}`);
}
class WebTradingBot {
    constructor() {
        this.isRunning = false;
        this.shouldStop = false;
        this.sessionId = '';
        this.config = null;
        this.pnl = 0;
        this.openPositions = 0;
        this.cycle = 0;
        this.totalLossToday = 0;
        this.tradesOpenedToday = 0;
        this.sessionStartTime = new Date();
        // Risk management constants
        this.MAX_DAILY_LOSS_PERCENT = 20; // Stop trading if daily loss exceeds 20% of budget
        this.MAX_TRADES_PER_DAY = 50; // Max trades per day to prevent overtrading
        this.MIN_TIME_BETWEEN_TRADES_MS = 30000; // 30 seconds between trades
    }
    async startTrading(config) {
        this.config = config;
        this.sessionId = config.sessionId;
        this.isRunning = true;
        this.shouldStop = false;
        this.pnl = 0;
        this.openPositions = 0;
        this.cycle = 0;
        this.totalLossToday = 0;
        this.tradesOpenedToday = 0;
        this.sessionStartTime = new Date();
        log('WEB_BOT', `Starting trading session ${this.sessionId}`);
        log('WEB_BOT', `Config: Budget=$${config.maxBudget}, Goal=$${config.profitGoal}, MaxPos=${config.maxPerSession}`);
        log('WEB_BOT', `Risk Limits: Max Daily Loss=${this.MAX_DAILY_LOSS_PERCENT}%, Max Trades/Day=${this.MAX_TRADES_PER_DAY}`);
        // Log trading platform
        if (config.privateKey) {
            log('AVANTIS', `✅ Trading on AVANTIS platform with private key: ${config.privateKey.slice(0, 10)}...${config.privateKey.slice(-4)}`);
            log('AVANTIS', `✅ Positions will be opened on REAL Avantis dashboard`);
            log('AVANTIS', `✅ Make sure your backend wallet is connected to Avantis dashboard to see positions`);
            log('AVANTIS', `✅ All positions opened will appear in your Avantis dashboard in real-time`);
            console.log(`[WEB_BOT] ✅ Private key is available: ${config.privateKey ? 'YES' : 'NO'}`);
            console.log(`[WEB_BOT] ✅ Private key length: ${config.privateKey?.length || 0}`);
        }
        else {
            log('WARN', `⚠️ No private key provided - using Hyperliquid fallback (testing mode)`);
            log('ERROR', `❌ Cannot open positions on Avantis without private key!`);
            console.error(`[WEB_BOT] ❌ CRITICAL: Private key is MISSING!`);
            console.error(`[WEB_BOT] ❌ Config object:`, {
                hasConfig: !!config,
                hasPrivateKey: !!config?.privateKey,
                configKeys: config ? Object.keys(config) : []
            });
        }
        try {
            // Initialize blockchain connection (non-blocking for faster startup)
            (0, hyperliquid_1.initBlockchain)().then(() => {
                log('WEB_BOT', 'Blockchain initialized successfully');
            }).catch(err => {
                log('ERROR', `Blockchain init error: ${err}`);
            });
            // Record existing positions as trades (non-blocking)
            (0, hyperliquid_2.recordExistingPositionsAsTrades)().catch(err => {
                log('WARN', `Failed to record existing positions: ${err}`);
            });
            // Start the main trading loop (don't await - return immediately)
            // This allows the API to return sessionId faster
            this.runTradingLoop().catch(error => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log('FATAL', `Critical error in session ${this.sessionId}: ${errorMessage}`);
                this.isRunning = false;
            });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log('FATAL', `Critical error in session ${this.sessionId}: ${errorMessage}`);
            throw error;
        }
    }
    stopTrading() {
        log('WEB_BOT', `Stopping trading session ${this.sessionId}`);
        this.shouldStop = true;
        this.isRunning = false;
    }
    async runTradingLoop() {
        if (!this.config) {
            throw new Error('No trading configuration available');
        }
        const { maxBudget, profitGoal, maxPerSession } = this.config;
        let sessionCount = 0;
        // Validate and cap budget
        const validatedBudget = await (0, BudgetAndLeverage_1.validateAndCapBudget)(maxBudget, maxPerSession, undefined, 'avantis');
        log('WEB_BOT', `Validated budget: $${validatedBudget.budgetPerPosition.toFixed(2)} per position (${validatedBudget.isValid ? 'valid' : 'invalid'})`);
        // Get initial positions - use Avantis only (no Hyperliquid fallback)
        let initialPositions = [];
        if (this.config && this.config.privateKey) {
            try {
                const avantisPositions = await (0, avantis_trading_1.getAvantisPositions)(this.config.privateKey);
                log('AVANTIS', `📊 Found ${avantisPositions.length} existing position(s) on Avantis dashboard`);
                if (avantisPositions.length > 0) {
                    log('AVANTIS', `📊 These positions are visible in your Avantis dashboard at https://www.avantisfi.com`);
                    avantisPositions.forEach((pos, idx) => {
                        log('AVANTIS', `   Position ${idx + 1}: ${pos.symbol} ${pos.is_long ? 'LONG' : 'SHORT'} | PnL: $${pos.pnl.toFixed(2)}`);
                    });
                }
                initialPositions = avantisPositions;
            }
            catch (err) {
                log('ERROR', `Failed to get Avantis positions: ${err}`);
                // Don't fallback to Hyperliquid - we only use Avantis
                initialPositions = [];
            }
        }
        else {
            log('WARN', `No private key available - cannot fetch initial Avantis positions`);
            initialPositions = [];
        }
        log('WEB_BOT', `Initial positions: ${initialPositions.length}`);
        // Main trading loop
        while (this.isRunning && !this.shouldStop && sessionCount < MAX_CYCLES) {
            try {
                sessionCount++;
                // Check if we should stop
                if (this.shouldStop) {
                    log('WEB_BOT', `Session ${this.sessionId} stopped by user`);
                    return { shouldRestart: false, reason: 'user_stopped', pnl: 0, finalStatus: 'stopped' };
                }
                // Get current PnL - use Avantis only (no Hyperliquid fallback)
                let totalPnL = 0;
                if (this.config && this.config.privateKey) {
                    try {
                        const avantisPositions = await (0, avantis_trading_1.getAvantisPositions)(this.config.privateKey);
                        totalPnL = avantisPositions.reduce((sum, pos) => sum + (pos.pnl || 0), 0);
                        log('AVANTIS', `💰 Total PnL from Avantis: $${totalPnL.toFixed(2)}`);
                        // Update daily loss tracker
                        if (totalPnL < 0) {
                            this.totalLossToday = Math.abs(totalPnL);
                        }
                    }
                    catch (err) {
                        log('ERROR', `Failed to get Avantis PnL: ${err}`);
                        // Don't fallback to Hyperliquid - we only use Avantis
                        totalPnL = 0;
                    }
                    // ==========================================
                    // RISK CHECK: Stop if daily loss limit exceeded
                    // ==========================================
                    const maxLossAmount = (maxBudget * this.MAX_DAILY_LOSS_PERCENT) / 100;
                    if (this.totalLossToday >= maxLossAmount) {
                        log('RISK', `🛑 DAILY LOSS LIMIT REACHED! Loss: $${this.totalLossToday.toFixed(2)} >= Max: $${maxLossAmount.toFixed(2)}`);
                        log('RISK', `🛑 Stopping trading to protect capital. Session will resume tomorrow.`);
                        return { shouldRestart: false, reason: 'daily_loss_limit', pnl: totalPnL, finalStatus: 'stopped' };
                    }
                    // RISK CHECK: Max trades per day
                    if (this.tradesOpenedToday >= this.MAX_TRADES_PER_DAY) {
                        log('RISK', `🛑 MAX TRADES PER DAY REACHED (${this.MAX_TRADES_PER_DAY}). Stopping for today.`);
                        return { shouldRestart: false, reason: 'max_trades_reached', pnl: totalPnL, finalStatus: 'completed' };
                    }
                }
                else {
                    log('WARN', `No private key available - cannot fetch Avantis PnL`);
                    totalPnL = 0;
                }
                this.pnl = totalPnL;
                this.cycle = sessionCount;
                log('WEB_BOT', `Cycle ${sessionCount}: Total PnL: $${totalPnL.toFixed(2)}`);
                // Check profit goal
                if (totalPnL >= profitGoal) {
                    log('WEB_BOT', `✅ Profit goal reached! PnL: $${totalPnL.toFixed(2)}`);
                    await this.closeAllPositions();
                    return { shouldRestart: false, reason: 'profit_goal_reached', pnl: totalPnL, finalStatus: 'completed' };
                }
                // Check if we've lost too much
                if (totalPnL <= -validatedBudget * 0.8) {
                    log('WEB_BOT', `❌ Stop loss triggered! PnL: $${totalPnL.toFixed(2)}`);
                    await this.closeAllPositions();
                    return { shouldRestart: false, reason: 'stop_loss_triggered', pnl: totalPnL, finalStatus: 'completed' };
                }
                // Get current positions - use Avantis only (no Hyperliquid fallback)
                let positions = [];
                if (this.config && this.config.privateKey) {
                    try {
                        positions = await (0, avantis_trading_1.getAvantisPositions)(this.config.privateKey);
                        log('AVANTIS', `📊 Fetched ${positions.length} position(s) from Avantis dashboard`);
                    }
                    catch (err) {
                        log('ERROR', `Failed to get Avantis positions: ${err}`);
                        // Don't fallback to Hyperliquid - we only use Avantis
                        positions = [];
                    }
                }
                else {
                    log('WARN', `No private key available - cannot fetch Avantis positions`);
                    positions = [];
                }
                this.openPositions = positions.length;
                log('WEB_BOT', `Open positions: ${positions.length}`);
                // Check for take profit on existing positions - Skip for Avantis-only trading
                // TP/SL is handled by Avantis platform directly
                // await checkAndCloseForTP({
                //   client,
                //   account,
                //   profitGoal,
                //   closePosition
                // });
                // Get market regime (use BTC as default) - parallelize data fetching for speed
                const [btcOHLCV4h, btcOHLCV6h] = await Promise.all([
                    (0, binanceHistorical_1.getCachedOHLCV)('BTC', '4h', 300).catch(() => null),
                    (0, binanceHistorical_1.getCachedOHLCV)('BTC', '6h', 300).catch(() => null)
                ]);
                const regimeResult = (btcOHLCV4h && btcOHLCV6h) ? await (0, regime_1.guessMarketRegime)('BTC', btcOHLCV4h, btcOHLCV6h) : { regime: 'neutral' };
                const marketRegime = regimeResult.regime;
                log('WEB_BOT', `Market regime: ${marketRegime}`);
                // Only open new positions if we're under the limit
                if (positions.length < maxPerSession) {
                    // Get available trading symbols - prioritize BTC and ETH
                    const tokens = ['BTC', 'ETH', 'SOL', 'AVAX', 'MATIC', 'LINK', 'UNI', 'ATOM'];
                    let slotsLeft = maxPerSession - positions.length;
                    let entriesThis = 0;
                    // IMPORTANT: Process symbols SEQUENTIALLY to respect maxPositions limit
                    // This prevents opening multiple positions when maxPositions=1
                    log('WEB_BOT', `📊 Available slots: ${slotsLeft}, Max positions: ${maxPerSession}`);
                    for (const symbol of tokens) {
                        // Check slots BEFORE each evaluation to respect limit
                        if (entriesThis >= slotsLeft) {
                            log('WEB_BOT', `🛑 Slot limit reached (${entriesThis}/${slotsLeft}). Skipping remaining symbols.`);
                            break;
                        }
                        const evalResult = await (async () => {
                            try {
                                // Parallelize OHLCV data fetching for speed
                                const [ohlcv4h, ohlcv6h] = await Promise.all([
                                    (0, binanceHistorical_1.getCachedOHLCV)(symbol, '4h', 300).catch(() => null),
                                    (0, binanceHistorical_1.getCachedOHLCV)(symbol, '6h', 300).catch(() => null)
                                ]);
                                if (!ohlcv4h || !ohlcv6h || ohlcv4h.close.length < 10 || ohlcv6h.close.length < 10) {
                                    return null; // Skip silently for speed
                                }
                                // Calculate budget per position
                                const perPositionBudget = validatedBudget.budgetPerPosition;
                                // Get leverage for this symbol
                                const { leverage } = (0, BudgetAndLeverage_1.getBudgetAndLeverage)(marketRegime, symbol, perPositionBudget);
                                log('WEB_BOT', `Evaluating ${symbol} | Budget=$${perPositionBudget.toFixed(2)} | Leverage=${leverage}x`);
                                // Evaluate signal to get direction (using already fetched OHLCV data)
                                // We'll use the signal logic but execute on Avantis instead
                                // Evaluate signal to get direction
                                const signalResult = await (0, strategyEngine_1.evaluateSignalOnly)(symbol, ohlcv4h, {
                                    regimeOverride: marketRegime,
                                    leverage,
                                    bypassBacktestCheck: true
                                });
                                const { direction, signalScore, passed, reason: signalReason } = signalResult;
                                if (!direction || !passed) {
                                    return {
                                        symbol,
                                        result: {
                                            positionOpened: false,
                                            marketRegime,
                                            reason: signalReason || "signal_not_passed",
                                            signalScore
                                        }
                                    };
                                }
                                // If we have a private key, open position on Avantis (real trading)
                                if (this.config && this.config.privateKey) {
                                    try {
                                        const isLong = direction === "long";
                                        // ========================================================
                                        // RISK MANAGEMENT: Calculate SL and TP for protection
                                        // ========================================================
                                        // Get current price for SL/TP calculation
                                        let currentPrice = 0;
                                        try {
                                            currentPrice = await (0, hyperliquid_1.fetchPrice)(symbol);
                                        }
                                        catch (e) {
                                            log('AVANTIS', `⚠️ Could not fetch price for SL/TP calculation: ${e}`);
                                        }
                                        // Calculate Stop Loss and Take Profit
                                        // For high leverage positions, we MUST have a stop loss to prevent liquidation
                                        let sl;
                                        let tp;
                                        if (currentPrice > 0) {
                                            // Stop Loss: Set at 50% of liquidation distance to give buffer
                                            // With 25x leverage, liquidation is at ~4% move against you
                                            // So we set SL at ~2% to exit before liquidation
                                            const slPercentage = Math.min(2.5, 50 / leverage); // 2.5% max, or 50%/leverage
                                            // Take Profit: Set at 2x the SL distance (risk:reward = 1:2)
                                            const tpPercentage = slPercentage * 2;
                                            if (isLong) {
                                                // Long position: SL below entry, TP above entry
                                                sl = currentPrice * (1 - slPercentage / 100);
                                                tp = currentPrice * (1 + tpPercentage / 100);
                                            }
                                            else {
                                                // Short position: SL above entry, TP below entry
                                                sl = currentPrice * (1 + slPercentage / 100);
                                                tp = currentPrice * (1 - tpPercentage / 100);
                                            }
                                            log('AVANTIS', `🛡️ RISK PROTECTION: SL=${sl?.toFixed(2)}, TP=${tp?.toFixed(2)} (${slPercentage.toFixed(1)}% SL / ${tpPercentage.toFixed(1)}% TP)`);
                                        }
                                        else {
                                            log('AVANTIS', `⚠️ WARNING: Opening position WITHOUT Stop Loss - liquidation risk!`);
                                        }
                                        log('AVANTIS', `🚀 Opening ${symbol} ${isLong ? 'LONG' : 'SHORT'} on REAL AVANTIS PLATFORM...`);
                                        log('AVANTIS', `   Collateral: $${perPositionBudget.toFixed(2)} | Leverage: ${leverage}x`);
                                        if (sl)
                                            log('AVANTIS', `   Stop Loss: $${sl.toFixed(2)} | Take Profit: $${tp?.toFixed(2)}`);
                                        const avantisResult = await (0, avantis_trading_1.openAvantisPositionSafe)({
                                            symbol,
                                            collateral: perPositionBudget,
                                            leverage,
                                            is_long: isLong,
                                            private_key: this.config.privateKey,
                                            sl, // Add Stop Loss for protection
                                            tp // Add Take Profit for profit-taking
                                        });
                                        if (avantisResult && avantisResult.success) {
                                            // Increment daily trade counter
                                            this.tradesOpenedToday++;
                                            log('AVANTIS', `✅✅✅ Position SUCCESSFULLY opened on Avantis Dashboard!`);
                                            log('AVANTIS', `   Symbol: ${symbol} | Direction: ${isLong ? 'LONG' : 'SHORT'}`);
                                            log('AVANTIS', `   Transaction: ${avantisResult.tx_hash?.slice(0, 16)}...`);
                                            log('AVANTIS', `   Pair Index: ${avantisResult.pair_index}`);
                                            log('AVANTIS', `   Collateral: $${perPositionBudget.toFixed(2)} | Leverage: ${leverage}x`);
                                            log('AVANTIS', `   Trades Today: ${this.tradesOpenedToday}/${this.MAX_TRADES_PER_DAY}`);
                                            log('AVANTIS', `   ==========================================`);
                                            log('AVANTIS', `   📊 POSITION IS NOW LIVE ON AVANTIS DASHBOARD`);
                                            log('AVANTIS', `   📊 Visit avantisfi.com and connect your backend wallet`);
                                            log('AVANTIS', `   📊 The position will appear in "Current Positions" section`);
                                            log('AVANTIS', `   ==========================================`);
                                            return {
                                                symbol,
                                                result: {
                                                    positionOpened: true,
                                                    marketRegime,
                                                    reason: "executed_on_avantis",
                                                    signalScore,
                                                    avantisTxHash: avantisResult.tx_hash,
                                                    avantisPairIndex: avantisResult.pair_index
                                                }
                                            };
                                        }
                                        else {
                                            log('AVANTIS', `❌ Failed to open position on Avantis: ${avantisResult.error}`);
                                            return {
                                                symbol,
                                                result: {
                                                    positionOpened: false,
                                                    marketRegime,
                                                    reason: `avantis_error: ${avantisResult.error}`,
                                                    signalScore
                                                }
                                            };
                                        }
                                    }
                                    catch (avantisError) {
                                        log('AVANTIS', `❌ Exception opening position on Avantis: ${avantisError}`);
                                        return {
                                            symbol,
                                            result: {
                                                positionOpened: false,
                                                marketRegime,
                                                reason: `avantis_exception: ${avantisError}`,
                                                signalScore
                                            }
                                        };
                                    }
                                }
                                else {
                                    // No private key - fallback to Hyperliquid (for testing/development)
                                    console.error(`[WEB_BOT] ❌ No private key available for ${symbol}!`);
                                    console.error(`[WEB_BOT] ❌ Config check:`, {
                                        hasConfig: !!this.config,
                                        hasPrivateKey: !!this.config?.privateKey,
                                        configKeys: this.config ? Object.keys(this.config) : []
                                    });
                                    log('WARN', `⚠️ No private key available - using Hyperliquid fallback for ${symbol} (positions won't appear on Avantis)`);
                                    log('ERROR', `❌ CRITICAL: Cannot open positions on Avantis without private key!`);
                                    const result = await (0, hyperliquid_1.runSignalCheckAndOpen)({
                                        symbol,
                                        perPositionBudget,
                                        leverage,
                                        regimeOverride: marketRegime
                                    });
                                    return { symbol, result };
                                }
                            }
                            catch (error) {
                                log('WEB_BOT', `Error evaluating ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
                                return null;
                            }
                        })();
                        // Process result immediately (sequential processing)
                        if (evalResult) {
                            const { symbol: evalSymbol, result } = evalResult;
                            const { positionOpened, signalScore, reason } = result;
                            if (positionOpened) {
                                entriesThis++;
                                this.openPositions++;
                                slotsLeft--; // Decrease available slots immediately
                                log('WEB_BOT', `✅ ${evalSymbol} opened | Score=${signalScore} | Entries: ${entriesThis}/${maxPerSession}`);
                                log('WEB_BOT', `📊 Total open positions: ${this.openPositions}, Slots remaining: ${slotsLeft}`);
                                // STOP after opening a position if we've reached the limit
                                if (entriesThis >= (maxPerSession - positions.length)) {
                                    log('WEB_BOT', `🛑 Position limit reached. Stopping symbol evaluation.`);
                                    break;
                                }
                            }
                            else {
                                log('WEB_BOT', `${evalSymbol} => ❌ No trade | Reason: ${reason}`);
                                // Log detailed rejection reason for debugging
                                if (reason && reason.length > 0) {
                                    const reasonLines = reason.split('\n');
                                    reasonLines.forEach(line => {
                                        if (line.trim()) {
                                            log('WEB_BOT', `   ${line.trim()}`);
                                        }
                                    });
                                }
                            }
                        }
                    } // End of sequential symbol loop
                    // Log summary of position opening attempts
                    if (entriesThis === 0 && (maxPerSession - positions.length) > 0) {
                        log('WEB_BOT', `⚠️ No positions opened this cycle. Available slots: ${maxPerSession - positions.length}`);
                        log('WEB_BOT', `   Check signal evaluation logs above for reasons.`);
                        if (!this.config?.privateKey) {
                            log('WEB_BOT', `   ⚠️ CRITICAL: No private key available - positions cannot be opened on Avantis!`);
                        }
                    }
                }
                // Wait before next cycle - reduced for faster execution
                await delay(5000); // 5 seconds between cycles (optimized for speed)
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log('ERROR', `Error in cycle ${sessionCount}: ${errorMessage}`);
                // Continue trading unless it's a critical error
                if (errorMessage.includes('FATAL') || errorMessage.includes('Critical')) {
                    return { shouldRestart: false, reason: 'critical_error', pnl: 0, finalStatus: 'error' };
                }
            }
        }
        // If we reach here, the session completed normally
        let finalPnL = 0;
        if (this.config.privateKey) {
            try {
                const avantisPositions = await (0, avantis_trading_1.getAvantisPositions)(this.config.privateKey);
                finalPnL = avantisPositions.reduce((sum, pos) => sum + (pos.pnl || 0), 0);
            }
            catch (err) {
                log('WARN', `Failed to get final Avantis PnL, falling back to Hyperliquid: ${err}`);
                finalPnL = await (0, hyperliquid_1.getTotalPnL)();
            }
        }
        else {
            finalPnL = await (0, hyperliquid_1.getTotalPnL)();
        }
        log('WEB_BOT', `Session ${this.sessionId} completed after ${sessionCount} cycles. Final PnL: $${finalPnL.toFixed(2)}`);
        return { shouldRestart: false, reason: 'max_cycles_reached', pnl: finalPnL, finalStatus: 'completed' };
    }
    async closeAllPositions() {
        try {
            log('WEB_BOT', 'Closing all positions...');
            await (0, hyperliquid_1.closeAllPositions)();
            log('WEB_BOT', 'All positions closed');
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log('ERROR', `Error closing positions: ${errorMessage}`);
        }
    }
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
// Export for use in the web server
exports.webTradingBot = new WebTradingBot();
//# sourceMappingURL=web-trading-bot.js.map