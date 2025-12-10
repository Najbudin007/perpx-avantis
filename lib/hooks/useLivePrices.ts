"use client";

import { useState, useEffect, useCallback, useRef } from 'react';

export interface PriceUpdate {
  symbol: string;
  price: number;
}

export interface PricesMap {
  [symbol: string]: number;
}

/**
 * Hook for fetching live prices for symbols without full position refresh.
 * Polls prices separately from position data for real-time updates.
 */
export function useLivePrices(symbols: string[], enabled: boolean = true, interval: number = 5000) {
  const [prices, setPrices] = useState<PricesMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchInProgressRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchPrices = useCallback(async () => {
    if (!enabled || symbols.length === 0 || fetchInProgressRef.current) {
      return;
    }

    fetchInProgressRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const symbolsParam = symbols.join(',');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      // Use Next.js API route to avoid CORS issues
      // The API route will proxy to the trading engine server-side
      const response = await fetch(
        `/api/prices?symbols=${encodeURIComponent(symbolsParam)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.prices) {
        setPrices(data.prices);
        setError(null);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch prices';
      // Don't set error state for timeouts/aborts - just skip this update
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
      fetchInProgressRef.current = false;
    }
  }, [symbols, enabled]);

  // Set up polling
  useEffect(() => {
    if (!enabled || symbols.length === 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial fetch
    fetchPrices();

    // Set up polling interval
    intervalRef.current = setInterval(() => {
      if (!document.hidden && !fetchInProgressRef.current) {
        fetchPrices();
      }
    }, interval);

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchPrices, enabled, symbols.length, interval]);

  // Pause polling when tab is hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else if (enabled && symbols.length > 0) {
        // Resume polling when tab becomes visible
        if (!intervalRef.current) {
          fetchPrices();
          intervalRef.current = setInterval(() => {
            if (!document.hidden && !fetchInProgressRef.current) {
              fetchPrices();
            }
          }, interval);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchPrices, enabled, symbols.length, interval]);

  return {
    prices,
    isLoading,
    error,
    refetch: fetchPrices,
  };
}
