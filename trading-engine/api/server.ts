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

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://avantis.superapp.gg'] 
    : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));
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

    // Validate input
    if (!maxBudget || !profitGoal || !maxPerSession) {
      return res.status(400).json({ 
        error: 'Missing required parameters: maxBudget, profitGoal, maxPerSession' 
      });
    }

    // Private key and wallet address are required for automated trading
    const privateKey = avantisApiWallet || hyperliquidApiWallet;
    if (!privateKey || !walletAddress) {
      return res.status(400).json({ 
        error: 'Missing required wallet data: avantisApiWallet (or hyperliquidApiWallet) and walletAddress are required' 
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
    
    const sessionId = await sessionManager.startSession({
      maxBudget: parseFloat(maxBudget),
      profitGoal: parseFloat(profitGoal),
      maxPerSession: parseInt(maxPerSession),
      lossThreshold: parseFloat(lossThreshold),
      userPhoneNumber: userPhoneNumber || undefined,
      walletAddress,
      privateKey: privateKey // Store private key per-session for Avantis trading
    });

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
      return process.env.AVANTIS_API_URL || 'http://localhost:3002';
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
      return process.env.AVANTIS_API_URL || 'http://localhost:3002';
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
    const avantisApiUrl = process.env.AVANTIS_API_URL || 'http://localhost:3002';
    
    try {
      const avantisResponse = await fetch(`${avantisApiUrl}/api/positions?private_key=${encodeURIComponent(privateKey as string)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (avantisResponse && avantisResponse.ok) {
        const avantisData = await avantisResponse.json() as { positions?: Array<{
          pair_index: number;
          symbol: string;
          is_long: boolean;
          collateral: number;
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
          size: (pos.collateral * pos.leverage).toString(),
          side: pos.is_long ? 'long' : 'short',
          entryPrice: pos.entry_price,
          markPrice: pos.current_price,
          pnl: pos.pnl,
          roe: pos.pnl_percentage || (pos.entry_price > 0 ? (pos.pnl / (pos.collateral * pos.leverage)) * 100 : 0),
          positionValue: pos.collateral * pos.leverage,
          margin: pos.collateral.toString(),
          leverage: pos.leverage.toString(),
          liquidationPrice: pos.liquidation_price || null, // Include liquidation price from Avantis
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
      } else {
        const errorText = await avantisResponse.text().catch(() => 'Unknown error');
        throw new Error(`Avantis API error: ${errorText}`);
      }
    } catch (avantisError) {
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
});

export { sessionManager };
