import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'
import { RealBalanceService } from '@/lib/services/RealBalanceService'

export const runtime = 'nodejs'

// Lazy initialization - create services at runtime, not build time
function getFarcasterWalletService(): BaseAccountWalletService {
  return new BaseAccountWalletService()
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    let authContext
    try {
      authContext = await verifyTokenAndGetContext(token)
    } catch (authError) {
      console.error('[API] balances - Token verification failed:', authError)
      return NextResponse.json(
        { error: 'Invalid or expired token', details: authError instanceof Error ? authError.message : 'Invalid token' },
        { status: 401 }
      )
    }

    const url = new URL(request.url)
    const addressParam = url.searchParams.get('address')

    if (!addressParam || !ethers.isAddress(addressParam)) {
      return NextResponse.json(
        { error: 'A valid wallet address is required' },
        { status: 400 }
      )
    }

    const address = addressParam.toLowerCase()

    // Farcaster users only
    if (!authContext.fid) {
      return NextResponse.json(
        { error: 'Base Account (FID) required' },
        { status: 400 }
      )
    }
    
    // Get authorized addresses for Farcaster user
    const authorizedAddresses: string[] = []
    
    const farcasterWalletService = getFarcasterWalletService()
    const baseAddress = (await farcasterWalletService.getBaseAccountAddress(authContext.fid))?.toLowerCase() || null
    const tradingWallet = await farcasterWalletService.getWalletWithKey(authContext.fid, 'ethereum')
    const tradingAddress = tradingWallet?.address?.toLowerCase() || null
    
    if (baseAddress) authorizedAddresses.push(baseAddress)
    if (tradingAddress) authorizedAddresses.push(tradingAddress)

    // Check if address is authorized
    if (!authorizedAddresses.includes(address)) {
      return NextResponse.json(
        { error: 'Address not authorized for this user' },
        { status: 403 }
      )
    }

    const balanceService = new RealBalanceService()
    const balance = await balanceService.getAllBalances(address)

    return NextResponse.json({
      address,
      balance
    })
  } catch (error) {
    console.error('[API] Failed to fetch wallet balances:', error)
    return NextResponse.json(
      { error: 'Failed to fetch wallet balances', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
