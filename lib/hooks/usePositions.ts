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

// 🛑 LOCAL STORAGE CACHE: Persist positions across app reopens
const POSITIONS_CACHE_KEY = 'perpx_positions_cache';
const POSITIONS_CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes

// 🔄 LIGHT AUTO-REFRESH: Gentle polling to keep positions fresh without feeling laggy
// Kept reasonably high to avoid hammering the API or hitting rate limits.
const AUTO_REFRESH_INTERVAL_MS = 15000; // 15 seconds

interface CachedPositions {
  data: PositionData;
  wallet: string;
  timestamp: number;
}

function getCachedPositions(wallet: string | null): PositionData | null {
  if (!wallet || typeof window === 'undefined') return null;
  
  try {
    const cached = localStorage.getItem(POSITIONS_CACHE_KEY);
    if (!cached) return null;
    
    const parsed: CachedPositions = JSON.parse(cached);
    const now = Date.now();
    
    // Check if cache is valid (same wallet and not expired)
    if (parsed.wallet?.toLowerCase() === wallet.toLowerCase() && 
        (now - parsed.timestamp) < POSITIONS_CACHE_EXPIRY) {
      console.log('[usePositions] Restoring positions from cache');
      return parsed.data;
    }
    
    // Cache expired or different wallet - clear it
    localStorage.removeItem(POSITIONS_CACHE_KEY);
    return null;
  } catch (err) {
    console.error('[usePositions] Error reading cache:', err);
    return null;
  }
}

function setCachedPositions(wallet: string | null, data: PositionData) {
  if (!wallet || typeof window === 'undefined') return;
  
  try {
    const cache: CachedPositions = {
      data,
      wallet: wallet.toLowerCase(),
      timestamp: Date.now(),
    };
    localStorage.setItem(POSITIONS_CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.error('[usePositions] Error writing cache:', err);
  }
}

export function usePositions() {
  const { token } = useAuth();
  const { tradingWalletAddress } = useIntegratedWallet();
  const [positionData, setPositionData] = useState<PositionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasStaleData, setHasStaleData] = useState(false); // Track if we have stale data during background refresh
  
  // 🛑 HARD FETCH LOCK - prevents concurrent requests
  const isFetchingRef = useRef(false);
  const lastFetchTimeRef = useRef(0);
  const lastWalletRef = useRef<string | null>(null);
  const openPositionsCountRef = useRef(0); // Track position count as primitive
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasEverLoadedRef = useRef(false); // Track if we've ever successfully loaded positions
  
  // Extract wallet address as primitive (stable dependency)
  const walletAddress = useRef<string | null>(null);
  const walletAddressString = tradingWalletAddress?.toLowerCase() || null;
  
  useEffect(() => {
    // Update ref when address changes
    walletAddress.current = walletAddressString;
  }, [walletAddressString]); // Only depend on address string (primitive)
  
  // 🛑 RESTORE CACHED POSITIONS ON MOUNT: Show positions immediately on app reopen
  useEffect(() => {
    const wallet = walletAddressString;
    if (!wallet || positionData) return; // Don't restore if we already have data
    
    // Try to restore from cache
    const cached = getCachedPositions(wallet);
    if (cached) {
      console.log('[usePositions] Restoring cached positions on mount');
      setPositionData(cached);
      openPositionsCountRef.current = cached.openPositions || 0;
      hasEverLoadedRef.current = true;
      // Don't set loading - we have cached data to show immediately
      // Fresh data will be fetched in background by the initial fetch useEffect
    }
  }, [walletAddressString, positionData]); // Include positionData to prevent re-restoring

  // 🛑 SAFE FETCH WRAPPER - all fetches must go through this
  const fetchPositionsSafe = useCallback(async (wallet: string | null, force = false) => {
    // Hard lock: prevent concurrent requests
    if (isFetchingRef.current && !force) {
      console.log('[usePositions] Fetch already in progress, skipping');
      return;
    }

    // Backoff: don't fetch if last fetch was less than 3 seconds ago (unless forced)
    const now = Date.now();
    if (!force && (now - lastFetchTimeRef.current) < 3000) {
      console.log('[usePositions] Backoff: too soon after last fetch');
      return;
    }

    // Must have wallet or token
    if (!wallet && !token) {
      if (!positionData) {
        setPositionData({ positions: [], totalPnL: 0, openPositions: 0 });
      }
      return;
    }

    isFetchingRef.current = true;
    lastFetchTimeRef.current = now;
    lastWalletRef.current = wallet;

    // 🛑 STALE-WHILE-REVALIDATE: Only set loading for initial load (no existing data)
    // During background refresh, keep existing data visible - never show loading state
    const isBackgroundRefresh = !!positionData;
    
    if (!positionData) {
      setIsLoading(true);
      setHasStaleData(false);
    } else {
      // Background refresh - mark that we have stale data to keep UI stable
      setHasStaleData(true);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 25000); // 25s timeout so UI doesn't feel frozen forever

      const response = await fetch('/api/positions', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      
      if (!response.ok) {
        // 🛑 KILL RETRY STORMS: Never retry on 429 or rate_limited
        if (response.status === 429) {
          const errorData = await response.json().catch(() => ({}));
          
          // Check if response indicates rate limiting
          if (errorData.rate_limited || errorData.error === 'rate_limit_exceeded') {
            console.warn('[usePositions] Rate limited - NOT retrying, preserving existing data');
            // DO NOT retry, DO NOT clear state, DO NOT update anything
            // Keep existing positionData visible
            return;
          }
          
          // If it's a 429 but not explicitly rate_limited, still don't retry immediately
          console.warn('[usePositions] 429 error - NOT retrying immediately');
          return;
        }
        
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('[usePositions] API error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        
        // 🛑 UI STATE STABLE: Don't clear positions on error
        // Only set error message, keep existing positionData
        setError(`HTTP ${response.status}: ${errorText}`);
        return;
      }
      
      const data = await response.json();
      
      // 🛑 KILL RETRY STORMS: Check for rate_limited flag in response
      if (data.rate_limited) {
        console.warn('[usePositions] Response marked as rate_limited - NOT updating state');
        return;
      }
      
      // 🛑 STALE-WHILE-REVALIDATE: Always preserve existing data during background refresh
      // Never clear positions - only update when we have valid new data
      const hasExistingPositions = positionData && positionData.openPositions > 0;
      const isBackgroundRefresh = !!positionData; // If we have existing data, this is a background refresh
      
      // Helper function to create a unique key for a position
      const getPositionKey = (pos: Position): string => {
        // Use pair_index + index if available, otherwise fall back to coin + side
        if (pos.pair_index !== undefined && pos.pair_index !== null) {
          const index = pos.index !== undefined && pos.index !== null ? pos.index : 0;
          return `${pos.pair_index}-${index}`;
        }
        return `${pos.coin || pos.symbol || ''}-${pos.side}`;
      };
      
      // Check if we have valid positions array (non-empty)
      if (data.positions && Array.isArray(data.positions) && data.positions.length > 0) {
        const previousPositionCount = openPositionsCountRef.current;
        const currentPositionCount = data.openPositions || 0;
        
        // 🛑 SMART UPDATE: Only refresh if positions actually changed (added/removed)
        // If all positions already exist in UI, maintain state and let live prices handle updates
        if (positionData && positionData.positions && positionData.positions.length > 0) {
          const existingKeys = new Set(positionData.positions.map(getPositionKey));
          const newKeys = new Set(data.positions.map(getPositionKey));
          
          // Check if positions changed (new position added or removed)
          const hasNewPosition = data.positions.some((pos: Position) => !existingKeys.has(getPositionKey(pos)));
          const hasRemovedPosition = positionData.positions.some((pos: Position) => !newKeys.has(getPositionKey(pos)));
          
          if (!hasNewPosition && !hasRemovedPosition && currentPositionCount === previousPositionCount) {
            // All positions already exist in UI - don't refresh, maintain state
            // Live prices will handle real-time updates via useLivePrices hook
            console.log('[usePositions] All positions already in UI - maintaining state, skipping refresh');
            setHasStaleData(false);
            // Note: finally block will handle setIsLoading(false) and isFetchingRef.current = false
            return; // Exit early, don't update state
          }
          
          if (hasNewPosition) {
            console.log('[usePositions] New position detected - refreshing to add new row');
          }
          if (hasRemovedPosition) {
            console.log('[usePositions] Position removed - refreshing to remove row');
          }
        }
        
        openPositionsCountRef.current = currentPositionCount;
        
        // Dispatch events only if count actually changed
        if (currentPositionCount !== previousPositionCount) {
          if (currentPositionCount > previousPositionCount) {
            console.log('[usePositions] Position opened! Dispatching position-opened event');
            window.dispatchEvent(new CustomEvent('position-opened', { 
              detail: { count: currentPositionCount, previousCount: previousPositionCount }
            }));
          } else if (currentPositionCount < previousPositionCount) {
            console.log('[usePositions] Position closed! Dispatching position-closed event');
            window.dispatchEvent(new CustomEvent('position-closed', { 
              detail: { count: currentPositionCount, previousCount: previousPositionCount }
            }));
          }
        }
        
        // 🛑 STALE-WHILE-REVALIDATE: Update state with new data (smooth transition, no flicker)
        // This replaces old data with new data atomically - no empty state in between
        setPositionData(data);
        setHasStaleData(false); // Clear stale flag when we have fresh data
        hasEverLoadedRef.current = true;
        setError(null);
        
        // 🛑 CACHE: Save positions to localStorage for app reopen
        if (wallet) {
          setCachedPositions(wallet, data);
        }
      } else if (data.positions && Array.isArray(data.positions) && data.positions.length === 0) {
        // Empty positions array from API
        // 🛑 CRITICAL: Never clear existing positions during background refresh
        if (!hasExistingPositions && !isBackgroundRefresh) {
          // No existing positions AND not a background refresh - safe to update to empty (initial load)
          setPositionData(data);
          openPositionsCountRef.current = 0;
          setHasStaleData(false);
          hasEverLoadedRef.current = true;
        } else if (hasExistingPositions) {
          // We have existing positions - this is a background refresh
          // 🛑 STALE-WHILE-REVALIDATE: Keep existing positions visible - NEVER clear them
          console.log('[usePositions] Background refresh returned empty positions - keeping existing data visible (stale-while-revalidate)');
          // DO NOT update positionData - keep stale data visible
          // Keep hasStaleData = true to indicate we're showing stale data
          // The positions will remain visible until we get new non-empty data
        } else {
          // No existing positions but this is a background refresh (shouldn't happen, but handle it)
          console.log('[usePositions] Background refresh with no existing positions - keeping current state');
        }
        setError(null);
      } else {
        // Invalid data structure - keep existing data
        console.warn('[usePositions] Invalid position data structure, keeping existing data');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch positions';
      
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Request timeout - please check your connection');
      } else {
        setError(errorMessage);
      }
      
      // 🛑 KILL RETRY STORMS: Never retry on error automatically
      // Let user manually refresh if needed
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
      // Note: hasStaleData is only cleared when we successfully get new data
      // If fetch fails or returns empty during background refresh, hasStaleData stays true
    }
  }, [token]); // Only depend on token (primitive)

  // Public fetchPositions function - wraps safe fetch
  const fetchPositions = useCallback(async (force = false) => {
    await fetchPositionsSafe(walletAddress.current, force);
  }, [fetchPositionsSafe]);

  // Force refresh positions
  const forceRefreshPositions = useCallback(async () => {
    console.log('[usePositions] Force refreshing positions...');
    await fetchPositionsSafe(walletAddress.current, true);
  }, [fetchPositionsSafe]);

  const closePositionInProgressRef = useRef<Set<string>>(new Set());
  const closeAllInProgressRef = useRef(false);

  const closePosition = useCallback(async (positionIdentifier: string | number): Promise<boolean> => {
    const identifier = String(positionIdentifier);
    if (closePositionInProgressRef.current.has(identifier)) {
      return false;
    }
    
    closePositionInProgressRef.current.add(identifier);
    
    try {
      const position = positionData?.positions.find(p => 
        p.coin === positionIdentifier || 
        p.symbol === positionIdentifier ||
        p.pair_index === positionIdentifier
      );
      
      // Get pair_index - handle 0 as valid value
      let pair_index: number | undefined;
      if (position?.pair_index !== undefined && position?.pair_index !== null) {
        pair_index = position.pair_index;
      } else if (typeof positionIdentifier === 'number') {
        pair_index = positionIdentifier;
      }
      
      // Check if pair_index is valid (0 is a valid pair_index, so only check for undefined/null)
      if (pair_index === undefined || pair_index === null) {
        console.error(`[usePositions] No pair_index found for position ${positionIdentifier}`);
        throw new Error(`Position ${positionIdentifier} does not have a pair_index. Cannot close position.`);
      }
      
      if (!token) {
        throw new Error('Not authenticated. Please log in again.');
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      // Get trade_index (index) from position - required for closing when multiple positions exist on same pair
      const trade_index = position?.index !== undefined && position?.index !== null 
        ? position.index 
        : 0; // Default to 0 if not specified
      
      const response = await fetch('/api/close-position', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          pair_index: pair_index || (typeof positionIdentifier === 'number' ? positionIdentifier : undefined),
          trade_index: trade_index, // Include trade_index for proper position identification
          symbol: position?.coin || position?.symbol || (typeof positionIdentifier === 'string' ? positionIdentifier : undefined)
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        // Clear cache when position is closed (force fresh fetch)
        if (typeof window !== 'undefined') {
          localStorage.removeItem(POSITIONS_CACHE_KEY);
        }
        
        // Refresh after close (with delay)
        setTimeout(() => {
          fetchPositionsSafe(walletAddress.current, true);
          window.dispatchEvent(new CustomEvent('position-closed'));
        }, 1000);
        
        return true;
      } else {
        // API returned success: false - throw error so parent handler can catch it
        const errorMsg = result.error || result.message || 'Position close failed';
        throw new Error(errorMsg);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to close position';
      console.error(`[usePositions] Error closing position ${identifier}:`, errorMessage);
      setError(errorMessage);
      return false;
    } finally {
      closePositionInProgressRef.current.delete(identifier);
    }
  }, [token, fetchPositionsSafe, positionData]);

  const closeAllPositions = useCallback(async (): Promise<boolean> => {
    if (closeAllInProgressRef.current) {
      return false;
    }
    
    closeAllInProgressRef.current = true;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      
      const response = await fetch('/api/close-all-positions', {
        method: 'POST',
        headers: {
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
      
      if (result.success) {
        // Clear cache when all positions are closed
        if (typeof window !== 'undefined') {
          localStorage.removeItem(POSITIONS_CACHE_KEY);
        }
        
        setTimeout(() => fetchPositionsSafe(walletAddress.current, true), 1000);
        return true;
      } else {
        const errorMsg = result.error || result.message || 'Failed to close all positions';
        throw new Error(errorMsg);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to close all positions';
      console.error('[usePositions] Error closing all positions:', errorMessage);
      setError(errorMessage);
      return false;
    } finally {
      closeAllInProgressRef.current = false;
    }
  }, [fetchPositionsSafe]);

  // 🛑 RESTORE CACHED POSITIONS ON MOUNT: Show positions immediately on app reopen
  // This runs BEFORE the initial fetch to restore cached data
  useEffect(() => {
    const wallet = walletAddressString;
    if (!wallet || positionData) return; // Don't restore if we already have data
    
    // Try to restore from cache
    const cached = getCachedPositions(wallet);
    if (cached) {
      console.log('[usePositions] Restoring cached positions on mount');
      setPositionData(cached);
      openPositionsCountRef.current = cached.openPositions || 0;
      hasEverLoadedRef.current = true;
      // Don't set loading - we have cached data to show immediately
      // Fresh data will be fetched in background by the initial fetch useEffect
    }
  }, [walletAddressString]); // Only run when wallet changes, not positionData (to avoid loops)

  // 🛑 STABILIZE useEffect DEPENDENCIES: Only depend on primitives
  // Initial fetch when wallet/token changes
  useEffect(() => {
    // Clear any pending retry
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    const wallet = walletAddressString;
    const hasToken = !!token;
    
    // Only fetch if we have both wallet and token
    if (!wallet || !hasToken) {
      if (!positionData) {
        setPositionData({ positions: [], totalPnL: 0, openPositions: 0 });
      }
      return;
    }

    // Update ref
    walletAddress.current = wallet;
    
    // Initial fetch (will run in background if we have cached data)
    // fetchPositionsSafe will detect cached data and not show loading state
    fetchPositionsSafe(wallet, false);
  }, [token, walletAddressString]); // Only primitives: token (string) and wallet address (string)

  // 🛑 NO POLLING: Positions are static - only prices update in real-time via useLivePrices
  // Positions should only refresh when:
  // 1. Position is opened (position-opened event)
  // 2. Position is closed (position-closed event)  
  // 3. TP/SL is updated (position-updated event)
  // 4. User manually refreshes (forceRefreshPositions)
  // 5. Tab becomes visible after being hidden (single refresh, not polling)
  
  // Track if we have position data using ref to avoid dependency
  const positionDataRef = useRef(positionData);
  useEffect(() => {
    positionDataRef.current = positionData;
  }, [positionData]);
  
  // Handle visibility change - refresh once when tab becomes visible (not polling)
  useEffect(() => {
    const wallet = walletAddressString;
    const hasToken = !!token;
    
    if (!wallet || !hasToken) {
      return;
    }

    // Update ref
    walletAddress.current = wallet;

    // Only refresh when tab becomes visible (not polling)
    const handleVisibilityChange = () => {
      if (!document.hidden && !isFetchingRef.current && positionDataRef.current) {
        // Tab became visible and we have existing data - refresh once to check for changes
        // This handles cases where user was away and positions might have changed
        console.log('[usePositions] Tab became visible - refreshing positions once');
        fetchPositionsSafe(wallet, false);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [token, walletAddressString]); // Only primitives - use ref for positionData

  // 🔄 LIGHT AUTO-REFRESH: keep positions reasonably fresh without aggressive polling
  // Only refresh when there are open positions - maintain state when no positions exist
  useEffect(() => {
    const wallet = walletAddressString;
    const hasToken = !!token;

    if (!wallet || !hasToken) {
      return;
    }

    // Only set up auto-refresh if we have open positions
    // When there are no positions, maintain state and don't poll
    const hasOpenPositions = (positionData?.openPositions ?? 0) > 0;
    
    if (!hasOpenPositions) {
      // No positions - don't set up polling, maintain current state
      return;
    }

    // Update ref so auto-refresh always uses the latest wallet
    walletAddress.current = wallet;

    const intervalId = setInterval(() => {
      // Respect existing in-flight requests and backoff logic inside fetchPositionsSafe
      if (!isFetchingRef.current) {
        fetchPositionsSafe(walletAddress.current, false);
      }
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [token, walletAddressString, fetchPositionsSafe, positionData?.openPositions]);

  // Listen for position change events - stable handler
  useEffect(() => {
    const handlePositionChange = () => {
      const wallet = walletAddress.current;
      if (wallet && !isFetchingRef.current) {
        console.log('[usePositions] Position change event detected, refreshing...');
        fetchPositionsSafe(wallet, true); // Force refresh on events
      }
    };
    
    window.addEventListener('position-opened', handlePositionChange);
    window.addEventListener('position-closed', handlePositionChange);
    window.addEventListener('position-updated', handlePositionChange); // Listen for TP/SL updates
    
    return () => {
      window.removeEventListener('position-opened', handlePositionChange);
      window.removeEventListener('position-closed', handlePositionChange);
      window.removeEventListener('position-updated', handlePositionChange);
    };
  }, []); // Empty deps - handler is stable, uses refs

  return {
    positionData,
    isLoading,
    error,
    hasStaleData, // Expose stale data flag for UI stability
    fetchPositions,
    forceRefreshPositions,
    closePosition,
    closeAllPositions,
  };
}
