"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTrading } from './useTrading';
import { usePositions } from './usePositions';
import { useTradingFee } from './useTradingFee';
import { useIntegratedWallet } from '@/lib/wallet/IntegratedWalletContext';
import { useAuth } from '@/lib/auth/AuthContext';
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
  const { refreshBalances, avantisBalance, primaryWallet, tradingWallet, tradingWalletAddress, baseAccountAddress } = useIntegratedWallet();
  const { token } = useAuth();
  
  const [tradingSession, setTradingSession] = useState<TradingSessionState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feePaidTime, setFeePaidTime] = useState<Date | null>(null);
  const [positionWarning, setPositionWarning] = useState<string | null>(null);
  const [feePending, setFeePending] = useState<{ amount: number; paid: boolean } | null>(null);

  // Use refs to prevent infinite loops
  const tradingSessionRef = useRef(tradingSession);
  const positionDataRef = useRef(positionData);
  
  // Update refs when values change
  useEffect(() => {
    tradingSessionRef.current = tradingSession;
  }, [tradingSession]);
  
  useEffect(() => {
    positionDataRef.current = positionData;
  }, [positionData]);
  
  // Refresh session status from API - also tries to restore session if not in state
  const refreshSessionStatus = useCallback(async (forceRestore: boolean = false) => {
    const currentSession = tradingSessionRef.current;
    const currentPositionData = positionDataRef.current;
    
    // If we have a session, refresh it
    if (currentSession && !forceRestore) {
      try {
        const session = await getTradingSession(currentSession.id);
        if (session) {
          // Only update if session is actually running
          if (session.status === 'running') {
            setTradingSession(prev => {
              if (!prev) return null;
              // Only update if something actually changed to prevent loops
              if (prev.status === session.status && 
                  prev.totalPnL === session.totalPnL &&
                  prev.openPositions === (session.positions?.length || 0)) {
                return prev; // No change, return same object
              }
              return {
                ...prev,
                sessionId: prev.sessionId || prev.id, // Preserve sessionId
                status: session.status,
                totalPnL: session.totalPnL,
                positions: session.positions?.length || 0,
                pnl: session.totalPnL,
                openPositions: session.positions?.length || 0,
                cycle: (session as any).cycle || prev.cycle || 0,
              };
            });
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
            totalPnL: activeSession.totalPnL || currentPositionData?.totalPnL || 0,
            positions: (activeSession.positions && Array.isArray(activeSession.positions) ? activeSession.positions.length : activeSession.positions) || currentPositionData?.openPositions || 0,
            cycle: 0,
            openPositions: currentPositionData?.openPositions || 0,
            pnl: activeSession.totalPnL || currentPositionData?.totalPnL || 0,
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
          if (currentSession) {
            setTradingSession(null);
          }
        }
      } catch (err) {
        // Failed to restore session
        // On error, clear session to avoid showing stale data
        if (currentSession) {
          setTradingSession(null);
        }
      }
    }
  }, [getTradingSession, getTradingSessions]); // Removed tradingSession and positionData from deps, using refs instead

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
    walletAddress?: string;
    avantisApiWallet?: string;
    hyperliquidApiWallet?: string;
  }, onProgress?: (step: string, message: string) => void) => {
    setIsLoading(true);
    setError(null);

    try {
      // Get the trading amount for fee calculation (will be paid when StartTrading is clicked)
      const tradingAmount = config.maxBudget || config.investmentAmount || 50;
      
      // Step 1: Pay commission fee BEFORE starting trading session (silently, no toast)
      console.log(`[useTradingSession] Paying commission fee: 1% of $${tradingAmount} = $${(tradingAmount * 0.01).toFixed(2)}`);
      
      try {
        const feeResult = await payTradingFee(tradingAmount);
        if (feeResult.success) {
          console.log(`[useTradingSession] ✅ Commission fee paid successfully: ${feeResult.amount} ${feeResult.currency} (tx: ${feeResult.transactionHash})`);
          setFeePaidTime(new Date());
          setFeePending(null); // Clear pending fee since it's already paid
          // No toast message - fee payment is silent
        } else {
          throw new Error(feeResult.error || 'Failed to pay commission fee');
        }
      } catch (feeError) {
        console.error(`[useTradingSession] ❌ Failed to pay commission fee:`, feeError);
        throw new Error(`Failed to pay commission fee: ${feeError instanceof Error ? feeError.message : 'Unknown error'}`);
      }

      // Step 2: Calculate leverage based on balance if not specified
      const budget = config.maxBudget || config.investmentAmount || 50;
      const calculatedLeverage = config.leverage 
        ? config.leverage 
        : calculateLeverageFromBalance(budget, config.leverage);
      
      // Step 3: Get trading wallet with private key from API
      onProgress?.('session', 'Retrieving wallet credentials...');
      let walletWithKey: any = null;
      
      try {
        const { ClientWalletService } = await import('@/lib/services/ClientWalletService');
        const getToken = () => {
          if (token) return token;
          if (typeof window !== 'undefined') {
            return (
              localStorage.getItem('web_auth_token') ||
              localStorage.getItem('base_auth_token') ||
              ''
            );
          }
          return '';
        };
        const clientWalletService = new ClientWalletService(getToken);
        walletWithKey = await clientWalletService.getPrimaryTradingWalletWithKey();
        
        if (walletWithKey?.privateKey) {
          console.log(`[useTradingSession] ✅ Retrieved wallet with private key: ${walletWithKey.address}`);
        } else {
          console.warn(`[useTradingSession] ⚠️ No wallet with private key found, attempting to create one...`);
          
          // Try to create a wallet if it doesn't exist
          try {
            const createResult = await clientWalletService.createWallet({ chain: 'ethereum' });
            if (createResult.success && createResult.wallet) {
              // Now retrieve the wallet with key
              walletWithKey = await clientWalletService.getPrimaryTradingWalletWithKey();
              if (walletWithKey?.privateKey) {
                console.log(`[useTradingSession] ✅ Created and retrieved new wallet: ${walletWithKey.address}`);
              }
            } else {
              throw new Error(createResult.error || 'Failed to create wallet');
            }
          } catch (createError) {
            console.error(`[useTradingSession] ❌ Failed to create wallet:`, createError);
            throw new Error('Trading wallet not found and could not be created. Please ensure you have a wallet set up.');
          }
        }
      } catch (walletError) {
        console.error(`[useTradingSession] ❌ Failed to retrieve wallet with key:`, walletError);
        throw new Error(`Failed to retrieve wallet credentials: ${walletError instanceof Error ? walletError.message : 'Unknown error'}`);
      }
      
      // Step 4: Start trading session (this should return quickly)
      onProgress?.('session', 'Starting trading session...');
      
      try {
        // Wallet details (prefer explicit config, then wallet with key, then trading wallet, then base account)
        const walletAddress = config.walletAddress || walletWithKey?.address || tradingWallet?.address || tradingWalletAddress || baseAccountAddress || primaryWallet?.address || '';
        const avantisPk = config.avantisApiWallet || walletWithKey?.privateKey || (tradingWallet as any)?.privateKey || (primaryWallet as any)?.privateKey || process.env.NEXT_PUBLIC_AVANTIS_API_WALLET || process.env.NEXT_PUBLIC_AVANTIS_PRIVATE_KEY;
        const hyperliquidPk = config.hyperliquidApiWallet || process.env.NEXT_PUBLIC_HYPERLIQUID_PK;

        // Log wallet details for debugging (without exposing full private key)
        console.log(`[useTradingSession] Starting session with:`, {
          walletAddress,
          hasAvantisKey: !!avantisPk,
          hasHyperliquidKey: !!hyperliquidPk,
          budget,
          leverage: calculatedLeverage
        });

        if (!walletAddress || !avantisPk) {
          const missingItems = [];
          if (!walletAddress) missingItems.push('wallet address');
          if (!avantisPk) missingItems.push('private key');
          
          throw new Error(
            `Cannot start trading: Missing ${missingItems.join(' and ')}. ` +
            `Please ensure you have a trading wallet set up. ` +
            `Try refreshing the page or contact support if the issue persists.`
          );
        }

        const session = await startTradingAPI({
          totalBudget: budget,
          profitGoal: config.profitGoal || config.targetProfit || 10,
          maxPositions: config.maxPerSession || 1,
          leverage: calculatedLeverage, // Balance-based: $10-20=2x-3x, $20+=5x default
          lossThreshold: config.lossThreshold || 10,
          walletAddress,
          avantisApiWallet: avantisPk,
          hyperliquidApiWallet: hyperliquidPk,
        });
        
        console.log(`[useTradingSession] ✅ Session successfully started: ${session.id}`);
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
        
        // Fee already paid, clear any pending state
        setFeePending(null);
        setPositionWarning(null);
        
        // Use setTimeout to prevent crash when showing completion notification
        setTimeout(() => {
          try {
            onProgress?.('complete', '✅ Trading session started successfully!');
          } catch (progressError) {
            console.error('[useTradingSession] Error in complete progress callback:', progressError);
          }
        }, 50);
        
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
  }, [startTradingAPI, payTradingFee, refreshBalances, token]);

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

  // Track previous position count to detect new positions
  const previousPositionCountRef = useRef<number>(0);
  const checkPositionsInProgressRef = useRef<boolean>(false);

  // Update session with position data - FIXED to prevent infinite loop
  useEffect(() => {
    // Only update if we have both session and position data
    if (!tradingSession || !positionData) return;
    
    const previousPositions = previousPositionCountRef.current;
    const currentPositions = positionData.openPositions || 0;
    
    // Only update if position count or PnL actually changed
    const pnlChanged = Math.abs((tradingSession.totalPnL || 0) - (positionData.totalPnL || 0)) > 0.001;
    const positionsChanged = tradingSession.openPositions !== currentPositions;
    
    if (pnlChanged || positionsChanged) {
      setTradingSession(prev => prev ? {
        ...prev,
        sessionId: prev.sessionId || prev.id,
        totalPnL: positionData.totalPnL || 0,
        pnl: positionData.totalPnL || 0,
        openPositions: currentPositions,
        positions: currentPositions,
        // Don't increment cycle on every update to prevent re-renders
      } : null);
    }
    
    // Dispatch event when position count increases (position opened)
    if (currentPositions > previousPositions) {
      console.log(`[useTradingSession] Position opened! Dispatching position-opened event (${previousPositions} -> ${currentPositions})`)
      window.dispatchEvent(new CustomEvent('position-opened', {
        detail: { count: currentPositions, previousCount: previousPositions }
      }))
    }
    
    // Update previous position count
    previousPositionCountRef.current = currentPositions;
    
    // Clear warning if positions opened
    if (currentPositions > 0 && positionWarning) {
      setPositionWarning(null);
    }
  }, [positionData?.openPositions, positionData?.totalPnL]); // Only depend on specific values, not entire objects

      // Auto-refresh session status periodically
      useEffect(() => {
        const currentSession = tradingSessionRef.current;
        if (!currentSession || currentSession.status !== 'running') return;

        const interval = setInterval(() => {
          refreshSessionStatus().catch(err => {
            // Silently handle errors - don't log to prevent console spam
            // Session state will be preserved to prevent flickering
          });
        }, 30000); // Refresh every 30 seconds (reduced to minimize server load)

        return () => clearInterval(interval);
      }, [tradingSession?.id, tradingSession?.status, refreshSessionStatus]); // Include refreshSessionStatus but it's now stable

      // Monitor for positions opening
      useEffect(() => {
        if (!tradingSession || tradingSession.status !== 'running') {
          return;
        }

        const checkPositions = async () => {
          // Use a ref to prevent concurrent calls
          if (checkPositionsInProgressRef.current) return;
          checkPositionsInProgressRef.current = true;
          
          try {
            await fetchPositions(true);
            const elapsedSeconds = Math.floor((Date.now() - (tradingSession.startTime?.getTime() || Date.now())) / 1000);
            
            // Show status messages while waiting for first position
            if (positionData?.openPositions === 0) {
              if (elapsedSeconds >= 120) {
                setPositionWarning('⚠️ Still waiting for position to open after 2 minutes. Bot is scanning markets...');
              } else if (elapsedSeconds >= 60) {
                setPositionWarning('⏳ Waiting for position to open. Bot is analyzing market conditions...');
              } else if (elapsedSeconds >= 30) {
                setPositionWarning('⏳ Bot is scanning markets for entry opportunities...');
              }
            } else if (positionData && positionData.openPositions > 0) {
              setPositionWarning(null);
            }
          } finally {
            checkPositionsInProgressRef.current = false;
          }
        };

        // Check immediately and then every 15 seconds
        checkPositions();
        const interval = setInterval(checkPositions, 15000);

        return () => clearInterval(interval);
      }, [tradingSession?.id, tradingSession?.status, positionData?.openPositions]); // Removed fetchPositions from deps

  return {
    tradingSession,
    isLoading: isLoading || isPayingFee,
    error,
    startTrading,
    stopTrading,
    refreshSessionStatus,
    clearSession,
    feePaidTime,
    positionWarning,
    feePending,
  };
}
