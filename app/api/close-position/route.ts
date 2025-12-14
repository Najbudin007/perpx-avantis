import { NextRequest, NextResponse } from 'next/server'
import { AvantisClient } from '@/lib/services/AvantisClient'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'
import { WebWalletService } from '@/lib/services/WebWalletService'

// Lazy initialization - create services at runtime, not build time
function getFarcasterWalletService(): BaseAccountWalletService {
  return new BaseAccountWalletService()
}

function getWebWalletService(): WebWalletService {
  return new WebWalletService()
}

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    let authContext
    try {
      authContext = await verifyTokenAndGetContext(token)
    } catch (authError) {
      return NextResponse.json({ 
        error: authError instanceof Error ? authError.message : 'Invalid token. Please log in again.' 
      }, { status: 401 })
    }
    
    // Parse request body - Avantis uses pair_index instead of symbol
    const { pair_index, trade_index, symbol } = await request.json()
    
    // pair_index is required for Avantis
    if (!pair_index && !symbol) {
      return NextResponse.json({ 
        error: 'pair_index is required (Avantis uses pair indices, not symbols)' 
      }, { status: 400 })
    }
    
    // trade_index defaults to 0 if not provided (for backward compatibility)
    const tradeIndex = trade_index !== undefined && trade_index !== null ? trade_index : 0

    // Get user's wallet for private key based on context
    let wallet: { address: string; privateKey: string } | null = null
    let userId: string | number
    
    if (authContext.context === 'farcaster') {
      // Farcaster user
      if (!authContext.fid) {
        return NextResponse.json(
          { error: 'Base Account (FID) required' },
          { status: 400 }
        )
      }
      
      userId = authContext.fid
      const farcasterWalletService = getFarcasterWalletService()
      // CRITICAL: Use getWalletWithKey() first to get existing wallet, only create if missing
      // This ensures we always use the SAME wallet address (prevents inconsistency)
      let farcasterWallet = await farcasterWalletService.getWalletWithKey(authContext.fid, 'ethereum')
      
      if (!farcasterWallet || !farcasterWallet.privateKey) {
        // Wallet doesn't exist or has no private key - create it (only for first-time users)
        console.log(`[ClosePosition] ⚠️ No existing trading wallet found for FID ${authContext.fid}, creating one...`)
        farcasterWallet = await farcasterWalletService.ensureTradingWallet(authContext.fid)
      }
      
      if (!farcasterWallet || !farcasterWallet.privateKey) {
        console.error(`[ClosePosition] Failed to get/create trading wallet for FID ${authContext.fid}`)
        return NextResponse.json({ 
          error: 'No trading wallet found. Please ensure your trading wallet is properly set up.' 
        }, { status: 404 })
      }
      
      wallet = {
        address: farcasterWallet.address,
        privateKey: farcasterWallet.privateKey
      }
      console.log(`[ClosePosition] Using trading wallet: ${wallet.address} for FID: ${authContext.fid}`)
    } else {
      // Web user
      if (!authContext.webUserId) {
        return NextResponse.json(
          { error: 'Web user ID required' },
          { status: 400 }
        )
      }
      
      userId = authContext.webUserId
      const webWalletService = getWebWalletService()
      // CRITICAL: Get existing wallet first to ensure consistency (same pattern as Farcaster)
      let webWallet = await webWalletService.getWallet(authContext.webUserId, 'ethereum')
      
      if (!webWallet) {
        // Wallet doesn't exist - create it (only for first-time users)
        console.log(`[ClosePosition] ⚠️ No existing trading wallet found for web user ${authContext.webUserId}, creating one...`)
        webWallet = await webWalletService.ensureTradingWallet(authContext.webUserId)
      }
      
      if (!webWallet) {
        return NextResponse.json({ 
          error: 'No trading wallet found. Please ensure your trading wallet is properly set up.' 
        }, { status: 404 })
      }
      
      const privateKey = await webWalletService.getPrivateKey(authContext.webUserId, 'ethereum')
      if (!privateKey) {
        console.error(`[ClosePosition] Failed to get private key for web user ${authContext.webUserId}`)
        return NextResponse.json({ 
          error: 'Wallet private key not available. Please ensure your trading wallet is properly set up.' 
        }, { status: 404 })
      }
      
      wallet = {
        address: webWallet.address,
        privateKey: privateKey
      }
      console.log(`[ClosePosition] Using trading wallet: ${wallet.address} for web user: ${authContext.webUserId}`)
    }

    if (!wallet || !wallet.privateKey) {
      return NextResponse.json({ 
        error: 'No wallet found with private key' 
      }, { status: 404 })
    }

    // If symbol provided, we need to resolve it to pair_index
    // For now, require pair_index directly
    // Handle pair_index === 0 correctly (0 is a valid pair index)
    let pairIndex: number | undefined
    if (pair_index !== undefined && pair_index !== null) {
      pairIndex = typeof pair_index === 'number' ? pair_index : parseInt(pair_index)
    } else if (symbol !== undefined && symbol !== null) {
      pairIndex = parseInt(symbol) // Fallback: try parsing symbol as number
    }
    
    // Explicitly check for undefined, null, or NaN (not falsy, since 0 is valid)
    if (pairIndex === undefined || pairIndex === null || isNaN(pairIndex)) {
      return NextResponse.json({ 
        error: 'Valid pair_index is required. Please provide the pair_index from the position data.' 
      }, { status: 400 })
    }

    console.log(`[ClosePosition] Closing position with pair_index ${pairIndex}, trade_index ${tradeIndex} for ${authContext.context} user:`, userId)
    console.log(`[ClosePosition] Wallet address: ${wallet.address}`)
    console.log(`[ClosePosition] Private key available: ${wallet.privateKey ? `${wallet.privateKey.slice(0, 10)}...${wallet.privateKey.slice(-4)}` : 'MISSING'}`)

    // Use AvantisClient to call backend FastAPI directly (direct contract integration)
    const avantisApiUrl = process.env.NEXT_PUBLIC_AVANTIS_API_URL || 'http://localhost:8000'
    const avantisClient = new AvantisClient({ 
      baseUrl: avantisApiUrl,
      privateKey: wallet.privateKey 
    })
    
    try {
      // Pass private key and trade_index explicitly to ensure it's used
      const result = await avantisClient.closePosition(pairIndex, wallet.privateKey, tradeIndex)
      
      console.log(`[ClosePosition] Successfully closed position for pair_index ${pairIndex}`)
      return NextResponse.json({
        success: true,
        tx_hash: result.transaction_hash,
        message: result.message || 'Position closed successfully'
      })
    } catch (error) {
      console.error(`[ClosePosition] Failed to close position for pair_index ${pairIndex}:`, error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to close position'
      
      // Provide more detailed error message for all users (especially Farcaster)
      let userFriendlyError = errorMessage
      if (errorMessage.includes('No trading wallet') || errorMessage.includes('No wallet found')) {
        userFriendlyError = 'Trading wallet not found. Please restart your trading session or ensure your wallet is set up.'
      } else if (errorMessage.includes('No open trade found') || errorMessage.includes('No open position')) {
        userFriendlyError = 'Position not found. It may have already been closed.'
      } else if (errorMessage.includes('execution reverted') || errorMessage.includes('revert')) {
        userFriendlyError = 'Transaction failed on blockchain. Please try again.'
      } else if (errorMessage.includes('private key') || errorMessage.includes('Private key')) {
        userFriendlyError = 'Wallet authentication failed. Please ensure your trading wallet is properly set up.'
      } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        userFriendlyError = 'Authentication failed. Please refresh your session and try again.'
      }
      
      return NextResponse.json({
        success: false,
        error: userFriendlyError,
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      }, { status: 400 })
    }

  } catch (error) {
    console.error('[ClosePosition] Error closing position:', error)
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Failed to close position'
      },
      { status: 500 }
    )
  }
}
