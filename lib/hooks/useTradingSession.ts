"use client";

import { useState, useCallback, useEffect } from 'react';
import { useTrading } from './useTrading';
import { usePositions } from './usePositions';
import { useTradingFee } from './useTradingFee';
import { useIntegratedWallet } from '@/lib/wallet/IntegratedWalletContext';
import { calculateLeverageFromBalance, getDefaultLeverage } from '@/lib/utils/leverageCalculator';

export interface TradingSessionState {
  id: string;
  status: 'running' | 'completed' | 'stopped' | 'error';
  startTime: Date;
  endTime?: Date;
  totalPnL: number;
  positions: number;
  cycle: number;
  openPositions: number;
  pnl: number;
  sessionId: string;
  config: {
    profitGoal: number;
    maxBudget: number;
    maxPerSession: number;
    totalBudget?: number;
  };
}

export function useTradingSession() {
  const { startTrading: startTradingAPI, stopTrading: stopTradingAPI, getTradingSession, getTradingSessions } = useTrading();
  const { positionData, fetchPositions } = usePositions();
  const { payTradingFee, isPayingFee } = useTradingFee();
  const { refreshBalances, avantisBalance } = useIntegratedWallet();
  
  const [tradingSession, setTradingSession] = useState<TradingSessionState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh session status from API - also tries to restore session if not in state
  const refreshSessionStatus = useCallback(async (forceRestore: boolean = false) => {
    // If we have a session, refresh it
    if (tradingSession && !forceRestore) {
      try {
        const session = await getTradingSession(tradingSession.id);
        if (session) {
          // Only update if session is actually running
          if (session.status === 'running') {
            setTradingSession(prev => prev ? {
              ...prev,
              sessionId: prev.sessionId || prev.id, // Preserve sessionId
              status: session.status,
              totalPnL: session.totalPnL,
              positions: session.positions?.length || 0,
              pnl: session.totalPnL,
              openPositions: session.positions?.length || 0,
              cycle: (session as any).cycle || prev.cycle || 0,
            } : null);
          } else if (session.status === 'error' || session.status === 'completed' || session.status === 'stopped') {
            // Only clear if session is definitively ended (not just temporarily unavailable)
            setTradingSession(null);
          }
          // If status is 'not_found' or other transient states, keep existing session to prevent flickering
        } else {
          // Session not found - but don't clear immediately (might be transient)
          // Don't clear - keep existing session to prevent flickering
        }
      } catch (err) {
        // Failed to refresh session status (non-critical)
        // Don't clear session on error - keep existing state to prevent flickering
        // Only log the error, don't update state
      }
    } else if (forceRestore) {
      // Only restore if explicitly requested (forceRestore = true)
      // Check for active sessions with status === 'running' ONLY
      try {
        // Try to get all sessions and find the active one
        const sessions = await getTradingSessions();
        const activeSession = sessions.find(s => s.status === 'running');
        
        // Only restore if we find a session with status === 'running'
        if (activeSession && activeSession.status === 'running') {
          const sessionState: TradingSessionState = {
            id: activeSession.id,
            sessionId: activeSession.id, // Ensure sessionId is set
            status: activeSession.status,
            startTime: activeSession.startTime,
            totalPnL: activeSession.totalPnL || positionData?.totalPnL || 0,
            positions: (activeSession.positions && Array.isArray(activeSession.positions) ? activeSession.positions.length : activeSession.positions) || positionData?.openPositions || 0,
            cycle: 0,
            openPositions: positionData?.openPositions || 0,
            pnl: activeSession.totalPnL || positionData?.totalPnL || 0,
            config: activeSession.config ? {
              profitGoal: activeSession.config.profitGoal || 0,
              maxBudget: (activeSession.config as any).maxBudget || (activeSession.config as any).totalBudget || 0,
              maxPerSession: (activeSession.config as any).maxPerSession || (activeSession.config as any).maxPositions || 0,
              totalBudget: (activeSession.config as any).totalBudget || (activeSession.config as any).maxBudget || 0,
            } : {
              profitGoal: 0,
              maxBudget: 0,
              maxPerSession: 0,
            }
          };
          setTradingSession(sessionState);
        } else {
          // No active session found - clear any stale session state
          if (tradingSession) {
            setTradingSession(null);
          }
        }
      } catch (err) {
        // Failed to restore session
        // On error, clear session to avoid showing stale data
        if (tradingSession) {
          setTradingSession(null);
        }
      }
    }
  }, [tradingSession, getTradingSession, getTradingSessions, positionData]);

  // Clear current session
  const clearSession = useCallback(() => {
    setTradingSession(null);
    setError(null);
  }, []);

  // Start trading with session management - with progress callbacks
  const startTrading = useCallback(async (config: {
    maxBudget?: number;
    investmentAmount?: number;
    profitGoal?: number;
    targetProfit?: number;
    maxPerSession?: number;
    leverage?: number;
    lossThreshold?: number;
  }, onProgress?: (step: string, message: string) => void) => {
    setIsLoading(true);
    setError(null);

    try {
      // Get the trading amount for fee calculation
      const tradingAmount = config.maxBudget || config.investmentAmount || 50;
      
      // Step 1: Pay 1% trading fee to platform (1% of trading amount)
      onProgress?.('fee', `Paying 1% trading fee ($${(tradingAmount * 0.01).toFixed(2)})...`);
      console.log(`[useTradingSession] Paying trading fee: 1% of $${tradingAmount} = $${(tradingAmount * 0.01).toFixed(2)}`);
      const feeResult = await payTradingFee(tradingAmount);
      
      if (!feeResult.success) {
        throw new Error(feeResult.error || 'Failed to pay trading fee');
      }
      
      onProgress?.('fee', `✅ Fee paid: ${feeResult.amount} ${feeResult.currency}`);
      console.log(`[useTradingSession] Fee paid successfully: ${feeResult.amount} ${feeResult.currency} (tx: ${feeResult.transactionHash})`);

      // Step 2: Refresh balances after fee payment (non-blocking)
      onProgress?.('balance', 'Updating balances...');
      refreshBalances(true).then(() => {
        console.log('[useTradingSession] Balances refreshed after fee payment');
        onProgress?.('balance', '✅ Balances updated');
      }).catch((refreshError) => {
        console.warn('[useTradingSession] Failed to refresh balances after fee payment:', refreshError);
        // Don't fail the trading start if balance refresh fails
      });

      // Step 3: Calculate leverage based on balance if not specified
      const budget = config.maxBudget || config.investmentAmount || 50;
      const calculatedLeverage = config.leverage 
        ? config.leverage 
        : calculateLeverageFromBalance(budget, config.leverage);
      
      // Step 4: Start trading session (this should return quickly)
      onProgress?.('session', 'Starting trading session...');
      
      try {
        const session = await startTradingAPI({
          totalBudget: budget,
          profitGoal: config.profitGoal || config.targetProfit || 10,
          maxPositions: config.maxPerSession || 1,
          leverage: calculatedLeverage, // Balance-based: $10-20=2x-3x, $20+=5x default
          lossThreshold: config.lossThreshold || 10
        });
        
        onProgress?.('session', `✅ Session started: ${session.id.slice(0, 8)}...`);

        // Create session state
        const sessionState: TradingSessionState = {
          id: session.id,
          sessionId: session.id,
          status: session.status,
          startTime: session.startTime,
          totalPnL: session.totalPnL,
          positions: session.positions || 0,
          cycle: 0,
          openPositions: 0,
          pnl: session.totalPnL,
          config: {
            profitGoal: config.profitGoal || config.targetProfit || 10,
            maxBudget: config.maxBudget || config.investmentAmount || 50,
            maxPerSession: config.maxPerSession || 1,
            totalBudget: config.maxBudget || config.investmentAmount || 50,
          }
        };

        setTradingSession(sessionState);
        onProgress?.('complete', '✅ Trading session ready!');
        return session.id;
      } catch (sessionError) {
        throw sessionError;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start trading';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [startTradingAPI, payTradingFee, refreshBalances]);

  // Stop trading
  const stopTrading = useCallback(async (sessionId: string, closeAll?: boolean) => {
    if (!tradingSession) return false;

    try {
      await stopTradingAPI(sessionId);
      
      setTradingSession(prev => prev ? {
        ...prev,
        status: 'stopped',
        endTime: new Date()
      } : null);
      
      return true;
    } catch (err) {
      return false;
    }
  }, [tradingSession, stopTradingAPI]);

  // Update session with position data
  useEffect(() => {
    if (tradingSession && positionData) {
      setTradingSession(prev => prev ? {
        ...prev,
        sessionId: prev.sessionId || prev.id, // Preserve sessionId when updating
        totalPnL: positionData.totalPnL || 0,
        pnl: positionData.totalPnL || 0,
        openPositions: positionData.openPositions || 0,
        positions: positionData.openPositions || 0,
        cycle: (prev.cycle || 0) + 1
      } : null);
    }
  }, [positionData]); // Removed tradingSession from dependencies to prevent infinite loop

      // Auto-refresh session status periodically
      useEffect(() => {
        if (!tradingSession || tradingSession.status !== 'running') return;

        const interval = setInterval(() => {
          refreshSessionStatus().catch(err => {
            // Silently handle errors - don't log to prevent console spam
            // Session state will be preserved to prevent flickering
          });
        }, 15000); // Refresh every 15 seconds (less frequent to reduce flickering)

        return () => clearInterval(interval);
      }, [tradingSession?.id, tradingSession?.status]); // Depend on id and status to prevent unnecessary re-runs

  return {
    tradingSession,
    isLoading: isLoading || isPayingFee,
    error,
    startTrading,
    stopTrading,
    refreshSessionStatus,
    clearSession,
  };
}
