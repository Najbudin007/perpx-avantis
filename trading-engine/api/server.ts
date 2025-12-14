// Load environment variables from trading-engine/.env
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env from trading-engine directory (parent directory of api/) if it exists
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

import express from 'express';
import cors from 'cors';
import { TradingSessionManager } from '../session-manager';

const app = express();

// Get port at runtime (not build time)
function getPort(): number {
  return parseInt(process.env.API_PORT || '3001', 10);
}

// Middleware - CORS configuration with explicit preflight handling
// CORS: allow all origins in dev, restrict in prod if needed
// Note: Frontend should use Next.js API routes to avoid CORS issues
// This CORS config is for direct trading engine access (if needed)
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? ['https://avantis.superapp.gg']
    : true, // Allow all origins in dev (localhost:3000, etc.)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};

// Apply CORS to all routes
app.use(cors(corsOptions));

// Explicitly handle OPTIONS requests for preflight (before other routes)
app.options('*', cors(corsOptions));

app.use(express.json());

// Initialize session manager
const sessionManager = new TradingSessionManager();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    activeSessions: sessionManager.getAllSessions().length
  });
});

// Start trading session
app.post('/api/trading/start', async (req, res) => {
  try {
    console.log(`[API] Received trading start request`);
    console.log(`[API] Request body keys:`, Object.keys(req.body || {}));
    
    const { 
      maxBudget, 
      profitGoal, 
      maxPerSession,
      lossThreshold = 10, // Default 10% loss threshold
      hyperliquidApiWallet, 
      avantisApiWallet, // Avantis private key (required for automated trading)
      userPhoneNumber, 
      userFid, // FID for user identification
      walletAddress,
    } = req.body;

    // Log received values (mask sensitive data)
    console.log(`[API] Received parameters:`, {
      maxBudget: maxBudget ? parseFloat(maxBudget) : 'MISSING',
      profitGoal: profitGoal ? parseFloat(profitGoal) : 'MISSING',
      maxPerSession: maxPerSession ? parseInt(maxPerSession) : 'MISSING',
      lossThreshold: lossThreshold || 10,
      hasAvantisApiWallet: !!avantisApiWallet,
      hasHyperliquidApiWallet: !!hyperliquidApiWallet,
      hasWalletAddress: !!walletAddress,
      userFid: userFid || 'none',
      userPhoneNumber: userPhoneNumber || 'none'
    });

    // Validate input
    if (!maxBudget || !profitGoal || !maxPerSession) {
      const missing = [];
      if (!maxBudget) missing.push('maxBudget');
      if (!profitGoal) missing.push('profitGoal');
      if (!maxPerSession) missing.push('maxPerSession');
      console.error(`[API] ❌ Missing required parameters:`, missing);
      return res.status(400).json({ 
        error: `Missing required parameters: ${missing.join(', ')}` 
      });
    }

    // Private key and wallet address are required for automated trading
    const privateKey = avantisApiWallet || hyperliquidApiWallet;
    if (!privateKey || !walletAddress) {
      const missing = [];
      if (!privateKey) missing.push('avantisApiWallet (or hyperliquidApiWallet)');
      if (!walletAddress) missing.push('walletAddress');
      console.error(`[API] ❌ Missing required wallet data:`, missing);
      console.error(`[API] ❌ avantisApiWallet:`, avantisApiWallet ? `${avantisApiWallet.slice(0, 10)}...` : 'MISSING');
      console.error(`[API] ❌ hyperliquidApiWallet:`, hyperliquidApiWallet ? `${hyperliquidApiWallet.slice(0, 10)}...` : 'MISSING');
      console.error(`[API] ❌ walletAddress:`, walletAddress || 'MISSING');
      return res.status(400).json({ 
        error: `Missing required wallet data: ${missing.join(' and ')}` 
      });
    }

    console.log(`[API] Starting trading session for user ${userPhoneNumber || userFid || 'unknown'} with wallet ${walletAddress}`);
    console.log(`[API] Private key will be passed to Avantis service per-request (not stored globally)`);

    if (maxBudget < 10 || maxBudget > 10000000) {
      return res.status(400).json({ 
        error: 'maxBudget must be between $10 and $10,000,000' 
      });
    }

    if (profitGoal <= 0) {
      return res.status(400).json({ 
        error: 'profitGoal must be greater than 0' 
      });
    }

    if (maxPerSession < 1 || maxPerSession > 20) {
      return res.status(400).json({ 
        error: 'maxPerSession must be between 1 and 20' 
      });
    }

    if (lossThreshold < 1 || lossThreshold > 50) {
      return res.status(400).json({ 
        error: 'lossThreshold must be between 1% and 50%' 
      });
    }
    
    console.log(`[API] Starting session with private key check:`, {
      hasPrivateKey: !!privateKey,
      privateKeyLength: privateKey?.length || 0,
      walletAddress: walletAddress
    });
    
    const sessionId = await sessionManager.startSession({
      maxBudget: parseFloat(maxBudget),
      profitGoal: parseFloat(profitGoal),
      maxPerSession: parseInt(maxPerSession),
      lossThreshold: parseFloat(lossThreshold),
      userPhoneNumber: userPhoneNumber || undefined,
      walletAddress,
      privateKey: privateKey // Store private key per-session for Avantis trading
    });
    
    console.log(`[API] Session ${sessionId} started. Private key was ${privateKey ? 'provided' : 'MISSING'}`);

    console.log(`[API] Started trading session ${sessionId} for wallet ${walletAddress}`);
    res.json({ 
      sessionId, 
      status: 'started',
      config: { maxBudget, profitGoal, maxPerSession, lossThreshold },
      user: { phoneNumber: userPhoneNumber, walletAddress }
    });
  } catch (error) {
    console.error('[API] Error starting trading session:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
});

// Get session status
app.get('/api/trading/status/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const status = sessionManager.getSessionStatus(sessionId);
    
    if (!status) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json(status);
  } catch (error) {
    console.error('[API] Error getting session status:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
});

// Get session details (alternative endpoint for frontend)
app.get('/api/trading/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const status = sessionManager.getSessionStatus(sessionId);
    
    if (!status) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json(status);
  } catch (error) {
    console.error('[API] Error getting session details:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
});

// Get all sessions
app.get('/api/trading/sessions', (req, res) => {
  try {
    const sessions = sessionManager.getAllSessions();
    res.json({ sessions });
  } catch (error) {
    console.error('[API] Error getting all sessions:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
});

// Stop trading session
app.post('/api/trading/stop/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const { force } = req.body;
    
    const stopped = force 
      ? sessionManager.forceStopSession(sessionId)
      : sessionManager.stopSession(sessionId);
    
    if (!stopped) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    console.log(`[API] Stopped trading session ${sessionId}`);
    res.json({ sessionId, status: 'stopped' });
  } catch (error) {
    console.error('[API] Error stopping trading session:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
});

// Close all positions (for traditional wallets with private key)
app.post('/api/close-all-positions', async (req, res) => {
  try {
    const { privateKey, phoneNumber, sessionId } = req.body;
    
    if (!privateKey) {
      return res.status(400).json({ 
        error: 'Private key is required for traditional wallets' 
      });
    }

    console.log(`[API] Closing all positions for user ${phoneNumber || 'unknown'}`);
    
    // For Avantis: Call Avantis service
    // Get Avantis API URL at runtime
    function getAvantisApiUrl(): string {
      return process.env.AVANTIS_API_URL || 'http://localhost:8000';
    }
    const avantisApiUrl = getAvantisApiUrl();
    try {
      const response = await fetch(`${avantisApiUrl}/api/close-all-positions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          private_key: privateKey,
        }),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: response.statusText })) as { detail?: string };
        throw new Error(errorData.detail || `Avantis API error: ${response.statusText}`);
      }

      const result = await response.json() as { closed_count?: number; [key: string]: unknown };
      res.json({
        success: true,
        message: `Successfully closed ${result.closed_count || 0} positions`,
        details: result
      });
    } catch (avantisError) {
      console.error('[API] Error calling Avantis service:', avantisError);
      // Fallback to Hyperliquid if Avantis fails (for backward compatibility)
      const { closeAllPositions } = await import('../hyperliquid/hyperliquid');
      const result = await closeAllPositions();
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: 'All positions closed successfully',
          details: result
        });
      } else {
        res.status(400).json({ 
          success: false,
          error: result.error || 'Failed to close all positions'
        });
      }
    }
  } catch (error) {
    console.error('[API] Error closing all positions:', error);
    res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Close a single position (for traditional wallets with private key)
app.post('/api/close-position', async (req, res) => {
  try {
    const { pairIndex, privateKey, userFid } = req.body;
    
    if (!privateKey) {
      return res.status(400).json({ 
        error: 'Private key is required for traditional wallets' 
      });
    }

    if (!pairIndex && pairIndex !== 0) {
      return res.status(400).json({ 
        error: 'pairIndex is required' 
      });
    }

    console.log(`[API] Closing position ${pairIndex} for user ${userFid || 'unknown'}`);
    
    // For Avantis: Call Avantis service
    // Get Avantis API URL at runtime
    function getAvantisApiUrl(): string {
      return process.env.AVANTIS_API_URL || 'http://localhost:8000';
    }
    const avantisApiUrl = getAvantisApiUrl();
    try {
      const response = await fetch(`${avantisApiUrl}/api/close-position`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pair_index: pairIndex,
          private_key: privateKey,
        }),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: response.statusText })) as { detail?: string };
        throw new Error(errorData.detail || `Avantis API error: ${response.statusText}`);
      }

      const result = await response.json() as { tx_hash?: string; message?: string };
      res.json({
        success: true,
        message: result.message || 'Position closed successfully',
        tx_hash: result.tx_hash,
        details: result
      });
    } catch (avantisError) {
      console.error('[API] Error calling Avantis service:', avantisError);
      res.status(400).json({ 
        success: false,
        error: avantisError instanceof Error ? avantisError.message : 'Failed to close position'
      });
    }
  } catch (error) {
    console.error('[API] Error closing position:', error);
    res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Get prices (lightweight endpoint for real-time updates)
app.get('/api/prices', async (req, res) => {
  try {
    const { symbols } = req.query;
    
    if (!symbols || typeof symbols !== 'string') {
      return res.status(400).json({ 
        error: 'symbols parameter is required (comma-separated list)',
        prices: {}
      });
    }
    
    // Get Avantis API URL at runtime
    const avantisApiUrl = process.env.AVANTIS_API_URL || 'http://localhost:8000';
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const avantisResponse = await fetch(`${avantisApiUrl}/api/prices?symbols=${encodeURIComponent(symbols)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (avantisResponse && avantisResponse.ok) {
        const data = await avantisResponse.json();
        return res.json(data);
      } else {
        console.warn(`[API] Avantis service returned status ${avantisResponse?.status} for prices`);
        return res.json({ prices: {} });
      }
    } catch (fetchError) {
      console.error('[API] Error fetching prices from Avantis service:', fetchError);
      return res.json({ prices: {} }); // Return empty prices on error
    }
  } catch (error) {
    console.error('[API] Error in /api/prices:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      prices: {}
    });
  }
});

// Get positions
app.get('/api/positions', async (req, res) => {
  try {
    const { privateKey } = req.query;
    
    // Private key is required for backend wallet trading
    if (!privateKey) {
      return res.status(400).json({ 
        error: 'Private key is required for backend wallet trading',
        positions: [],
        totalPnL: 0,
        openPositions: 0
      });
    }
    
    // Get positions from Avantis service using private key
    const avantisApiUrl = process.env.AVANTIS_API_URL || 'http://localhost:8000';
    
    // Check if Avantis service is available before making request
    // This prevents log spam from connection refused errors
    try {
      // Quick health check (with short timeout)
      const healthController = new AbortController();
      const healthTimeout = setTimeout(() => healthController.abort(), 2000); // 2 second timeout for health check
      
      const healthResponse = await fetch(`${avantisApiUrl}/health`, {
        method: 'GET',
        signal: healthController.signal,
      }).catch(() => null);
      
      clearTimeout(healthTimeout);
      
      if (!healthResponse || !healthResponse.ok) {
        // Avantis service not available - return empty positions instead of error
        console.log(`[API] Avantis service not available at ${avantisApiUrl}, returning empty positions`);
        return {
          positions: [],
          totalPnL: 0,
          openPositions: 0
        };
      }
    } catch (healthError) {
      // Service not available - return empty positions
      console.log(`[API] Avantis service health check failed, returning empty positions`);
      return {
        positions: [],
        totalPnL: 0,
        openPositions: 0
      };
    }
    
    // Add timeout to prevent hanging (45 seconds to allow for RPC rate limiting)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 second timeout
    
    try {
      const avantisResponse = await fetch(`${avantisApiUrl}/api/positions?private_key=${encodeURIComponent(privateKey as string)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (avantisResponse && avantisResponse.ok) {
        const avantisData = await avantisResponse.json() as { positions?: Array<{
          pair_index: number;
          index?: number;
          symbol: string;
          is_long: boolean;
          collateral: number;
          position_size?: number;
          leverage: number;
          entry_price: number;
          current_price: number;
          pnl: number;
          pnl_percentage: number;
          liquidation_price?: number;
          take_profit?: number;
          stop_loss?: number;
        }> };
        
        // Transform Avantis positions to match expected format
        const positions = (avantisData.positions || []).map(pos => ({
          coin: pos.symbol,
          symbol: pos.symbol,
          pair_index: pos.pair_index,
          index: pos.index || 0,  // Trade index for closing
          size: (pos.position_size || (pos.collateral * pos.leverage)).toString(),
          side: pos.is_long ? 'long' : 'short',
          entryPrice: pos.entry_price,
          markPrice: pos.current_price,
          pnl: pos.pnl,
          roe: pos.pnl_percentage || (pos.entry_price > 0 ? (pos.pnl / (pos.collateral * pos.leverage)) * 100 : 0),
          positionValue: pos.position_size || (pos.collateral * pos.leverage),
          margin: pos.collateral.toString(),
          leverage: pos.leverage.toString(),
          liquidationPrice: pos.liquidation_price || null,
          collateral: pos.collateral,
          takeProfit: pos.take_profit || null,
          stopLoss: pos.stop_loss || null
        }));
        
        const totalPnL = positions.reduce((sum, pos) => sum + (pos.pnl || 0), 0);
        const openPositions = positions.length;
        
        console.log(`[API] Retrieved ${openPositions} positions from Avantis`);
        return res.json({
          positions,
          totalPnL,
          openPositions
        });
      } else if (avantisResponse && avantisResponse.status === 429) {
        // Handle rate limit errors gracefully
        const errorData = await avantisResponse.json().catch(() => ({})) as { retry_after?: number };
        const retryAfter = errorData.retry_after || 2;
        
        console.warn(`[API] Rate limited by Avantis service, retrying after ${retryAfter}s`);
        
        // Retry once after the specified delay
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        
        // Retry the request
        const retryController = new AbortController();
        const retryTimeoutId = setTimeout(() => retryController.abort(), 45000);
        
        try {
          const retryResponse = await fetch(`${avantisApiUrl}/api/positions?private_key=${encodeURIComponent(privateKey as string)}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
            signal: retryController.signal,
          });
          
          clearTimeout(retryTimeoutId);
          
          if (retryResponse && retryResponse.ok) {
            const retryData = await retryResponse.json() as { positions?: Array<any> };
            const positions = (retryData.positions || []).map(pos => ({
              coin: pos.symbol,
              symbol: pos.symbol,
              pair_index: pos.pair_index,
              index: pos.index || 0,
              size: (pos.position_size || (pos.collateral * pos.leverage)).toString(),
              side: pos.is_long ? 'long' : 'short',
              entryPrice: pos.entry_price,
              markPrice: pos.current_price,
              pnl: pos.pnl,
              roe: pos.pnl_percentage || (pos.entry_price > 0 ? (pos.pnl / (pos.collateral * pos.leverage)) * 100 : 0),
              positionValue: pos.position_size || (pos.collateral * pos.leverage),
              margin: pos.collateral.toString(),
              leverage: pos.leverage.toString(),
              liquidationPrice: pos.liquidation_price || null,
              collateral: pos.collateral,
              takeProfit: pos.take_profit || null,
              stopLoss: pos.stop_loss || null
            }));
            
            const totalPnL = positions.reduce((sum, pos) => sum + (pos.pnl || 0), 0);
            const openPositions = positions.length;
            
            console.log(`[API] Retrieved ${openPositions} positions from Avantis (after retry)`);
            return res.json({
              positions,
              totalPnL,
              openPositions
            });
          }
        } catch (retryError) {
          clearTimeout(retryTimeoutId);
          // If retry also fails, return empty positions instead of error
          console.warn(`[API] Retry after rate limit also failed, returning empty positions`);
          return res.json({
            positions: [],
            totalPnL: 0,
            openPositions: 0
          });
        }
      } else {
        const errorText = await avantisResponse.text().catch(() => 'Unknown error');
        throw new Error(`Avantis API error: ${errorText}`);
      }
    } catch (avantisError) {
      clearTimeout(timeoutId);
      
      // Handle timeout and connection errors gracefully
      if (avantisError instanceof Error) {
        if (avantisError.name === 'AbortError' || avantisError.message.includes('timeout')) {
          console.warn('[API] ⚠️ Timeout fetching positions from Avantis - service may be slow');
          console.warn('[API] ⚠️ Returning empty positions - trading can continue');
          return res.json({
            positions: [],
            totalPnL: 0,
            openPositions: 0,
            warning: 'Avantis service timeout - positions unavailable'
          });
        } else if (avantisError.message.includes('ECONNREFUSED') || avantisError.message.includes('other side closed')) {
          console.warn('[API] ⚠️ Avantis service connection refused or closed');
          console.warn(`[API] ⚠️ Check if Avantis service is running on ${avantisApiUrl}`);
          return res.json({
            positions: [],
            totalPnL: 0,
            openPositions: 0,
            warning: 'Avantis service unavailable - positions unavailable'
          });
        }
      }
      
      console.error('[API] Error fetching positions from Avantis:', avantisError);
      res.status(500).json({ 
        error: avantisError instanceof Error ? avantisError.message : 'Failed to fetch positions from Avantis',
        positions: [],
        totalPnL: 0,
        openPositions: 0
      });
    }
  } catch (error) {
    console.error('[API] Error getting positions:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      positions: [],
      totalPnL: 0,
      openPositions: 0
    });
  }
});

// Prepare transaction for Base Account signing (without executing)
app.post('/api/trading/prepare-transaction', async (req, res) => {
  try {
    const {
      sessionId,
      action, // 'open' or 'close'
      symbol,
      collateral,
      leverage,
      is_long,
      pair_index, // For close action
      tp, // Take profit (optional)
      sl, // Stop loss (optional)
    } = req.body;

    // Validate input
    if (!sessionId || !action) {
      return res.status(400).json({
        error: 'Missing required parameters: sessionId and action are required'
      });
    }

    // Get session info
    const status = sessionManager.getSessionStatus(sessionId);
    if (!status) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // This endpoint is deprecated - all trading now uses trading wallet with private key
    return res.status(400).json({
      error: 'This endpoint is deprecated. All trading now uses trading wallet with private key. Use regular trading endpoints.'
    });
  } catch (error) {
    console.error('[API] Error preparing transaction:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Get trading configuration
app.get('/api/trading/config', (req, res) => {
  try {
    const config = {
      defaultMaxBudget: process.env.DEFAULT_MAX_BUDGET || 1000,
      defaultProfitGoal: process.env.DEFAULT_PROFIT_GOAL || 100,
      defaultMaxPositions: process.env.DEFAULT_MAX_POSITIONS || 1,
      minBudget: 10,
      maxBudget: 10000000,
      minPositions: 1,
      maxPositions: 20
    };
    
    res.json(config);
  } catch (error) {
    console.error('[API] Error getting trading config:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
});

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[API] Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[API] Received SIGTERM, shutting down gracefully');
  sessionManager.cleanup();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[API] Received SIGINT, shutting down gracefully');
  sessionManager.cleanup();
  process.exit(0);
});

// Start server
const port = getPort();
app.listen(port, () => {
  console.log(`[API] Trading API server running on port ${port}`);
  console.log(`[API] Health check: http://localhost:${port}/api/health`);
}).on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[API] ❌ Port ${port} is already in use`);
  } else if (err.code === 'EPERM') {
    console.error(`[API] ❌ Permission denied to bind to port ${port}`);
    console.error(`[API] ❌ Try running with sudo or use a different port`);
  } else {
    console.error(`[API] ❌ Error starting server:`, err);
  }
  process.exit(1);
});

export { sessionManager };
