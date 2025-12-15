import { NextRequest, NextResponse } from 'next/server'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'

// Lazy initialization
function getFarcasterWalletService(): BaseAccountWalletService {
  return new BaseAccountWalletService()
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
    
    // Farcaster users only
    if (!authContext.fid) {
      return NextResponse.json({ error: 'User FID required' }, { status: 400 })
    }
    
    const farcasterWalletService = getFarcasterWalletService()
    let farcasterWallet = await farcasterWalletService.getWalletWithKey(authContext.fid, 'ethereum')
    
    if (!farcasterWallet || !farcasterWallet.privateKey) {
      farcasterWallet = await farcasterWalletService.ensureTradingWallet(authContext.fid)
    }
    
    if (!farcasterWallet || !farcasterWallet.privateKey) {
      return NextResponse.json({ 
        error: 'No trading wallet found. Please ensure your trading wallet is properly set up.' 
      }, { status: 400 })
    }
    
    const wallet = {
      address: farcasterWallet.address,
      privateKey: farcasterWallet.privateKey
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
        trade_index: 0,
        new_tp: new_tp,
        new_sl: new_sl,
        private_key: wallet.privateKey
      })
    })
    
    if (!avantisResponse.ok) {
      const errorData = await avantisResponse.json().catch(() => ({ detail: 'Failed to update TP/SL' }))
      
      let userFriendlyError = errorData.detail || 'Failed to update TP/SL'
      if (userFriendlyError.includes('No open trade found') || userFriendlyError.includes('No open position')) {
        userFriendlyError = 'Position not found. It may have been closed.'
      } else if (userFriendlyError.includes('execution reverted') || userFriendlyError.includes('revert')) {
        userFriendlyError = 'Transaction failed on blockchain. Please try again.'
      } else if (userFriendlyError.includes('private key') || userFriendlyError.includes('Private key')) {
        userFriendlyError = 'Wallet authentication failed. Please ensure your trading wallet is properly set up.'
      } else if (userFriendlyError.includes('401') || userFriendlyError.includes('Unauthorized')) {
        userFriendlyError = 'Authentication failed. Please refresh your session and try again.'
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
