import WebSocket from 'ws';
export interface TradingConfig {
    maxBudget: number;
    profitGoal: number;
    maxPerSession: number;
    lossThreshold?: number;
    walletAddress?: string;
    userFid?: number;
    privateKey?: string;
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
export declare class TradingSessionManager {
    private sessions;
    private userSessions;
    private walletSessions;
    constructor();
    startSession(config: TradingConfig): Promise<string>;
    /**
     * Get all sessions for a specific user by FID
     */
    getSessionsByUser(userFid: number): SessionStatus[];
    /**
     * Get all sessions for a specific wallet address
     */
    getSessionsByWallet(walletAddress: string): SessionStatus[];
    /**
     * Stop all sessions for a specific user
     */
    stopAllUserSessions(userFid: number): number;
    private startSessionMonitoring;
    /**
     * Clean up a session after delay
     */
    private cleanupSession;
    private updateSessionStatus;
    private broadcastUpdate;
    subscribeToUpdates(sessionId: string, ws: WebSocket): void;
    unsubscribeFromUpdates(sessionId: string, ws: WebSocket): void;
    /**
     * Get wallet address for a session
     */
    getSessionWalletAddress(sessionId: string): string | undefined;
    private sanitizeSessionStatus;
    getSessionStatus(sessionId: string): (Omit<SessionStatus, 'config'> & {
        config: Omit<TradingConfig, 'privateKey'>;
    }) | null;
    getAllSessions(): (Omit<SessionStatus, 'config'> & {
        config: Omit<TradingConfig, 'privateKey'>;
    })[];
    stopSession(sessionId: string): boolean;
    forceStopSession(sessionId: string): boolean;
    /**
     * Get count of active sessions
     */
    getActiveSessionCount(): number;
    /**
     * Check if a user has any running sessions
     */
    hasRunningSession(userFid: number): boolean;
    cleanup(): void;
}
//# sourceMappingURL=session-manager.d.ts.map