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
    const { pair_index, symbol } = await request.json()
    
    // pair_index is required for Avantis
    if (!pair_index && !symbol) {
      return NextResponse.json({ 
        error: 'pair_index is required (Avantis uses pair indices, not symbols)' 
      }, { status: 400 })
    }

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
      const farcasterWallet = await farcasterWalletService.getWalletWithKey(authContext.fid, 'ethereum')
      
      if (!farcasterWallet || !farcasterWallet.privateKey) {
        return NextResponse.json({ 
          error: 'No wallet found with private key' 
        }, { status: 404 })
      }
      
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
      const webWallet = await webWalletService.getWallet(authContext.webUserId, 'ethereum')
      
      if (!webWallet) {
        return NextResponse.json({ 
          error: 'No wallet found' 
        }, { status: 404 })
      }
      
      const privateKey = await webWalletService.getPrivateKey(authContext.webUserId, 'ethereum')
      if (!privateKey) {
        return NextResponse.json({ 
          error: 'Wallet private key not available' 
        }, { status: 404 })
      }
      
      wallet = {
        address: webWallet.address,
        privateKey: privateKey
      }
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

    console.log(`[ClosePosition] Closing position with pair_index ${pairIndex} for ${authContext.context} user:`, userId)

    // Use AvantisClient to call backend FastAPI directly (direct contract integration)
    const avantisApiUrl = process.env.NEXT_PUBLIC_AVANTIS_API_URL || 'http://localhost:8000'
    const avantisClient = new AvantisClient({ 
      baseUrl: avantisApiUrl,
      privateKey: wallet.privateKey 
    })
    
    try {
      const result = await avantisClient.closePosition(pairIndex, wallet.privateKey)
      
      console.log(`[ClosePosition] Successfully closed position for pair_index ${pairIndex}`)
      return NextResponse.json({
        success: true,
        tx_hash: result.transaction_hash,
        message: result.message || 'Position closed successfully'
      })
    } catch (error) {
      console.error(`[ClosePosition] Failed to close position for pair_index ${pairIndex}:`, error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to close position'
      return NextResponse.json({
        success: false,
        error: errorMessage
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
