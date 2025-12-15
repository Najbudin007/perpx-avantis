import { NextRequest, NextResponse } from 'next/server'
import { AvantisClient } from '@/lib/services/AvantisClient'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'

// Lazy initialization - create services at runtime, not build time
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
    
    // trade_index defaults to 0 if not provided
    const tradeIndex = trade_index !== undefined && trade_index !== null ? trade_index : 0

    // Farcaster users only
    if (!authContext.fid) {
      return NextResponse.json(
        { error: 'Base Account (FID) required' },
        { status: 400 }
      )
    }
    
    const farcasterWalletService = getFarcasterWalletService()
    let farcasterWallet = await farcasterWalletService.getWalletWithKey(authContext.fid, 'ethereum')
    
    if (!farcasterWallet || !farcasterWallet.privateKey) {
      farcasterWallet = await farcasterWalletService.ensureTradingWallet(authContext.fid)
    }
    
    if (!farcasterWallet || !farcasterWallet.privateKey) {
      return NextResponse.json({ 
        error: 'No trading wallet found. Please ensure your trading wallet is properly set up.' 
      }, { status: 404 })
    }
    
    const wallet = {
      address: farcasterWallet.address,
      privateKey: farcasterWallet.privateKey
    }

    // Handle pair_index === 0 correctly (0 is a valid pair index)
    let pairIndex: number | undefined
    if (pair_index !== undefined && pair_index !== null) {
      pairIndex = typeof pair_index === 'number' ? pair_index : parseInt(pair_index)
    } else if (symbol !== undefined && symbol !== null) {
      pairIndex = parseInt(symbol)
    }
    
    if (pairIndex === undefined || pairIndex === null || isNaN(pairIndex)) {
      return NextResponse.json({ 
        error: 'Valid pair_index is required. Please provide the pair_index from the position data.' 
      }, { status: 400 })
    }

    // Use AvantisClient to call backend FastAPI directly
    const avantisApiUrl = process.env.NEXT_PUBLIC_AVANTIS_API_URL || 'http://localhost:8000'
    const avantisClient = new AvantisClient({ 
      baseUrl: avantisApiUrl,
      privateKey: wallet.privateKey 
    })
    
    try {
      const result = await avantisClient.closePosition(pairIndex, wallet.privateKey, tradeIndex)
      
      return NextResponse.json({
        success: true,
        tx_hash: result.transaction_hash,
        message: result.message || 'Position closed successfully'
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to close position'
      
      let userFriendlyError = errorMessage
      if (errorMessage.includes('Insufficient ETH') || errorMessage.includes('insufficient funds') || errorMessage.includes('insufficient ETH balance')) {
        userFriendlyError = 'Insufficient ETH balance for gas fees. Please add ETH to your trading wallet to cover transaction costs.'
      } else if (errorMessage.includes('No trading wallet') || errorMessage.includes('No wallet found')) {
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
