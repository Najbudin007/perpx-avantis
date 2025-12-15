import { NextRequest, NextResponse } from 'next/server'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'

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

export async function POST(request: NextRequest) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  addLog(requestId, 'Trading start endpoint called');
  
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    
    // Validate token format (basic check)
    if (!token || token.length < 10) {
      return NextResponse.json(
        { error: 'Invalid token format. Please refresh your session.' },
        { status: 401 }
      )
    }
    
    // Verify Farcaster token
    let authContext
    try {
      authContext = await verifyTokenAndGetContext(token)
      addLog(requestId, 'Token verified', { fid: authContext.fid })
    } catch (authError) {
      const errorMessage = authError instanceof Error ? authError.message : 'Token verification failed'
      
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
    
    // Farcaster users only
    if (!authContext.fid) {
      return NextResponse.json(
        { error: 'User authentication (FID) required.' },
        { status: 400 }
      )
    }
    
    const farcasterWalletService = getFarcasterWalletService()
    const farcasterWallet = await farcasterWalletService.ensureTradingWallet(authContext.fid)
    
    if (!farcasterWallet || !farcasterWallet.privateKey) {
      return NextResponse.json(
        { error: 'No trading wallet found. Please ensure your trading wallet is properly set up.' },
        { status: 404 }
      )
    }
    
    const wallet = {
      address: farcasterWallet.address,
      privateKey: farcasterWallet.privateKey
    }
    
    // Verify the private key matches the wallet address
    if (farcasterWallet.privateKey) {
      const { ethers } = await import('ethers');
      const derivedWallet = new ethers.Wallet(farcasterWallet.privateKey);
      const derivedAddress = derivedWallet.address;
      if (derivedAddress.toLowerCase() !== farcasterWallet.address.toLowerCase()) {
        return NextResponse.json({
          success: false,
          error: 'Wallet address mismatch: Private key does not match stored wallet address. Please contact support.'
        }, { status: 500 });
      }
    }
    
    addLog(requestId, 'Trading wallet loaded', { address: wallet.address })
    
    const walletAddress = wallet.address
    const privateKey = wallet.privateKey
    
    // Call the trading engine to start trading
    const tradingEngineUrl = process.env.TRADING_ENGINE_URL || 'http://localhost:3001'
    let cleanUrl = tradingEngineUrl.replace(/\/$/, '');
    
    const tradingEngineEndpoint = `${cleanUrl}/api/trading/start`;
    
    addLog(requestId, 'Calling trading engine', { url: tradingEngineEndpoint })
    
    // Prepare request payload
    const requestPayload = {
      maxBudget: config.totalBudget || config.investmentAmount || config.maxBudget,
      profitGoal: config.profitGoal || config.targetProfit,
      maxPerSession: config.maxPositions || config.maxPerSession || 1,
      lossThreshold: config.lossThreshold || 10,
      avantisApiWallet: privateKey,
      userFid: authContext.fid,
      walletAddress: walletAddress,
    };
    
    // Validate critical fields before sending
    if (!requestPayload.avantisApiWallet) {
      return NextResponse.json({ 
        success: false, 
        error: 'Private key is missing. Cannot start trading session without private key.' 
      }, { status: 400 });
    }
    
    if (!requestPayload.walletAddress) {
      return NextResponse.json({ 
        success: false, 
        error: 'Wallet address is missing. Cannot start trading session without wallet address.' 
      }, { status: 400 });
    }
    
    let response;
    try {
      response = await fetch(tradingEngineEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(30000)
      });
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown network error';
      
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
        return NextResponse.json({ 
          success: false, 
          error: `Trading engine is not accessible. Please ensure the trading engine is running.` 
        }, { status: 502 });
      }
      
      if (errorMessage.includes('timeout') || errorMessage.includes('AbortError')) {
        return NextResponse.json({ 
          success: false, 
          error: `Trading engine request timed out. Please try again.` 
        }, { status: 504 });
      }
      
      return NextResponse.json({ 
        success: false, 
        error: `Failed to connect to trading engine: ${errorMessage}` 
      }, { status: 502 });
    }

    addLog(requestId, 'Trading engine response', { status: response.status })
    
    if (!response.ok) {
      const responseText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(responseText);
      } catch {
        errorData = { error: `Trading engine error: ${response.status}` }
      }
      
      return NextResponse.json({ 
        success: false, 
        error: errorData.error || `Failed to start trading (${response.status})` 
      }, { status: response.status })
    }

    let result;
    try {
      result = await response.json();
    } catch {
      return NextResponse.json({ 
        success: false, 
        error: 'Trading engine returned invalid response.' 
      }, { status: 502 });
    }
    
    if (result.error) {
      return NextResponse.json({ 
        success: false, 
        error: result.error 
      }, { status: 500 });
    }
    
    if (!result.sessionId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Trading engine did not return a session ID.' 
      }, { status: 500 });
    }
    
    addLog(requestId, 'Trading session started', { sessionId: result.sessionId })
    return NextResponse.json({
      success: true,
      sessionId: result.sessionId,
      ...result
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: `Failed to start trading: ${errorMessage}` },
      { status: 500 }
    )
  }
}
