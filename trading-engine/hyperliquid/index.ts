import dotenv from 'dotenv';
dotenv.config();

import Decimal from 'decimal.js';
import readline from 'readline';

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

import { checkAndCloseForTP } from './tpsl';
import { guessMarketRegime } from './regime';
import { getCachedOHLCV } from './binanceHistorical';
import { getBudgetAndLeverage, validateAndCapBudget } from './BudgetAndLeverage';
import { winRateTracker } from './winRateTracker';
import { getAIPOS } from './aiStorage';
import { recordLiquidatedTrades, recordExistingPositionsAsTrades } from './hyperliquid';

const MAX_CYCLES = 10000;

function delay(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

function log(tag: string, message: string) {
  console.log(`[${tag}] ${new Date().toISOString()} — ${message}`);
}

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

async function getUserInputs(): Promise<{ maxBudget: number; profitGoal: number; maxPerSession: number }> {
  // Use environment variables if available (from API server), otherwise use interactive input
  if (process.env.MAX_BUDGET && process.env.PROFIT_GOAL && process.env.MAX_PER_SESSION) {
    const maxBudget = parseFloat(process.env.MAX_BUDGET) || 1000;
    const profitGoal = parseFloat(process.env.PROFIT_GOAL) || 5;
    const maxPerSession = parseInt(process.env.MAX_PER_SESSION) || 1;
    
    console.log('\n🚀 Hyperliquid Trading Bot Configuration\n');
    console.log(`📊 Budget: $${maxBudget}`);
    console.log(`🎯 Profit Goal: $${profitGoal}`);
    console.log(`📈 Max Positions: ${maxPerSession}\n`);
    
    return { maxBudget, profitGoal, maxPerSession };
  }
  
  // Fallback to interactive input for manual runs
  const rl = createInterface();
  
  console.log('\n🚀 Hyperliquid Trading Bot Configuration\n');
  console.log('Please enter your trading parameters:\n');
  
  // Get budget
  const maxBudget = await new Promise<number>((resolve) => {
    rl.question('Enter your trading budget ($): ', (answer) => {
      const budget = parseFloat(answer);
      if (isNaN(budget) || budget < 10) {
        console.log('❌ Invalid budget. Minimum is $10. Using default: $1000');
        resolve(1000);
      } else if (budget > 10000000) {
        console.log('❌ Budget too high. Maximum is $10M. Using default: $1000');
        resolve(1000);
      } else {
        resolve(budget);
      }
    });
  });
  
  // Get profit goal
  const profitGoal = await new Promise<number>((resolve) => {
    rl.question('Enter your profit goal ($): ', (answer) => {
      const goal = parseFloat(answer);
      if (isNaN(goal) || goal <= 0) {
        console.log('❌ Invalid profit goal. Using default: $5');
        resolve(5);
      } else {
        resolve(goal);
      }
    });
  });
  
  // Get max positions
  const maxPerSession = await new Promise<number>((resolve) => {
    rl.question('Enter maximum positions per session (1-20): ', (answer) => {
      const positions = parseInt(answer);
      if (isNaN(positions) || positions < 1 || positions > 20) {
        console.log('❌ Invalid position count. Using default: 5');
        resolve(5);
      } else {
        resolve(positions);
      }
    });
  });
  
  rl.close();
  
  console.log('\n✅ Configuration Summary:');
  console.log(`   Budget: $${maxBudget}`);
  console.log(`   Profit Goal: $${profitGoal}`);
  console.log(`   Max Positions: ${maxPerSession}`);
  console.log('\nStarting trading session...\n');

  return { maxBudget, profitGoal, maxPerSession };
}

// Export for testing
export { getUserInputs, delay };

async function runSession() {
  // Get user inputs
  const { maxBudget, profitGoal, maxPerSession } = await getUserInputs();
  
  const maxBudgetDecimal = new Decimal(maxBudget);
  let sessionCount = 0;
  let totalPnL = 0;

  const tokens = Object.keys(priceFeeds);
  const openMap: Record<string, boolean> = {};
  tokens.forEach(t => openMap[t] = false);

  await initBlockchain();
  
  // Record any existing positions as trades
  await recordExistingPositionsAsTrades();
  
  log('START', `Session initialized | Budget: $${maxBudget} | Goal: $${profitGoal}`);

  for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
    log('CYCLE', `--- Cycle ${cycle + 1} ---`);

    // Fetch positions and update open map
    const pos = await getPositions().catch(() => []);

    const currentlyOpen = new Set<string>();

    for (const p of pos) {
      const rawSzi = p.szi ?? '0';
      const szi = Number(rawSzi);

      if (!Number.isFinite(szi)) {
        console.warn(`⚠️ Invalid position size: szi="${rawSzi}" for coin=${p.coin}`);
        continue;
      }

      if (Math.abs(szi) < 1) continue;

      const token = tokens.find(t => p.coin?.toUpperCase().includes(t));
      if (token) currentlyOpen.add(token);
    }
    
    tokens.forEach(t => openMap[t] = currentlyOpen.has(t));
    const openCount = currentlyOpen.size;
    const slotsLeft = maxPerSession - openCount;

    // Check total PnL and close all positions if profit goal is reached
    const pnl = await getTotalPnL().catch(() => null);
    if (pnl != null) {
      totalPnL = pnl;
      log('PNL', `Total PnL: $${pnl.toFixed(2)} | Goal: $${profitGoal}`);
      
      // Close all positions if total profit goal is reached
      if (pnl >= profitGoal) {
        log('PROFIT_GOAL', `🎯 Total profit goal reached! Closing all positions. PnL: $${pnl.toFixed(2)} >= Goal: $${profitGoal}`);
        
        // Get all positions and close them
        const positions = await getPositions().catch(() => []);
        let closedCount = 0;
        
        for (const pos of positions) {
          if (!pos.coin || !pos.szi || Math.abs(Number(pos.szi)) < 1) continue;
          
          try {
            let mark = await fetchPrice(pos.coin);
            
            // Retry once if price fetch failed
            if (!mark || mark <= 0) {
              console.warn(`⚠️ Retrying price fetch for ${pos.coin}...`);
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
              mark = await fetchPrice(pos.coin);
            }
            
            if (mark && mark > 0) {
              await closePosition(pos.coin, pos, "total_profit_goal_reached", mark);
              closedCount++;
              log('CLOSE', `✅ Closed ${pos.coin} position due to total profit goal`);
            } else {
              console.warn(`⚠️ Cannot close ${pos.coin} position - invalid price after retry: ${mark}`);
            }
          } catch (e) {
            console.warn(`❌ Failed to close ${pos.coin}:`, e);
          }
        }
        
        if (closedCount > 0) {
          log('SESSION_END', `🎉 Session completed! Total PnL: $${pnl.toFixed(2)} | Closed ${closedCount} positions`);
          
          // Try to record any remaining liquidated trades
          await recordLiquidatedTrades();
          
          // Log final win rate statistics
          console.log('\n🎯 [SESSION_END] Final Win Rate Statistics:');
          winRateTracker.logStats();
          
          // Debug: Check what trades are in the tracker
          const allTrades = winRateTracker.getTradeHistory();
          console.log(`🔍 [DEBUG] Total trades in history: ${allTrades.length}`);
          allTrades.forEach((trade, index) => {
            console.log(`   Trade ${index + 1}: ${trade.symbol} ${trade.side} | Status: ${trade.status} | PnL: $${trade.pnl?.toFixed(2) || 'N/A'}`);
          });
          
          // Return true to indicate session should restart
          return { shouldRestart: true, reason: 'profit_goal_reached', pnl: pnl };
        }
      }
    }

    // Only check individual position profit goals if total PnL hasn't reached the goal
    if (pnl == null || pnl < profitGoal) {
      const { closedAny, closedCount } = await checkAndCloseForTP({
        client,
        account,
        closePosition,
        profitGoal // Pass profit goal for individual position checks
      });

      if (closedAny) {
        sessionCount = Math.max(0, sessionCount - closedCount);
        
        // Log win rate stats after any positions are closed
        winRateTracker.logStats();
      }
    }

    // Check if all positions are liquidated (no open positions and no slots left, but only if we've actually traded)
    if (openCount === 0 && slotsLeft === maxPerSession && cycle > 1) {
      log('LIQUIDATION', `💀 All positions liquidated! Restarting session...`);
      
      // Try to record any remaining liquidated trades
      await recordLiquidatedTrades();
      
      // Log final win rate statistics
      console.log('\n💀 [LIQUIDATION] Final Win Rate Statistics:');
      winRateTracker.logStats();
      
      // Debug: Check what trades are in the tracker
      const allTrades = winRateTracker.getTradeHistory();
      console.log(`🔍 [DEBUG] Total trades in history: ${allTrades.length}`);
      allTrades.forEach((trade, index) => {
        console.log(`   Trade ${index + 1}: ${trade.symbol} ${trade.side} | Status: ${trade.status} | PnL: $${trade.pnl?.toFixed(2) || 'N/A'}`);
      });
      
      // Return true to indicate session should restart
      return { shouldRestart: true, reason: 'all_liquidated', pnl: pnl || 0 };
    }

    // Entry logic
    if (slotsLeft > 0) {
      let entriesThis = 0;

      for (const symbol of tokens) {
        if (openMap[symbol] || entriesThis >= slotsLeft) continue;

        const ohlcv15 = await getCachedOHLCV(symbol, '15m', 300).catch(() => null);
        const ohlcv30 = await getCachedOHLCV(symbol, '30m', 300).catch(() => null);
        if (!ohlcv15 || !ohlcv30 || ohlcv15.close.length < 100) {
          log('SKIP', `${symbol} missing or insufficient data`);
          continue;
        }

        const { regime } = await guessMarketRegime(symbol, ohlcv15, ohlcv30);
        
        // Calculate budget per position from user's input, not regime-based budget
        const budgetValidation = validateAndCapBudget(maxBudget, maxPerSession, symbol);
        const perPositionBudget = budgetValidation.budgetPerPosition;

        // Get maximum leverage for this symbol using user's budget
        const { leverage } = getBudgetAndLeverage(regime, symbol, perPositionBudget);

        // Log warnings if any
        if (budgetValidation.warnings) {
          budgetValidation.warnings.forEach(warning => {
            log('WARNING', warning);
          });
        }

        log('ENTRY', `${symbol} | Regime=${regime} | Budget=$${perPositionBudget.toFixed(2)} (${maxBudget}/${maxPerSession}) | MAX_LEV=${leverage}x`);

        const res = await runSignalCheckAndOpen({
          symbol,
          perPositionBudget: perPositionBudget,
          leverage,
          regimeOverride: regime // explicit regime support
        });

        const { positionOpened, marketRegime, signalScore, reason } = res;

        if (positionOpened) {
          openMap[symbol] = true;
          sessionCount++;
          entriesThis++;
          
          log('TRADE', `✅ ${symbol} opened | Regime=${marketRegime} | Score=${signalScore} | Count=${sessionCount}`);
        } else {
          log('SKIP', `${symbol} => ❌ No trade | Reason: ${reason}`);
        }
      }
    }

    await delay(10000); // 10s between cycles
  }
  
  // If we reach here, the session completed normally without profit goal or liquidation
  log('SESSION_END', `Session completed normally after ${MAX_CYCLES} cycles`);
  return { shouldRestart: false, reason: 'max_cycles_reached', pnl: totalPnL };
}

async function runBotWithRestart() {
  let sessionCount = 0;
  let totalRestartCount = 0;
  const MAX_RESTARTS = 100; // Prevent infinite restarts
  
  while (totalRestartCount < MAX_RESTARTS) {
    try {
      sessionCount++;
      log('BOT_START', `Starting session #${sessionCount} (restart #${totalRestartCount})`);
      
      const result = await runSession();
      
      if (result.shouldRestart) {
        totalRestartCount++;
        log('RESTART', `Session ended with reason: ${result.reason} | PnL: $${result.pnl.toFixed(2)} | Restarting in 30 seconds...`);
        
        // Wait 30 seconds before restarting
        await delay(30000);
        
        // Clear any cached data or reset state if needed
        console.log('\n🔄 Preparing for restart...\n');
        
        continue; // Continue to next iteration
      } else {
        log('BOT_END', `Bot completed normally after ${sessionCount} sessions`);
        break; // Exit the restart loop
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log('FATAL', `Fatal error in session #${sessionCount}: ${errorMessage}`);
      
      // Wait 60 seconds before restarting after a fatal error
      log('RESTART', `Restarting after fatal error in 60 seconds...`);
      await delay(60000);
      
      totalRestartCount++;
      continue;
    }
  }
  
  if (totalRestartCount >= MAX_RESTARTS) {
    log('FATAL', `Maximum restart limit (${MAX_RESTARTS}) reached. Stopping bot.`);
    process.exit(1);
  }
}

runBotWithRestart().catch(err => {
  const errorMessage = err instanceof Error ? err.message : String(err);
  log('FATAL', `Critical error: ${errorMessage}`);
  process.exit(1);
});
