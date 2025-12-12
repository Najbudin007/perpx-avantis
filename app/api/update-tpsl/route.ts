import { NextRequest, NextResponse } from 'next/server'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'
import { WebWalletService } from '@/lib/services/WebWalletService'

// Lazy initialization
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
    const authContext = await verifyTokenAndGetContext(token)
    
    let wallet: { address: string; privateKey: string } | null = null
    
    if (authContext.context === 'farcaster') {
      // Farcaster user
      if (!authContext.fid) {
        return NextResponse.json({ error: 'User FID required' }, { status: 400 })
      }
      
      const farcasterWalletService = getFarcasterWalletService()
      // Use ensureTradingWallet() for consistency with trading/start route
      const farcasterWallet = await farcasterWalletService.ensureTradingWallet(authContext.fid)
      if (farcasterWallet && farcasterWallet.privateKey) {
        wallet = {
          address: farcasterWallet.address,
          privateKey: farcasterWallet.privateKey
        }
        console.log(`[UpdateTP/SL] Using trading wallet: ${wallet.address} for FID: ${authContext.fid}`)
      } else {
        console.error(`[UpdateTP/SL] Failed to get trading wallet for FID ${authContext.fid}`)
      }
    } else {
      // Web user
      if (!authContext.webUserId) {
        return NextResponse.json({ error: 'Web user ID required' }, { status: 400 })
      }
      
      const webWalletService = getWebWalletService()
      const webWallet = await webWalletService.getWallet(authContext.webUserId, 'ethereum')
      if (webWallet) {
        const privateKey = await webWalletService.getPrivateKey(authContext.webUserId, 'ethereum')
        if (privateKey) {
          wallet = {
            address: webWallet.address,
            privateKey: privateKey
          }
        }
      }
    }
    
    if (!wallet || !wallet.privateKey) {
      return NextResponse.json({ 
        error: 'No trading wallet found. Please ensure your trading wallet is properly set up.' 
      }, { status: 400 })
    }
    
    const body = await request.json()
    const { pair_index, new_tp, new_sl } = body
    
    
    if (pair_index === undefined || pair_index === null) {
      return NextResponse.json({ error: 'pair_index is required' }, { status: 400 })
    }
    
    // Call Avantis service
    const avantisApiUrl = process.env.NEXT_PUBLIC_AVANTIS_API_URL || 'http://localhost:8000'
    
    const avantisResponse = await fetch(`${avantisApiUrl}/api/update-tp-sl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pair_index: pair_index,
        trade_index: 0, // Default to first trade index
        new_tp: new_tp,
        new_sl: new_sl,
        private_key: wallet.privateKey
      })
    })
    
    if (!avantisResponse.ok) {
      const errorData = await avantisResponse.json().catch(() => ({ detail: 'Failed to update TP/SL' }))
      console.error('[API] Avantis error:', errorData)
      
      // Provide more detailed error message for Farcaster users
      let userFriendlyError = errorData.detail || 'Failed to update TP/SL'
      if (userFriendlyError.includes('No open trade found')) {
        userFriendlyError = 'Position not found. It may have been closed.'
      } else if (userFriendlyError.includes('execution reverted')) {
        userFriendlyError = 'Transaction failed on blockchain. Please try again.'
      }
      
      return NextResponse.json(
        { 
          error: userFriendlyError,
          details: process.env.NODE_ENV === 'development' ? errorData.detail : undefined
        },
        { status: avantisResponse.status }
      )
    }
    
    const result = await avantisResponse.json()
    
    return NextResponse.json({
      success: true,
      ...result
    })
    
  } catch (error) {
    console.error('[API] Error updating TP/SL:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update TP/SL'
      },
      { status: 500 }
    )
  }
}
