import { NextRequest, NextResponse } from 'next/server'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'
import { WebWalletService } from '@/lib/services/WebWalletService'

// Simple logging function for debugging (in-memory, for development only)
const debugLogs: Array<{ timestamp: Date; requestId: string; message: string; data?: any }> = []
function addLog(requestId: string, message: string, data?: any) {
  debugLogs.push({ timestamp: new Date(), requestId, message, data })
  if (debugLogs.length > 50) debugLogs.shift()
}

// Lazy initialization - create services at runtime, not build time
function getFarcasterWalletService(): BaseAccountWalletService {
  return new BaseAccountWalletService()
}

function getWebWalletService(): WebWalletService {
  return new WebWalletService()
}

export async function POST(request: NextRequest) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  console.log(`[API] [${requestId}] Trading start endpoint called`);
  addLog(requestId, 'Trading start endpoint called');
  
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error(`[API] [${requestId}] Missing or invalid authorization header`);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    
    // Validate token format (basic check)
    if (!token || token.length < 10) {
      console.error('[API] Token appears to be invalid (too short or empty)')
      return NextResponse.json(
        { error: 'Invalid token format. Please refresh your session.' },
        { status: 401 }
      )
    }
    
    // Verify token and get context (supports both Farcaster and web users)
    let authContext
    try {
      console.log(`[API] [${requestId}] Verifying token, length:`, token.length, 'starts with:', token.substring(0, 20))
      console.log(`[API] [${requestId}] Token ends with:`, token.substring(token.length - 20))
      authContext = await verifyTokenAndGetContext(token)
      console.log(`[API] [${requestId}] ✅ Token verified successfully, context:`, authContext.context, 'fid:', authContext.fid, 'webUserId:', authContext.webUserId)
      addLog(requestId, 'Token verified', { context: authContext.context, fid: authContext.fid, webUserId: authContext.webUserId })
    } catch (authError) {
      console.error(`[API] [${requestId}] ❌ Token verification failed:`, authError)
      console.error(`[API] [${requestId}] Error type:`, authError instanceof Error ? authError.constructor.name : typeof authError)
      console.error(`[API] [${requestId}] Error message:`, authError instanceof Error ? authError.message : String(authError))
      console.error(`[API] [${requestId}] Error stack:`, authError instanceof Error ? authError.stack : 'No stack trace')
      const errorMessage = authError instanceof Error ? authError.message : 'Token verification failed'
      
      // Return appropriate error based on the type of authentication failure
      if (errorMessage.includes('expired') || errorMessage.includes('Token expired')) {
        return NextResponse.json(
          { error: 'Token expired. Please refresh your session and try again.' },
          { status: 401 }
        )
      }
      
      if (errorMessage.includes('Invalid token') || errorMessage.includes('invalid')) {
        return NextResponse.json(
          { error: 'Invalid authentication token. Please log in again.' },
          { status: 401 }
        )
      }
      
      // More detailed error for debugging
      // Check if it's a token expiration issue
      if (errorMessage.includes('expired') || errorMessage.includes('Token expired')) {
        return NextResponse.json(
          { 
            error: 'Your session has expired. Please refresh the app to re-authenticate.',
            code: 'TOKEN_EXPIRED'
          },
          { status: 401 }
        )
      }
      
      // Check if it's an invalid token issue
      if (errorMessage.includes('Invalid token') || errorMessage.includes('invalid')) {
        return NextResponse.json(
          { 
            error: 'Invalid authentication token. Please refresh the app to re-authenticate.',
            code: 'INVALID_TOKEN'
          },
          { status: 401 }
        )
      }
      
      return NextResponse.json(
        { 
          error: 'Unauthorized: Authentication failed. Please refresh the app to re-authenticate.',
          code: 'AUTH_FAILED',
          details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
        },
        { status: 401 }
      )
    }
    
    // Parse request body
    const config = await request.json()
    console.log(`[API] [${requestId}] Trading config:`, {
      totalBudget: config.totalBudget,
      investmentAmount: config.investmentAmount,
      maxBudget: config.maxBudget,
      profitGoal: config.profitGoal,
      targetProfit: config.targetProfit,
      maxPositions: config.maxPositions,
      maxPerSession: config.maxPerSession,
      lossThreshold: config.lossThreshold
    })
    
    // Get trading wallet based on user context
    let wallet: { address: string; privateKey: string } | null = null
    let userId: string | number
    
    if (authContext.context === 'farcaster') {
      // Farcaster user
      if (!authContext.fid) {
        console.error('[API] No FID in token payload')
        return NextResponse.json(
          { error: 'User authentication (FID) required.' },
          { status: 400 }
        )
      }
      
      userId = authContext.fid
      const farcasterWalletService = getFarcasterWalletService()
      const farcasterWallet = await farcasterWalletService.ensureTradingWallet(authContext.fid)
      
      if (!farcasterWallet || !farcasterWallet.privateKey) {
        console.error('[API] Failed to get trading wallet with private key for FID:', authContext.fid)
        return NextResponse.json(
          { error: 'No trading wallet found. Please ensure your trading wallet is properly set up.' },
          { status: 404 }
        )
      }
      
      wallet = {
        address: farcasterWallet.address,
        privateKey: farcasterWallet.privateKey
      }
      console.log(`[API] [${requestId}] ✅ Using trading wallet for automated trading:`, wallet.address, 'for FID:', authContext.fid)
      console.log(`[API] [${requestId}] Private key available:`, farcasterWallet.privateKey ? `${farcasterWallet.privateKey.slice(0, 10)}...${farcasterWallet.privateKey.slice(-4)}` : 'MISSING')
      
      // CRITICAL: Verify the private key matches the wallet address
      if (farcasterWallet.privateKey) {
        const { ethers } = await import('ethers');
        const derivedWallet = new ethers.Wallet(farcasterWallet.privateKey);
        const derivedAddress = derivedWallet.address;
        if (derivedAddress.toLowerCase() !== farcasterWallet.address.toLowerCase()) {
          console.error(`[API] [${requestId}] ❌ CRITICAL: Private key does NOT match wallet address!`);
          console.error(`[API] [${requestId}] Wallet address from DB: ${farcasterWallet.address}`);
          console.error(`[API] [${requestId}] Address from private key: ${derivedAddress}`);
          console.error(`[API] [${requestId}] This will cause funds to go to the wrong address!`);
          return NextResponse.json({
            success: false,
            error: 'Wallet address mismatch: Private key does not match stored wallet address. Please contact support.'
          }, { status: 500 });
        }
        console.log(`[API] [${requestId}] ✅ Verified: Private key matches wallet address`);
      }
      
      addLog(requestId, 'Trading wallet loaded', { address: wallet.address, hasPrivateKey: !!farcasterWallet.privateKey })
    } else {
      // Web user
      if (!authContext.webUserId) {
        console.error('[API] No webUserId in token payload')
        return NextResponse.json(
          { error: 'User authentication (webUserId) required.' },
          { status: 400 }
        )
      }
      
      userId = authContext.webUserId
      const webWalletService = getWebWalletService()
      const webWallet = await webWalletService.ensureTradingWallet(authContext.webUserId)
      
      if (!webWallet) {
        console.error('[API] Failed to get trading wallet for webUserId:', authContext.webUserId)
        return NextResponse.json(
          { error: 'No trading wallet found. Please ensure your trading wallet is properly set up.' },
          { status: 404 }
        )
      }
      
      const privateKey = await webWalletService.getPrivateKey(authContext.webUserId, 'ethereum')
      if (!privateKey) {
        console.error('[API] Failed to get private key for webUserId:', authContext.webUserId)
        return NextResponse.json(
          { error: 'Trading wallet private key not available.' },
          { status: 404 }
        )
      }
      
      wallet = {
        address: webWallet.address,
        privateKey: privateKey
      }
      console.log('[API] Using trading wallet for automated trading:', wallet.address, 'for webUserId:', authContext.webUserId)
    }
    
    if (!wallet || !wallet.privateKey) {
      return NextResponse.json(
        { error: 'No trading wallet found. Please ensure your trading wallet is properly set up.' },
        { status: 404 }
      )
    }
    
    const walletAddress = wallet.address
    const privateKey = wallet.privateKey
    console.log('[API] Private key available:', privateKey ? `${privateKey.slice(0, 10)}...${privateKey.slice(-4)}` : 'MISSING')
    
    // Call the trading engine to start trading
    // TRADING_ENGINE_URL can be:
    // 1. Direct service: http://localhost:3001
    // 2. Proxied path: https://avantis.superapp.gg/api/trading-engine
    const tradingEngineUrl = process.env.TRADING_ENGINE_URL || 'http://localhost:3001'
    console.log(`[API] [${requestId}] TRADING_ENGINE_URL from env:`, tradingEngineUrl);
    
    // Clean up URL (remove trailing slash, but KEEP /api/trading-engine if present)
    let cleanUrl = tradingEngineUrl.replace(/\/$/, '');
    console.log(`[API] [${requestId}] Cleaned URL:`, cleanUrl);
    
    // Determine the correct endpoint path
    // Nginx rewrites /api/trading-engine/(.*) to /$1 and proxies to trading-engine
    // So /api/trading-engine/api/trading/start -> nginx rewrites to /api/trading/start -> proxies to trading-engine:3001/api/trading/start
    let tradingEngineEndpoint: string;
    if (cleanUrl.includes('/api/trading-engine')) {
      // Trading engine is behind nginx proxy at /api/trading-engine
      // Full URL: https://avantis.superapp.gg/api/trading-engine/api/trading/start
      // Nginx will rewrite to /api/trading/start and proxy to trading-engine:3001
      tradingEngineEndpoint = `${cleanUrl}/api/trading/start`;
      console.log(`[API] [${requestId}] ✅ Using proxied trading engine URL (via nginx)`);
    } else {
      // Direct trading engine service (no proxy)
      // URL: http://localhost:3001/api/trading/start
      tradingEngineEndpoint = `${cleanUrl}/api/trading/start`;
      console.log(`[API] [${requestId}] ✅ Using direct trading engine URL`);
    }
    
    console.log(`[API] [${requestId}] Trading engine base URL:`, cleanUrl);
    console.log(`[API] [${requestId}] Trading engine endpoint:`, tradingEngineEndpoint);
    
    // Safety check: ensure we're calling the trading engine, not Next.js route
    if (tradingEngineEndpoint.includes('avantis.superapp.gg') && !tradingEngineEndpoint.includes('/api/trading-engine')) {
      console.error(`[API] [${requestId}] ❌ ERROR: Endpoint URL is missing /api/trading-engine prefix!`);
      console.error(`[API] [${requestId}] This will route to Next.js /api/trading/start instead of trading engine!`);
      console.error(`[API] [${requestId}] Expected: https://avantis.superapp.gg/api/trading-engine/api/trading/start`);
      console.error(`[API] [${requestId}] Actual:`, tradingEngineEndpoint);
      return NextResponse.json({ 
        success: false, 
        error: 'Trading engine URL configuration error: Missing /api/trading-engine prefix. Please check TRADING_ENGINE_URL environment variable.' 
      }, { status: 500 });
    }
    
    // Safety check: ensure we're calling the trading engine, not Next.js route
    try {
      const endpointUrl = new URL(tradingEngineEndpoint);
      const endpointPath = endpointUrl.pathname;
      
      // If using avantis.superapp.gg domain, MUST include /api/trading-engine prefix
      if (endpointUrl.hostname.includes('avantis.superapp.gg') && !endpointPath.includes('/api/trading-engine')) {
        console.error(`[API] [${requestId}] ❌ ERROR: Endpoint URL is missing /api/trading-engine prefix!`);
        console.error(`[API] [${requestId}] This will route to Next.js /api/trading/start instead of trading engine!`);
        console.error(`[API] [${requestId}] TRADING_ENGINE_URL from env:`, tradingEngineUrl);
        console.error(`[API] [${requestId}] Cleaned URL:`, cleanUrl);
        console.error(`[API] [${requestId}] Expected: https://avantis.superapp.gg/api/trading-engine/api/trading/start`);
        console.error(`[API] [${requestId}] Actual:`, tradingEngineEndpoint);
        return NextResponse.json({ 
          success: false, 
          error: 'Trading engine URL configuration error: Missing /api/trading-engine prefix. TRADING_ENGINE_URL must be set to https://avantis.superapp.gg/api/trading-engine (not just the domain).' 
        }, { status: 500 });
      }
    } catch (urlError) {
      console.error(`[API] [${requestId}] Error parsing trading engine URL:`, urlError);
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid trading engine URL configuration.' 
      }, { status: 500 });
    }
    
    console.log(`[API] [${requestId}] 📡 Calling trading engine at:`, tradingEngineEndpoint);
    addLog(requestId, 'Calling trading engine', { url: tradingEngineEndpoint })
    console.log(`[API] [${requestId}] Request payload (private key masked):`, {
      maxBudget: config.totalBudget || config.investmentAmount || config.maxBudget,
      profitGoal: config.profitGoal || config.targetProfit,
      maxPerSession: config.maxPositions || config.maxPerSession || 1,
      lossThreshold: config.lossThreshold || 10,
      avantisApiWallet: privateKey ? `${privateKey.slice(0, 10)}...${privateKey.slice(-4)}` : 'MISSING',
      userFid: authContext.context === 'farcaster' ? authContext.fid : undefined,
      webUserId: authContext.context === 'web' ? authContext.webUserId : undefined,
      walletAddress: walletAddress,
    });
    
    let response;
    try {
      response = await fetch(tradingEngineEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          maxBudget: config.totalBudget || config.investmentAmount || config.maxBudget,
          profitGoal: config.profitGoal || config.targetProfit,
          maxPerSession: config.maxPositions || config.maxPerSession || 1,
          lossThreshold: config.lossThreshold || 10,
          avantisApiWallet: privateKey, // Private key for Avantis trading
          userFid: authContext.context === 'farcaster' ? authContext.fid : undefined, // FID for Farcaster users
          userPhoneNumber: authContext.context === 'web' ? undefined : undefined, // Not used for web users
          webUserId: authContext.context === 'web' ? authContext.webUserId : undefined, // Web user ID
          walletAddress: walletAddress, // Trading wallet address
        }),
        // Add timeout to prevent hanging
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });
    } catch (fetchError) {
      // Handle network errors (connection refused, timeout, etc.)
      console.error('[API] Failed to connect to trading engine:', fetchError);
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown network error';
      
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
        return NextResponse.json({ 
          success: false, 
          error: `Trading engine is not accessible. Please ensure the trading engine is running at ${cleanUrl}. Error: ${errorMessage}` 
        }, { status: 502 });
      }
      
      if (errorMessage.includes('timeout') || errorMessage.includes('AbortError')) {
        return NextResponse.json({ 
          success: false, 
          error: `Trading engine request timed out. Please check if the trading engine is running and try again.` 
        }, { status: 504 });
      }
      
      return NextResponse.json({ 
        success: false, 
        error: `Failed to connect to trading engine: ${errorMessage}` 
      }, { status: 502 });
    }

    console.log(`[API] [${requestId}] Trading engine response status:`, response.status, response.statusText);
    addLog(requestId, 'Trading engine response', { status: response.status, statusText: response.statusText })
    
    if (!response.ok) {
      let errorData;
      // Read response as text first, then try to parse as JSON
      // This avoids "Body has already been read" error
      const responseText = await response.text();
      console.error(`[API] [${requestId}] ❌ Trading engine returned error status:`, response.status);
      console.error(`[API] [${requestId}] Trading engine error response text:`, responseText);
      addLog(requestId, 'Trading engine error', { status: response.status, error: responseText })
      try {
        errorData = JSON.parse(responseText);
      } catch (parseError) {
        // If response is not JSON (e.g., HTML error page), create a generic error
        console.error('[API] Non-JSON response from trading engine:', responseText.substring(0, 200))
        errorData = { error: `Trading engine error: ${response.status} ${response.statusText}` }
      }
      console.error('[API] Trading engine returned error:', errorData);
      
      // If trading engine returns 401, it's an authentication issue with the trading engine
      if (response.status === 401) {
        return NextResponse.json({ 
          success: false, 
          error: 'Trading engine authentication failed. Please check your wallet configuration.' 
        }, { status: 401 })
      }
      
      return NextResponse.json({ 
        success: false, 
        error: errorData.error || `Failed to start trading (${response.status}): ${response.statusText}` 
      }, { status: response.status })
    }

    let result;
    try {
      result = await response.json();
    } catch (parseError) {
      const responseText = await response.text().catch(() => 'Unable to read response');
      console.error('[API] Failed to parse trading engine response as JSON:', responseText.substring(0, 200));
      return NextResponse.json({ 
        success: false, 
        error: 'Trading engine returned invalid response. Please check if the trading engine is running correctly.' 
      }, { status: 502 });
    }
    
    console.log(`[API] [${requestId}] Trading engine response:`, JSON.stringify(result, null, 2));
    addLog(requestId, 'Trading engine response received', { hasSessionId: !!result.sessionId, hasError: !!result.error })
    
    // Check if trading engine returned an error in the response body
    if (result.error) {
      console.error(`[API] [${requestId}] ❌ Trading engine returned error in response body:`, result.error);
      addLog(requestId, 'Trading engine error in response', { error: result.error })
      return NextResponse.json({ 
        success: false, 
        error: result.error || 'Trading engine returned an error. Please try again.' 
      }, { status: 500 });
    }
    
    // Check if sessionId is missing
    if (!result.sessionId) {
      console.error(`[API] [${requestId}] ❌ Trading engine response missing sessionId. Full response:`, JSON.stringify(result, null, 2));
      addLog(requestId, 'Missing sessionId in response', { response: result })
      return NextResponse.json({ 
        success: false, 
        error: 'Trading engine did not return a session ID. The trading engine may not be properly configured. Please check the trading engine logs.' 
      }, { status: 500 });
    }
    
    console.log(`[API] [${requestId}] ✅ Trading session started successfully:`, result.sessionId);
    addLog(requestId, 'Trading session started', { sessionId: result.sessionId })
    return NextResponse.json({
      success: true,
      sessionId: result.sessionId,
      ...result
    })
  } catch (error) {
    console.error(`[API] [${requestId}] ❌ Error starting trading:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[API] [${requestId}] Error details:`, {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    });
    return NextResponse.json(
      { success: false, error: `Failed to start trading: ${errorMessage}` },
      { status: 500 }
    )
  }
}