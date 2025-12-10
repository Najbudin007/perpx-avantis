import WebSocket from 'ws';
// Import the real trading bot
import { WebTradingBot } from './hyperliquid/web-trading-bot';

export interface TradingConfig {
  maxBudget: number;
  profitGoal: number;
  maxPerSession: number;
  lossThreshold?: number; // Loss threshold percentage (default 10%)
  userPhoneNumber?: string;
  walletAddress?: string;
  userFid?: number; // User FID for identification
  privateKey?: string; // Private key for trading wallet (stored per-session, not globally)
}

export interface SessionStatus {
  sessionId: string;
  status: 'running' | 'stopped' | 'completed' | 'error';
  pnl: number;
  openPositions: number;
  cycle: number;
  lastUpdate: Date;
  config: TradingConfig;
  error?: string;
}

export class TradingSessionManager {
  private tradingBot: InstanceType<typeof WebTradingBot>;
  private sessions: Map<string, {
    config: TradingConfig;
    status: SessionStatus;
    subscribers: Set<WebSocket>;
    walletAddress?: string; // Store wallet address for queries
  }> = new Map();

  constructor() {
    this.tradingBot = new WebTradingBot();
  }

  async startSession(config: TradingConfig): Promise<string> {
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
        status: 'running' as 'running' | 'stopped' | 'completed' | 'error',
        pnl: 0,
        openPositions: 0,
        cycle: 0,
        lastUpdate: new Date(),
        config,
        error: undefined
      } as SessionStatus,
      subscribers: new Set<WebSocket>(),
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
    this.tradingBot.startTrading(botConfig).catch((error: unknown) => {
      console.error(`[SESSION_MANAGER] Error starting bot for session ${sessionId}:`, error);
      // Update session status to error
      const errorStatus: SessionStatus = {
        ...session.status,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      session.status = errorStatus;
    });

    // Return sessionId immediately (bot initializes in background)
    return sessionId;
  }

  private startSessionMonitoring(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

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


  private updateSessionStatus(sessionId: string, updates: Partial<SessionStatus>) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = { ...session.status, ...updates };
    this.broadcastUpdate(sessionId);
  }

  private broadcastUpdate(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const update = {
      type: 'trading_update',
      data: this.sanitizeSessionStatus(session.status)
    };

    // Security: Remove debug logging in production

    session.subscribers.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(update));
        } catch (error) {
          // Security: Remove error logging in production
          session.subscribers.delete(ws);
        }
      } else {
        session.subscribers.delete(ws);
      }
    });
  }

  subscribeToUpdates(sessionId: string, ws: WebSocket) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.subscribers.add(ws);
      console.log(`[SESSION_MANAGER] Client subscribed to session ${sessionId}`);
      
      // Send current status immediately (sanitized - no private key)
      const update = {
        type: 'trading_update',
        data: this.sanitizeSessionStatus(session.status)
      };
      
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(update));
      }
    } else {
      console.warn(`[SESSION_MANAGER] Attempted to subscribe to non-existent session ${sessionId}`);
    }
  }

  unsubscribeFromUpdates(sessionId: string, ws: WebSocket) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.subscribers.delete(ws);
      console.log(`[SESSION_MANAGER] Client unsubscribed from session ${sessionId}`);
    }
  }

  /**
   * Get wallet address for a session
   */
  getSessionWalletAddress(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    return session?.walletAddress || session?.config.walletAddress;
  }

  private sanitizeSessionStatus(status: SessionStatus): Omit<SessionStatus, 'config'> & { config: Omit<TradingConfig, 'privateKey'> } {
    // Remove privateKey from config before returning
    const { privateKey, ...sanitizedConfig } = status.config;
    return {
      ...status,
      config: sanitizedConfig
    };
  }

  getSessionStatus(sessionId: string): (Omit<SessionStatus, 'config'> & { config: Omit<TradingConfig, 'privateKey'> }) | null {
    const session = this.sessions.get(sessionId);
    return session ? this.sanitizeSessionStatus(session.status) : null;
  }

  getAllSessions(): (Omit<SessionStatus, 'config'> & { config: Omit<TradingConfig, 'privateKey'> })[] {
    return Array.from(this.sessions.values()).map(session => this.sanitizeSessionStatus(session.status));
  }

  stopSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      console.log(`[SESSION_MANAGER] Stopping session ${sessionId}`);
      
      // Clear monitoring interval if it exists
      if ((session as any).monitorInterval) {
        clearInterval((session as any).monitorInterval);
      }
      
      // Stop trading bot
      this.tradingBot.stopTrading();
      
      this.updateSessionStatus(sessionId, { status: 'stopped', lastUpdate: new Date() });
      return true;
    }
    return false;
  }

  forceStopSession(sessionId: string): boolean {
    return this.stopSession(sessionId);
  }

  cleanup() {
    console.log('[SESSION_MANAGER] Cleaning up all sessions');
    this.tradingBot.stopTrading();
    this.sessions.clear();
  }
}
