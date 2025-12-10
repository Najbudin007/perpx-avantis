"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradingSessionManager = void 0;
const ws_1 = __importDefault(require("ws"));
// Import the real trading bot
const web_trading_bot_1 = require("./hyperliquid/web-trading-bot");
class TradingSessionManager {
    constructor() {
        this.sessions = new Map();
        this.tradingBot = new web_trading_bot_1.WebTradingBot();
    }
    async startSession(config) {
        const sessionId = `session_${Date.now()}`;
        // Create config with sessionId and private key
        const botConfig = {
            ...config,
            sessionId,
            privateKey: config.privateKey // Pass private key to bot for Avantis trading
        };
        // Create session record immediately (before bot initialization)
        const session = {
            config,
            status: {
                sessionId,
                status: 'running',
                pnl: 0,
                openPositions: 0,
                cycle: 0,
                lastUpdate: new Date(),
                config,
                error: undefined
            },
            subscribers: new Set(),
            walletAddress: config.walletAddress, // Store wallet address for queries
        };
        this.sessions.set(sessionId, session);
        console.log(`[SESSION_MANAGER] Starting session ${sessionId} with config:`, {
            ...config,
            privateKey: config.privateKey ? `${config.privateKey.slice(0, 10)}...${config.privateKey.slice(-4)}` : 'MISSING'
        });
        console.log(`[SESSION_MANAGER] Trading session ${sessionId} with wallet ${config.walletAddress}`);
        console.log(`[SESSION_MANAGER] Private key check:`, {
            hasPrivateKey: !!config.privateKey,
            privateKeyLength: config.privateKey?.length || 0,
            botConfigHasPrivateKey: !!botConfig.privateKey
        });
        // Start monitoring the session immediately
        this.startSessionMonitoring(sessionId);
        // Start the trading bot asynchronously (don't await - return sessionId immediately)
        // This allows the API to respond faster while bot initializes in background
        this.tradingBot.startTrading(botConfig).catch((error) => {
            console.error(`[SESSION_MANAGER] Error starting bot for session ${sessionId}:`, error);
            // Update session status to error
            const errorStatus = {
                ...session.status,
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error'
            };
            session.status = errorStatus;
        });
        // Return sessionId immediately (bot initializes in background)
        return sessionId;
    }
    startSessionMonitoring(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        // Monitor bot status for trading wallet sessions
        const monitorInterval = setInterval(() => {
            const botStatus = this.tradingBot.getStatus();
            const session = this.sessions.get(sessionId);
            if (!botStatus || !session) {
                clearInterval(monitorInterval);
                return;
            }
            // Update session status from bot
            session.status = {
                ...session.status,
                pnl: botStatus.pnl || 0,
                openPositions: botStatus.openPositions || 0,
                cycle: botStatus.cycle || 0,
                status: botStatus.isRunning ? 'running' : 'stopped',
                lastUpdate: new Date()
            };
            this.broadcastUpdate(sessionId);
            // Clean up if session is completed or stopped
            if (!botStatus.isRunning) {
                clearInterval(monitorInterval);
                setTimeout(() => {
                    this.sessions.delete(sessionId);
                }, 30000);
            }
        }, 5000); // Check every 5 seconds (reduced from 1 second for performance)
    }
    updateSessionStatus(sessionId, updates) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        session.status = { ...session.status, ...updates };
        this.broadcastUpdate(sessionId);
    }
    broadcastUpdate(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        const update = {
            type: 'trading_update',
            data: this.sanitizeSessionStatus(session.status)
        };
        // Security: Remove debug logging in production
        session.subscribers.forEach(ws => {
            if (ws.readyState === ws_1.default.OPEN) {
                try {
                    ws.send(JSON.stringify(update));
                }
                catch (error) {
                    // Security: Remove error logging in production
                    session.subscribers.delete(ws);
                }
            }
            else {
                session.subscribers.delete(ws);
            }
        });
    }
    subscribeToUpdates(sessionId, ws) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.subscribers.add(ws);
            console.log(`[SESSION_MANAGER] Client subscribed to session ${sessionId}`);
            // Send current status immediately (sanitized - no private key)
            const update = {
                type: 'trading_update',
                data: this.sanitizeSessionStatus(session.status)
            };
            if (ws.readyState === ws_1.default.OPEN) {
                ws.send(JSON.stringify(update));
            }
        }
        else {
            console.warn(`[SESSION_MANAGER] Attempted to subscribe to non-existent session ${sessionId}`);
        }
    }
    unsubscribeFromUpdates(sessionId, ws) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.subscribers.delete(ws);
            console.log(`[SESSION_MANAGER] Client unsubscribed from session ${sessionId}`);
        }
    }
    /**
     * Get wallet address for a session
     */
    getSessionWalletAddress(sessionId) {
        const session = this.sessions.get(sessionId);
        return session?.walletAddress || session?.config.walletAddress;
    }
    sanitizeSessionStatus(status) {
        // Remove privateKey from config before returning
        const { privateKey, ...sanitizedConfig } = status.config;
        return {
            ...status,
            config: sanitizedConfig
        };
    }
    getSessionStatus(sessionId) {
        const session = this.sessions.get(sessionId);
        return session ? this.sanitizeSessionStatus(session.status) : null;
    }
    getAllSessions() {
        return Array.from(this.sessions.values()).map(session => this.sanitizeSessionStatus(session.status));
    }
    stopSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            console.log(`[SESSION_MANAGER] Stopping session ${sessionId}`);
            // Clear monitoring interval if it exists
            if (session.monitorInterval) {
                clearInterval(session.monitorInterval);
            }
            // Stop trading bot
            this.tradingBot.stopTrading();
            this.updateSessionStatus(sessionId, { status: 'stopped', lastUpdate: new Date() });
            return true;
        }
        return false;
    }
    forceStopSession(sessionId) {
        return this.stopSession(sessionId);
    }
    cleanup() {
        console.log('[SESSION_MANAGER] Cleaning up all sessions');
        this.tradingBot.stopTrading();
        this.sessions.clear();
    }
}
exports.TradingSessionManager = TradingSessionManager;
//# sourceMappingURL=session-manager.js.map