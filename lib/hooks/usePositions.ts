"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { getStorageItem } from '../utils/safeStorage';
import { useIntegratedWallet } from '@/lib/wallet/IntegratedWalletContext';

export interface Position {
  coin: string;
  symbol?: string; // Symbol name (e.g., "BTC")
  pair_index?: number; // Avantis pair index (required for closing positions)
  index?: number; // Trade index (required for closing positions when multiple positions exist on same pair)
  size: string;
  side: 'long' | 'short';
  entryPrice: number;
  markPrice: number;
  pnl: number;
  roe: number;
  positionValue: number;
  margin: string;
  leverage: string;
  liquidationPrice?: number | null; // Liquidation price from Avantis
  collateral?: number; // Collateral amount
  takeProfit?: number | null; // Take profit price
  stopLoss?: number | null; // Stop loss price
}

export interface PositionData {
  positions: Position[];
  totalPnL: number;
  openPositions: number;
  error?: string; // Optional error message from API
}

export function usePositions() {
  const { token } = useAuth();
  const { avantisBalance } = useIntegratedWallet();
  const [positionData, setPositionData] = useState<PositionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchInProgressRef = useRef(false);
  const retryCountRef = useRef(0);
  const maxRetries = 3;
  const hasActiveSessionRef = useRef(false);
  
  // Check if there's an active trading session by calling the API
  // This avoids circular dependency with useTradingSession
  const checkActiveSession = useCallback(async (): Promise<boolean> => {
    if (!token) return false;
    
    try {
      const response = await fetch('/api/trading/sessions', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) return false;
      
      const data = await response.json();
      const activeSession = data.sessions?.find((s: any) => s.status === 'running');
      hasActiveSessionRef.current = !!activeSession;
      return !!activeSession;
    } catch (err) {
      return hasActiveSessionRef.current; // Return cached value on error
    }
  }, [token]);
  
  // Check if positions should be fetched
  // ALWAYS fetch positions when user is authenticated - positions may exist from manual trading
  // on Avantis dashboard or from previous sessions
  const shouldFetchPositions = useCallback(async (): Promise<boolean> => {
    if (!token) return false;
    
    // Always allow fetching positions when authenticated
    // Positions may exist even without an active session (from manual trading or previous sessions)
    return true;
  }, [token]); // Only depend on token

  // Define fetchPositions first (before forceRefreshPositions to avoid hoisting issue)
  const fetchPositions = useCallback(async (force = false) => {
    // Authentication is required
    if (!token) {
      setPositionData({ positions: [], totalPnL: 0, openPositions: 0 });
      return;
    }

    // Prevent concurrent fetches (but allow forced fetches)
    if (fetchInProgressRef.current && !force) {
      return;
    }

    fetchInProgressRef.current = true;
    // Only set loading state for initial load, never for background refreshes
    if (!positionData) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const controller = new AbortController();
      // Increase timeout to 70 seconds to match backend timeout chain:
      // - Avantis service: 30s
      // - Trading engine: 45s (calls avantis-service)
      // - Next.js API: 60s (calls trading-engine)
      // Total: ~30-40s + overhead, so 70s gives comfortable margin
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 70000);

      const response = await fetch('/api/positions', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('[usePositions] API error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      
      // Log position data for debugging
      const previousPositionCount = positionData?.openPositions || 0
      const currentPositionCount = data.openPositions || 0
      
      console.log('[usePositions] Fetched position data:', {
        positionsCount: data.positions?.length || 0,
        openPositions: currentPositionCount,
        previousOpenPositions: previousPositionCount,
        totalPnL: data.totalPnL || 0,
        hasError: !!data.error,
        error: data.error
      });
      
      // Validate position data structure
      if (data.positions && Array.isArray(data.positions)) {
        console.log('[usePositions] Position details:', data.positions.map((p: any) => ({
          symbol: p.symbol || p.coin,
          pair_index: p.pair_index,
          side: p.side,
          entryPrice: p.entryPrice,
          pnl: p.pnl
        })));
      }
      
      // Dispatch event if position count changed (for other components to react)
      if (currentPositionCount !== previousPositionCount) {
        if (currentPositionCount > previousPositionCount) {
          console.log('[usePositions] Position opened! Dispatching position-opened event')
          window.dispatchEvent(new CustomEvent('position-opened', { 
            detail: { count: currentPositionCount, previousCount: previousPositionCount }
          }))
        } else if (currentPositionCount < previousPositionCount) {
          console.log('[usePositions] Position closed! Dispatching position-closed event')
          window.dispatchEvent(new CustomEvent('position-closed', { 
            detail: { count: currentPositionCount, previousCount: previousPositionCount }
          }))
        }
      }
      
      setPositionData(data);
      retryCountRef.current = 0;
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch positions';
      
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Request timeout - please check your connection');
      } else {
        if (retryCountRef.current < maxRetries && errorMessage.includes('fetch')) {
          retryCountRef.current++;
          setTimeout(() => fetchPositions(true), 2000 * retryCountRef.current);
        } else {
          setError(errorMessage);
        }
      }
    } finally {
      setIsLoading(false);
      fetchInProgressRef.current = false;
    }
  }, [token]); // Only depend on token - positionData is used for comparison but shouldn't trigger re-creation

  // Force refresh positions (defined after fetchPositions to avoid hoisting issue)
  const forceRefreshPositions = useCallback(async () => {
    console.log('[usePositions] Force refreshing positions...')
    await fetchPositions(true)
  }, [fetchPositions])

  const closePositionInProgressRef = useRef<Set<string>>(new Set());
  const closeAllInProgressRef = useRef(false);

  const closePosition = useCallback(async (positionIdentifier: string | number): Promise<boolean> => {
    // TEMPORARY: Skip authentication for testing
    // if (!token) return false;
    
    // Prevent duplicate close requests
    const identifier = String(positionIdentifier);
    if (closePositionInProgressRef.current.has(identifier)) {
      return false;
    }
    
    closePositionInProgressRef.current.add(identifier);
    
    try {
      // Find the position to get pair_index
      const position = positionData?.positions.find(p => 
        p.coin === positionIdentifier || 
        p.symbol === positionIdentifier ||
        p.pair_index === positionIdentifier
      );
      
      // Use pair_index if available, otherwise try to use the identifier as pair_index
      const pair_index = position?.pair_index || (typeof positionIdentifier === 'number' ? positionIdentifier : undefined);
      
      if (!pair_index && typeof positionIdentifier !== 'number') {
        console.error(`[usePositions] No pair_index found for position ${positionIdentifier}`);
        throw new Error(`Position ${positionIdentifier} does not have a pair_index. Cannot close position.`);
      }
      
      // Use token from useAuth() context, not from storage
      if (!token) {
        throw new Error('Not authenticated. Please log in again.');
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for close
      
      const response = await fetch('/api/close-position', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          pair_index: pair_index || (typeof positionIdentifier === 'number' ? positionIdentifier : undefined),
          symbol: position?.coin || position?.symbol || (typeof positionIdentifier === 'string' ? positionIdentifier : undefined) // Include symbol for reference
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      // Force refresh positions after successful close
      if (result.success) {
        // Small delay to allow blockchain to update, then trigger full app reload
        setTimeout(() => {
          fetchPositions(true);
          // Trigger a custom event to reload balance and trade history
          window.dispatchEvent(new CustomEvent('position-closed'));
        }, 1000);
      }
      
      return result.success;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to close position';
      console.error(`[usePositions] Error closing position ${identifier}:`, errorMessage);
      setError(errorMessage);
      return false;
    } finally {
      closePositionInProgressRef.current.delete(identifier);
    }
  }, [token, fetchPositions]);

  const closeAllPositions = useCallback(async (): Promise<boolean> => {
    // TEMPORARY: Skip authentication for testing
    // if (!token) return false;
    
    // Prevent duplicate close all requests
    if (closeAllInProgressRef.current) {
      return false;
    }
    
    closeAllInProgressRef.current = true;
    
    try {
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for close all
      
      const response = await fetch('/api/close-all-positions', {
        method: 'POST',
        headers: {
          // 'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      // Force refresh positions after successful close
      if (result.success) {
        setTimeout(() => fetchPositions(true), 1000);
      }
      
      return result.success;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to close all positions';
      console.error('[usePositions] Error closing all positions:', errorMessage);
      setError(errorMessage);
      return false;
    } finally {
      closeAllInProgressRef.current = false;
    }
  }, [fetchPositions]); // Removed token dependency

      // Smart auto-refresh: only refresh when positions exist and page is visible
      useEffect(() => {
        // Only fetch if we have a token AND user is authenticated
        if (!token) {
          // No token - set empty positions and return
          setPositionData({ positions: [], totalPnL: 0, openPositions: 0 });
          return;
        }
        
        // Check conditions and fetch if met (async)
        let cancelled = false;
        const initialFetch = async () => {
          try {
            const shouldFetch = await shouldFetchPositions();
            if (cancelled) return;
            
            if (!shouldFetch) {
              setPositionData({ positions: [], totalPnL: 0, openPositions: 0 });
              return;
            }
            
            // Initial fetch (only if conditions are met)
            await fetchPositions();
          } catch (err) {
            // Silently handle errors
          }
        };
        
        initialFetch();
        
        let interval: NodeJS.Timeout | null = null;

        const startPolling = () => {
          if (interval) return; // Already polling
          
          // Don't start polling if no token (user not authenticated)
          if (!token) {
            return;
          }

          // Poll with reduced frequency to reduce server load
          // Poll every 30 seconds when positions exist
          // Poll every 60 seconds when no positions
          // Backend caching (20s TTL) ensures fresh data without excessive RPC calls
          const pollInterval = positionData && positionData.openPositions > 0 ? 30000 : 60000;
          interval = setInterval(async () => {
            // Only fetch if we have a token and not already in progress
            if (token && !fetchInProgressRef.current && !document.hidden) {
              try {
                await fetchPositions();
              } catch (err) {
                console.error('[usePositions] Polling error:', err);
                // Don't silently fail - log for debugging
              }
            }
          }, pollInterval);
        };
    
    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    
    // Start polling on mount (only if token exists)
    if (token) {
      startPolling();
    }
    
    // Pause polling when tab is not visible to save resources
    const handleVisibilityChange = async () => {
      if (document.hidden) {
        stopPolling();
      } else if (token) {
        // Only resume if we have a token and conditions are met
        try {
          const shouldFetch = await shouldFetchPositions();
          if (shouldFetch) {
            await fetchPositions(true); // Force refresh when tab becomes visible
            startPolling();
          }
        } catch (err) {
          // Silently handle errors
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [token, positionData?.openPositions]); // Include positionData.openPositions to adjust polling interval

  // Listen for custom events that indicate positions might have changed
  useEffect(() => {
    const handlePositionChange = () => {
      console.log('[usePositions] Position change event detected, refreshing...')
      fetchPositions(true)
    }
    
    // Listen for position opened events (from trading bot or other sources)
    window.addEventListener('position-opened', handlePositionChange)
    window.addEventListener('position-closed', handlePositionChange)
    
    return () => {
      window.removeEventListener('position-opened', handlePositionChange)
      window.removeEventListener('position-closed', handlePositionChange)
    }
  }, [fetchPositions])

  return {
    positionData,
    isLoading,
    error,
    fetchPositions,
    forceRefreshPositions,
    closePosition,
    closeAllPositions,
  };
}
