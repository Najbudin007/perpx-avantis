"use client";

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useBaseMiniApp } from './useBaseMiniApp';

export interface TradingConfig {
  totalBudget: number;
  profitGoal: number;
  maxPositions: number;
  leverage?: number;
  lossThreshold?: number;
  walletAddress?: string;
  avantisApiWallet?: string;
  hyperliquidApiWallet?: string;
}

export interface TradingSession {
  id: string;
  status: 'running' | 'completed' | 'stopped' | 'error';
  startTime: Date;
  endTime?: Date;
  totalPnL: number;
  positions: number;
  config: TradingConfig;
  error?: string;
}

export interface TradingPosition {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  leverage: number;
  timestamp: Date;
}

export function useTrading() {
  const { token, login } = useAuth();
  const { authenticate, isBaseContext } = useBaseMiniApp();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use ref to store token to prevent callback recreation
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const makeRequest = useCallback(async (url: string, options: RequestInit = {}, retries = 2) => {
    const currentToken = tokenRef.current;
    if (!currentToken) {
      throw new Error('Not authenticated. Please login with Base Account.');
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
        
        // Always use relative URLs for Next.js API routes to avoid CORS issues
        // The Next.js API routes will proxy to the trading engine server-side
        // Only use absolute URLs if the URL already starts with http/https
        const fullUrl = url.startsWith('http') ? url : url;
        
        const response = await fetch(fullUrl, {
          ...options,
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentToken}`,
            ...options.headers,
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          let errorData;
          try {
            errorData = await response.json();
          } catch {
            errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
          }
          
          // Don't retry on client errors (4xx)
          if (response.status >= 400 && response.status < 500) {
            // Provide more specific error messages for authentication errors
            if (response.status === 401) {
              const authError = errorData.error || 'Unauthorized';
              console.error('[useTrading] Authentication error:', authError);
              console.error('[useTrading] Full error data:', errorData);
              throw new Error(authError.includes('Unauthorized') 
                ? 'Authentication failed. Please refresh your session and try again.' 
                : authError);
            }
            
            // Log other client errors for debugging
            if (response.status >= 400 && response.status < 500) {
              console.error('[useTrading] Client error:', response.status, errorData);
            }
            throw new Error(errorData.error || `Request failed with status ${response.status}`);
          }
          
          // Retry on server errors (5xx) or network errors
          if (attempt < retries) {
            console.warn(`[useTrading] Request failed, retrying (${attempt + 1}/${retries})...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
            continue;
          }
          
          throw new Error(errorData.error || `Request failed with status ${response.status}`);
        }

        return response.json();
      } catch (error) {
        // Handle network errors (AbortError, Failed to fetch, etc.)
        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            throw new Error('Request timeout. Please check your connection and try again.');
          }
          
          if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            if (attempt < retries) {
              console.warn(`[useTrading] Network error, retrying (${attempt + 1}/${retries})...`);
              await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
              continue;
            }
            throw new Error('Network error. Please check your internet connection and try again.');
          }
        }
        
        // If we've exhausted retries or it's not a retryable error, throw
        if (attempt === retries) {
          throw error;
        }
      }
    }
    
    throw new Error('Request failed after retries');
  }, [token]);

  const startTrading = useCallback(async (config: TradingConfig): Promise<TradingSession> => {
    setIsLoading(true);
    setError(null);

    try {
      // Ensure we have an auth token (Farcaster/Base mini app)
      if (!tokenRef.current) {
        if (!isBaseContext) {
          throw new Error('Not authenticated. Please open in Farcaster or refresh the session.');
        }

        const baseAuth = await authenticate();
        if (!baseAuth?.token) {
          throw new Error('Authentication failed. Please retry in Farcaster.');
        }

        // Prime the tokenRef immediately so subsequent calls use it
        tokenRef.current = baseAuth.token;

        // Persist into AuthContext so the rest of the app sees it
        login(baseAuth.token, {
          id: `fid_${baseAuth.fid ?? 'unknown'}`,
          fid: baseAuth.fid ?? 0,
          baseAccountAddress: baseAuth.address || null,
          hasWallet: !!baseAuth.address,
          createdAt: new Date(),
        });
      }

      // Normalize payload for API: map UI fields to API expectations
      const payload: any = {
        // required fields
        maxBudget: (config as any).maxBudget ?? (config as any).totalBudget ?? config.totalBudget,
        profitGoal: config.profitGoal,
        maxPerSession: (config as any).maxPerSession ?? (config as any).maxPositions ?? config.maxPositions,
        lossThreshold: config.lossThreshold ?? (config as any).lossThreshold ?? 10,
      };

      // Pass through optional fields if present
      if ((config as any).leverage !== undefined) payload.leverage = (config as any).leverage;
      if ((config as any).totalBudget !== undefined) payload.totalBudget = (config as any).totalBudget;
      if ((config as any).maxPositions !== undefined) payload.maxPositions = (config as any).maxPositions;
      if ((config as any).walletAddress) payload.walletAddress = (config as any).walletAddress;
      if ((config as any).avantisApiWallet) payload.avantisApiWallet = (config as any).avantisApiWallet;
      if ((config as any).hyperliquidApiWallet) payload.hyperliquidApiWallet = (config as any).hyperliquidApiWallet;

      const result = await makeRequest('/api/trading/start', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // Check if API returned an error
      if (result.error || result.success === false) {
        const errorMsg = result.error || 'Failed to start trading';
        throw new Error(errorMsg);
      }

      // Check if we have a sessionId (successful response)
      if (!result.sessionId) {
        const errorMsg = result.error || 'Failed to start trading - no session ID returned. Please check if the trading engine is running.';
        throw new Error(errorMsg);
      }

      // Return a basic session object
      return {
        id: result.sessionId,
        status: 'running',
        startTime: new Date(),
        totalPnL: 0,
        positions: 0,
        config
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start trading';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [makeRequest]);

  const stopTrading = useCallback(async (sessionId: string): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await makeRequest('/api/trading/stop', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });

      // Check if we have a valid response (successful stop)
      if (result.error) {
        throw new Error(result.error || 'Failed to stop trading');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to stop trading';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [makeRequest]);

  const getTradingSessions = useCallback(async (): Promise<TradingSession[]> => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await makeRequest('/api/trading/sessions');

      // Check if we have a valid response (successful fetch)
      // If result has error but also has sessions array, use the sessions (graceful degradation)
      if (result.error && (!result.sessions || result.sessions.length === 0)) {
        // Only throw error if there are no sessions to return
        throw new Error(result.error || 'Failed to fetch trading sessions');
      }

      // Return sessions array (empty array is valid - means no active sessions)
      const sessions = result.sessions || [];
      return sessions.map((session: any) => ({
        ...session,
        startTime: new Date(session.startTime),
        endTime: session.endTime ? new Date(session.endTime) : undefined,
      }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch trading sessions';
      
      // If it's a 404 or network error, return empty array instead of throwing
      // This prevents UI errors when trading engine is not available
      if (errorMessage.includes('404') || errorMessage.includes('Failed to fetch') || errorMessage.includes('Network')) {
        console.warn('[useTrading] Trading sessions endpoint unavailable, returning empty array');
        return [];
      }
      
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [makeRequest]);

  const getTradingSession = useCallback(async (sessionId: string): Promise<TradingSession & { positions: TradingPosition[] }> => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await makeRequest(`/api/trading/session/${sessionId}`);

      // Check if we have a valid response (successful fetch)
      if (result.error) {
        throw new Error(result.error || 'Failed to fetch trading session');
      }

      // Handle both wrapped and direct response formats
      let sessionData = result.session || result;
      
      // Check if session data exists
      if (!sessionData) {
        throw new Error('Session data not found in response');
      }

      // Check if session has an error status
      if (sessionData.error) {
        throw new Error(sessionData.error);
      }

      return {
        ...sessionData,
        startTime: new Date(sessionData.startTime || sessionData.lastUpdate || new Date().toISOString()),
        endTime: sessionData.endTime ? new Date(sessionData.endTime) : undefined,
        positions: sessionData.positions ? sessionData.positions.map((pos: any) => ({
          ...pos,
          timestamp: new Date(pos.timestamp),
        })) : [],
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch trading session';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [makeRequest]);

  return {
    isLoading,
    error,
    startTrading,
    stopTrading,
    getTradingSessions,
    getTradingSession,
  };
}