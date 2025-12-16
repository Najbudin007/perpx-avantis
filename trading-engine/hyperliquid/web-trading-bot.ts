import dotenv from 'dotenv';
dotenv.config();

import Decimal from 'decimal.js';
import {
  initBlockchain,
  getTotalPnL,
  closeAllPositions,
  getPositions,
  runSignalCheckAndOpen,
  closePosition,
  fetchPrice,
  client,
  account,
  priceFeeds
} from './hyperliquid';
import { openAvantisPositionSafe, getAvantisPositions } from '../avantis-trading';

import { checkAndCloseForTP } from './tpsl';
import { guessMarketRegime } from './regime';
import { getCachedOHLCV } from './binanceHistorical';
import { getBudgetAndLeverage, validateAndCapBudget } from './BudgetAndLeverage';
import { winRateTracker } from './winRateTracker';
import { getAIPOS } from './aiStorage';
import { recordLiquidatedTrades, recordExistingPositionsAsTrades } from './hyperliquid';
import { evaluateSignalOnly } from './strategyEngine';

const MAX_MONITORING_CYCLES = 10000; // Max cycles for monitoring (not trading)
const MONITORING_INTERVAL_MS = 10000; // 10 seconds between position checks

function delay(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

function log(tag: string, message: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${tag}] ${timestamp} — ${message}`);
}

export interface TradingConfig {
  maxBudget: number;
  profitGoal: number;
  maxPerSession: number; // Hard limit on concurrent positions
  sessionId: string;
  privateKey?: string; // Private key for Avantis trading
}

export interface TradingResult {
  shouldRestart: boolean;
  reason: string;
  pnl: number;
  finalStatus: 'completed' | 'error' | 'stopped';
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
export class WebTradingBot {
  private isRunning = false;
  private shouldStop = false;
  private sessionId: string = '';
  private config: TradingConfig | null = null;
  private pnl: number = 0;
  private openPositions: number = 0;
  private cycle: number = 0;

  /**
   * Start trading session - Opens ONE position, then monitors until close
   * This is the ONLY entry point for opening positions
   */
  async startTrading(config: TradingConfig): Promise<void> {
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('ERROR', `❌ Execution failed: ${errorMessage}`);
      this.isRunning = false;
    }
  }

  /**
   * Execute ONE trade (if allowed), then monitor until close
   * NO LOOPS, NO SCANNING, NO AUTONOMOUS BEHAVIOR
   */
  private async executeTradeAndMonitor(): Promise<TradingResult> {
    if (!this.config || !this.config.privateKey) {
      return { shouldRestart: false, reason: 'no_config', pnl: 0, finalStatus: 'error' };
    }

    const { maxBudget, profitGoal, maxPerSession, privateKey } = this.config;

    log('EXEC_BOT', `========================================`);
    log('EXEC_BOT', `STEP 1: CHECK IF POSITION CAN BE OPENED`);
    log('EXEC_BOT', `========================================`);

    // RULE 1: Check existing positions FIRST
    let existingPositions: any[] = [];
    try {
      existingPositions = await getAvantisPositions(privateKey);
      this.openPositions = existingPositions.length;
      log('EXEC_BOT', `📊 Current open positions: ${this.openPositions}`);
          } catch (err) {
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
    // IMPORTANT: Only include symbols that are supported on BOTH:
    // - Hyperliquid price feeds
    // - Avantis on-chain symbol registry (see perpx-avantis-service logs)
    //
    // This prevents the bot from selecting symbols like ATOM that are not
    // tradable on the current Avantis deployment.
    const symbols = [
      'BTC',
      'ETH',
      'SOL',
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
    let bestSignal: { symbol: string; score: number; direction: string; leverage: number } | null = null;

    // Get market regime for evaluation
        const [btcOHLCV4h, btcOHLCV6h] = await Promise.all([
          getCachedOHLCV('BTC', '4h', 300).catch(() => null),
          getCachedOHLCV('BTC', '6h', 300).catch(() => null)
        ]);
        const regimeResult = (btcOHLCV4h && btcOHLCV6h) ? await guessMarketRegime('BTC', btcOHLCV4h, btcOHLCV6h) : { regime: 'neutral' };
        const marketRegime = regimeResult.regime;

    log('EXEC_BOT', `Market regime: ${marketRegime}`);

    // Validate budget
    const validatedBudget = validateAndCapBudget(maxBudget, maxPerSession, 'BTC');
    const collateral = validatedBudget.budgetPerPosition;

    // Evaluate each symbol to find best signal
    for (const symbol of symbols) {
      try {
              const [ohlcv4h, ohlcv6h] = await Promise.all([
                getCachedOHLCV(symbol, '4h', 300).catch(() => null),
                getCachedOHLCV(symbol, '6h', 300).catch(() => null)
              ]);
              
              if (!ohlcv4h || !ohlcv6h || ohlcv4h.close.length < 10 || ohlcv6h.close.length < 10) {
          continue; // Skip if insufficient data
        }

        const { leverage } = getBudgetAndLeverage(marketRegime as any, symbol, collateral);
        
              const signalResult = await evaluateSignalOnly(symbol, ohlcv4h, {
                regimeOverride: marketRegime as any,
                leverage,
                bypassBacktestCheck: true
              });

        const { direction, signalScore, passed } = signalResult;

        if (passed && direction && signalScore) {
          log('EXEC_BOT', `${symbol}: score=${signalScore.toFixed(2)}, direction=${direction}, leverage=${leverage}x`);
          
          if (!bestSignal || signalScore > bestSignal.score) {
            bestSignal = { symbol, score: signalScore, direction, leverage };
          }
        }
      } catch (err) {
        log('WARN', `Could not evaluate ${symbol}: ${err}`);
      }
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
                  let sl: number | undefined;
                  let tp: number | undefined;
                  
    try {
      const currentPrice = await fetchPrice(bestSignal.symbol);
      const slPercentage = Math.min(2.5, 50 / bestSignal.leverage);
                    const tpPercentage = slPercentage * 2;
                    
                    if (isLong) {
                      sl = currentPrice * (1 - slPercentage / 100);
                      tp = currentPrice * (1 + tpPercentage / 100);
                    } else {
                      sl = currentPrice * (1 + slPercentage / 100);
                      tp = currentPrice * (1 - tpPercentage / 100);
                    }
                    
      log('EXEC_BOT', `🛡️ Risk protection: SL=$${sl.toFixed(2)}, TP=$${tp.toFixed(2)}`);
    } catch (e) {
      log('WARN', `Could not calculate SL/TP: ${e}`);
    }

    // Open the position
    log('EXEC_BOT', `Opening ${bestSignal.symbol} ${isLong ? 'LONG' : 'SHORT'}`);
    log('EXEC_BOT', `Collateral: $${collateral} | Leverage: ${bestSignal.leverage}x`);

    const result = await openAvantisPositionSafe({
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
   */
  private async monitorPositionsUntilClose(): Promise<TradingResult> {
    if (!this.config || !this.config.privateKey) {
      return { shouldRestart: false, reason: 'no_config', pnl: 0, finalStatus: 'error' };
    }

    const { profitGoal, privateKey } = this.config;
    let monitoringCycle = 0;

    log('EXEC_BOT', `📊 Monitoring mode: Checking positions every ${MONITORING_INTERVAL_MS / 1000}s`);
    log('EXEC_BOT', `🛑 NO NEW POSITIONS WILL BE OPENED - MONITORING ONLY`);

    while (this.isRunning && !this.shouldStop && monitoringCycle < MAX_MONITORING_CYCLES) {
      monitoringCycle++;
      
      try {
        // Get current positions
        const positions = await getAvantisPositions(privateKey);
        this.openPositions = positions.length;
        
        // Calculate total PnL
        const totalPnL = positions.reduce((sum, pos) => sum + (pos.pnl || 0), 0);
        this.pnl = totalPnL;
        this.cycle = monitoringCycle;

        if (positions.length === 0) {
          log('EXEC_BOT', `✅ All positions closed - Returning to IDLE`);
          log('EXEC_BOT', `Final PnL: $${totalPnL.toFixed(2)}`);
          log('EXEC_BOT', `========================================`);
          return { shouldRestart: false, reason: 'position_closed', pnl: totalPnL, finalStatus: 'completed' };
        }

        log('EXEC_BOT', `[Cycle ${monitoringCycle}] Open: ${positions.length} | PnL: $${totalPnL.toFixed(2)}`);

        // Check if profit goal reached
        if (totalPnL >= profitGoal) {
          log('EXEC_BOT', `🎉 Profit goal reached! PnL: $${totalPnL.toFixed(2)} >= $${profitGoal}`);
          log('EXEC_BOT', `✅ Returning to IDLE`);
          return { shouldRestart: false, reason: 'profit_goal_reached', pnl: totalPnL, finalStatus: 'completed' };
        }

        // Wait before next check
        await delay(MONITORING_INTERVAL_MS);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('ERROR', `Error in monitoring cycle: ${errorMessage}`);
        await delay(MONITORING_INTERVAL_MS);
      }
    }

    // Max monitoring cycles reached
    const finalPnL = await getAvantisPositions(privateKey)
      .then(pos => pos.reduce((sum, p) => sum + (p.pnl || 0), 0))
      .catch(() => 0);

    log('EXEC_BOT', `⏱️ Max monitoring cycles reached - Returning to IDLE`);
    return { shouldRestart: false, reason: 'max_monitoring_cycles', pnl: finalPnL, finalStatus: 'completed' };
  }

  /**
   * Stop the trading bot
   */
  async stopTrading(): Promise<void> {
    log('EXEC_BOT', `🛑 Stop requested`);
    this.shouldStop = true;
    this.isRunning = false;
  }

  /**
   * Get current bot status
   */
  getStatus(): { 
    isRunning: boolean; 
    sessionId: string; 
    config: TradingConfig | null;
    pnl: number;
    openPositions: number;
    cycle: number;
  } {
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
