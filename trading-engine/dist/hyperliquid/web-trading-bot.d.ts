export interface TradingConfig {
    maxBudget: number;
    profitGoal: number;
    maxPerSession: number;
    sessionId: string;
    privateKey?: string;
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
export declare class WebTradingBot {
    private isRunning;
    private shouldStop;
    private sessionId;
    private config;
    private pnl;
    private openPositions;
    private cycle;
    /**
     * Start trading session - Opens ONE position, then monitors until close
     * This is the ONLY entry point for opening positions
     */
    startTrading(config: TradingConfig): Promise<void>;
    /**
     * Execute ONE trade (if allowed), then monitor until close
     * NO LOOPS, NO SCANNING, NO AUTONOMOUS BEHAVIOR
     */
    private executeTradeAndMonitor;
    /**
     * Monitor existing positions until they close
     * NO OPENING NEW POSITIONS - ONLY MONITORING
     *
     * CRITICAL: Do NOT return to IDLE when position fetch fails/times out!
     * Only return to IDLE when we have CONFIRMED that positions are closed.
     */
    private monitorPositionsUntilClose;
    /**
     * Stop the trading bot
     */
    stopTrading(): Promise<void>;
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
    };
}
//# sourceMappingURL=web-trading-bot.d.ts.map