import WebSocket from 'ws';
// Import the real trading bot
import { WebTradingBot } from './hyperliquid/web-trading-bot';

export interface TradingConfig {
  maxBudget: number;
  profitGoal: number;
  maxPerSession: number;
  lossThreshold?: number; // Loss threshold percentage (default 10%)
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

interface SessionData {
  config: TradingConfig;
  status: SessionStatus;
  subscribers: Set<WebSocket>;
  walletAddress?: string;
  bot: WebTradingBot; // Each session has its own bot instance
  monitorInterval?: NodeJS.Timeout;
}

export class TradingSessionManager {
  // Map sessions by sessionId - each user can have multiple sessions
  private sessions: Map<string, SessionData> = new Map();
  // Track sessions by user FID for easy lookup
  private userSessions: Map<number, Set<string>> = new Map();
  // Track sessions by wallet address for easy lookup
  private walletSessions: Map<string, Set<string>> = new Map();

  constructor() {
    // No shared bot - each session gets its own
    console.log('[SESSION_MANAGER] Initialized with multi-user support');
  }

  async startSession(config: TradingConfig): Promise<string> {
    const userFid = config.userFid;
    const walletAddress = config.walletAddress?.toLowerCase();
    
    // Generate unique session ID with user context
    const sessionId = `session_${userFid || 'anon'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // Create a NEW bot instance for this session (not shared)
    const bot = new WebTradingBot();
    
    // Create config with sessionId and private key
    const botConfig = {
      ...config,
      sessionId,
      privateKey: config.privateKey
    };
    
    // Create session record immediately (before bot initialization)
    const session: SessionData = {
      config,
      status: {
        sessionId,
        status: 'running' as const,
        pnl: 0,
        openPositions: 0,
        cycle: 0,
        lastUpdate: new Date(),
        config,
        error: undefined
      },
      subscribers: new Set<WebSocket>(),
      walletAddress: walletAddress,
      bot, // Store the bot instance with the session
    };

    this.sessions.set(sessionId, session);
    
    // Track session by user FID
    if (userFid) {
      if (!this.userSessions.has(userFid)) {
        this.userSessions.set(userFid, new Set());
      }
      this.userSessions.get(userFid)!.add(sessionId);
    }
    
    // Track session by wallet address
    if (walletAddress) {
      if (!this.walletSessions.has(walletAddress)) {
        this.walletSessions.set(walletAddress, new Set());
      }
      this.walletSessions.get(walletAddress)!.add(sessionId);
    }
    
    console.log(`[SESSION_MANAGER] Starting session ${sessionId}`);
    console.log(`[SESSION_MANAGER] User FID: ${userFid}, Wallet: ${walletAddress}`);
    console.log(`[SESSION_MANAGER] Active sessions: ${this.sessions.size}`);
    
    // Start monitoring the session immediately
    this.startSessionMonitoring(sessionId);
    
    // Start the trading bot asynchronously (don't await - return sessionId immediately)
    bot.startTrading(botConfig).catch((error: unknown) => {
      console.error(`[SESSION_MANAGER] Error starting bot for session ${sessionId}:`, error);
      session.status = {
        ...session.status,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    });

    return sessionId;
  }

  /**
   * Get all sessions for a specific user by FID
   */
  getSessionsByUser(userFid: number): SessionStatus[] {
    const sessionIds = this.userSessions.get(userFid);
    if (!sessionIds) return [];
    
    return Array.from(sessionIds)
      .map(id => this.sessions.get(id))
      .filter((s): s is SessionData => !!s)
      .map(s => this.sanitizeSessionStatus(s.status));
  }

  /**
   * Get all sessions for a specific wallet address
   */
  getSessionsByWallet(walletAddress: string): SessionStatus[] {
    const normalizedAddress = walletAddress.toLowerCase();
    const sessionIds = this.walletSessions.get(normalizedAddress);
    if (!sessionIds) return [];
    
    return Array.from(sessionIds)
      .map(id => this.sessions.get(id))
      .filter((s): s is SessionData => !!s)
      .map(s => this.sanitizeSessionStatus(s.status));
  }

  /**
   * Stop all sessions for a specific user
   */
  stopAllUserSessions(userFid: number): number {
    const sessionIds = this.userSessions.get(userFid);
    if (!sessionIds) return 0;
    
    let stoppedCount = 0;
    sessionIds.forEach(sessionId => {
      if (this.stopSession(sessionId)) {
        stoppedCount++;
      }
    });
    
    return stoppedCount;
  }

  private startSessionMonitoring(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Monitor the session's bot status
    const monitorInterval = setInterval(() => {
      const currentSession = this.sessions.get(sessionId);
      if (!currentSession) {
        clearInterval(monitorInterval);
        return;
      }

      const botStatus = currentSession.bot.getStatus();
      if (!botStatus) {
        clearInterval(monitorInterval);
        return;
      }

      // Update session status from its own bot
      currentSession.status = {
        ...currentSession.status,
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
        this.cleanupSession(sessionId, 30000); // Cleanup after 30 seconds
      }
    }, 5000);
    
    // Store interval reference for cleanup
    session.monitorInterval = monitorInterval;
  }

  /**
   * Clean up a session after delay
   */
  private cleanupSession(sessionId: string, delay: number = 0) {
    setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (session) {
        // Clear monitor interval
        if (session.monitorInterval) {
          clearInterval(session.monitorInterval);
        }
        
        // Remove from user sessions tracking
        if (session.config.userFid) {
          const userSessions = this.userSessions.get(session.config.userFid);
          if (userSessions) {
            userSessions.delete(sessionId);
            if (userSessions.size === 0) {
              this.userSessions.delete(session.config.userFid);
            }
          }
        }
        
        // Remove from wallet sessions tracking
        if (session.walletAddress) {
          const walletSessions = this.walletSessions.get(session.walletAddress);
          if (walletSessions) {
            walletSessions.delete(sessionId);
            if (walletSessions.size === 0) {
              this.walletSessions.delete(session.walletAddress);
            }
          }
        }
        
        // Remove session
        this.sessions.delete(sessionId);
        console.log(`[SESSION_MANAGER] Cleaned up session ${sessionId}. Active sessions: ${this.sessions.size}`);
      }
    }, delay);
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
      if (session.monitorInterval) {
        clearInterval(session.monitorInterval);
      }
      
      // Stop this session's specific bot (not affecting other users)
      session.bot.stopTrading();
      
      this.updateSessionStatus(sessionId, { status: 'stopped', lastUpdate: new Date() });
      
      // Schedule cleanup
      this.cleanupSession(sessionId, 30000);
      
      return true;
    }
    return false;
  }

  forceStopSession(sessionId: string): boolean {
    return this.stopSession(sessionId);
  }

  /**
   * Get count of active sessions
   */
  getActiveSessionCount(): number {
    let count = 0;
    this.sessions.forEach(session => {
      if (session.status.status === 'running') {
        count++;
      }
    });
    return count;
  }

  /**
   * Check if a user has any running sessions
   */
  hasRunningSession(userFid: number): boolean {
    const sessionIds = this.userSessions.get(userFid);
    if (!sessionIds) return false;
    
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (session && session.status.status === 'running') {
        return true;
      }
    }
    return false;
  }

  cleanup() {
    console.log('[SESSION_MANAGER] Cleaning up all sessions');
    
    // Stop all individual bots
    this.sessions.forEach((session, sessionId) => {
      if (session.monitorInterval) {
        clearInterval(session.monitorInterval);
      }
      session.bot.stopTrading();
    });
    
    this.sessions.clear();
    this.userSessions.clear();
    this.walletSessions.clear();
    
    console.log('[SESSION_MANAGER] All sessions cleaned up');
  }
}
