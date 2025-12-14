import { NextRequest, NextResponse } from 'next/server'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'
import { WebWalletService } from '@/lib/services/WebWalletService'
import { AvantisClient } from '@/lib/services/AvantisClient'

// Lazy initialization - create services at runtime, not build time
function getFarcasterWalletService(): BaseAccountWalletService {
  return new BaseAccountWalletService()
}

function getWebWalletService(): WebWalletService {
  return new WebWalletService()
}

export async function POST(request: NextRequest) {
  try {
    console.log('[API] Close all positions endpoint called')

    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const authContext = await verifyTokenAndGetContext(token)

    // Get user's wallet based on context
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
        console.log(`[CloseAllPositions] ⚠️ No existing trading wallet found for FID ${authContext.fid}, creating one...`)
        farcasterWallet = await farcasterWalletService.ensureTradingWallet(authContext.fid)
      }
      
      if (!farcasterWallet || !farcasterWallet.privateKey) {
        console.error(`[CloseAllPositions] Failed to get/create trading wallet for FID ${authContext.fid}`)
        return NextResponse.json({ 
          error: 'No trading wallet found. Please ensure your trading wallet is properly set up.' 
        }, { status: 404 })
      }
      
      console.log(`[CloseAllPositions] ✅ Using trading wallet: ${farcasterWallet.address} for FID: ${authContext.fid}`)
      
      wallet = {
        address: farcasterWallet.address,
        privateKey: farcasterWallet.privateKey
      }
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
        console.log(`[CloseAllPositions] ⚠️ No existing trading wallet found for web user ${authContext.webUserId}, creating one...`)
        webWallet = await webWalletService.ensureTradingWallet(authContext.webUserId)
      }
      
      if (!webWallet) {
        return NextResponse.json({ 
          error: 'No trading wallet found. Please ensure your trading wallet is properly set up.' 
        }, { status: 404 })
      }
      
      const privateKey = await webWalletService.getPrivateKey(authContext.webUserId, 'ethereum')
      if (!privateKey) {
        console.error(`[CloseAllPositions] Failed to get private key for web user ${authContext.webUserId}`)
        return NextResponse.json({ 
          error: 'Wallet private key not available. Please ensure your trading wallet is properly set up.' 
        }, { status: 404 })
      }
      
      wallet = {
        address: webWallet.address,
        privateKey: privateKey
      }
      console.log(`[CloseAllPositions] ✅ Using trading wallet: ${wallet.address} for web user: ${authContext.webUserId}`)
    }

    if (!wallet || !wallet.privateKey) {
      return NextResponse.json({ 
        error: 'No wallet found with private key' 
      }, { status: 404 })
    }

    console.log(`[CloseAllPositions] Closing all positions for ${authContext.context} user:`, userId)

    // Use AvantisClient to call backend FastAPI directly
    const avantisApiUrl = process.env.NEXT_PUBLIC_AVANTIS_API_URL || 'http://localhost:8000'
    const avantisClient = new AvantisClient({ 
      baseUrl: avantisApiUrl,
      privateKey: wallet.privateKey 
    })
    
    try {
      // First get all positions
      const positions = await avantisClient.getPositions()
      
      if (!positions || positions.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No positions to close',
          closed: 0
        })
      }
      
      console.log(`[CloseAllPositions] Found ${positions.length} positions to close`)
      
      // Close each position
      const results: Array<{ pair_index: number; success: boolean; error?: string }> = []
      
      for (const position of positions) {
        try {
          const result = await avantisClient.closePosition(position.pair_index, wallet.privateKey)
          results.push({ pair_index: position.pair_index, success: true })
          console.log(`[CloseAllPositions] Closed position ${position.pair_index}: ${position.symbol}`)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          results.push({ pair_index: position.pair_index, success: false, error: errorMessage })
          console.error(`[CloseAllPositions] Failed to close position ${position.pair_index}:`, error)
        }
      }
      
      const closedCount = results.filter(r => r.success).length
      const failedCount = results.filter(r => !r.success).length
      
      return NextResponse.json({
        success: failedCount === 0,
        message: failedCount === 0 
          ? `Successfully closed all ${closedCount} positions`
          : `Closed ${closedCount} positions, ${failedCount} failed`,
        closed: closedCount,
        failed: failedCount,
        results
      })
    } catch (error) {
      console.error(`[CloseAllPositions] Failed to close positions:`, error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to close positions'
      return NextResponse.json({
        success: false,
        error: errorMessage
      }, { status: 400 })
    }

  } catch (error) {
    console.error('[API] Error closing all positions:', error)
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Failed to close all positions'
      },
      { status: 500 }
    )
  }
}
