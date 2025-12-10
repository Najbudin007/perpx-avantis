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
    // Don't set loading state for background refreshes to prevent skeleton flash
    if (!positionData || force) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 30000);

      const response = await fetch('/api/positions', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
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
  }, [token]); // Only depend on token

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
      
      const token = getStorageItem('token', '');
      
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
        // Small delay to allow blockchain to update
        setTimeout(() => fetchPositions(true), 1000);
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
  }, [fetchPositions]); // Removed token dependency

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

          // Poll every 10 seconds when positions exist (for live PnL updates)
          // Poll every 30 seconds when no positions (just checking for new positions)
          const pollInterval = positionData && positionData.openPositions > 0 ? 10000 : 30000;
          interval = setInterval(async () => {
            // Only fetch if we have a token and not already in progress
            if (token && !fetchInProgressRef.current && !document.hidden) {
              try {
                await fetchPositions();
              } catch (err) {
                // Silently handle errors
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
  }, [token]); // Only depend on token to prevent infinite loops

  return {
    positionData,
    isLoading,
    error,
    fetchPositions,
    closePosition,
    closeAllPositions,
  };
}
