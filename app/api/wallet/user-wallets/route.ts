import { NextRequest, NextResponse } from 'next/server'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'

// Lazy initialization - create services at runtime, not build time
function getFarcasterWalletService(): BaseAccountWalletService {
  return new BaseAccountWalletService()
}

// GET /api/wallet/user-wallets - Get user's wallets (Farcaster only)
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const authContext = await verifyTokenAndGetContext(token)
    
    type WalletResponse = {
      id: string;
      address: string;
      chain: string;
      createdAt: Date;
      updatedAt: Date;
      walletType: 'base-account' | 'trading' | 'legacy';
    };

    const wallets: WalletResponse[] = []

    // Farcaster users only
    if (!authContext.fid) {
      return NextResponse.json(
        { error: 'Base Account (FID) required' },
        { status: 400 }
      )
    }

    const farcasterWalletService = getFarcasterWalletService()
    
    // Base Account wallet (smart wallet)
    const baseAddress = await farcasterWalletService.getBaseAccountAddress(authContext.fid)
    if (baseAddress) {
      wallets.push({
        id: `fid_${authContext.fid}_base-account`,
        address: baseAddress,
        chain: 'base',
        createdAt: new Date(),
        updatedAt: new Date(),
        walletType: 'base-account'
      })
    }

    // Trading wallet (fallback EOA with private key)
    const tradingWallet = await farcasterWalletService.getWalletWithKey(authContext.fid, 'ethereum')
    if (tradingWallet) {
      wallets.push({
        id: tradingWallet.id,
        address: tradingWallet.address,
        chain: 'ethereum',
        createdAt: tradingWallet.createdAt,
        updatedAt: tradingWallet.createdAt,
        walletType: tradingWallet.privateKey ? 'trading' : 'legacy'
      })
    }

    return NextResponse.json({ wallets })
  } catch (error) {
    console.error('Error fetching user wallets:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    
    return NextResponse.json(
      { 
        error: 'Failed to fetch wallets',
        message: errorMessage
      },
      { status: 500 }
    )
  }
}

// POST /api/wallet/user-wallets - Create a new wallet (Farcaster only)
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const authContext = await verifyTokenAndGetContext(token)
    
    const { chain, mnemonic } = await request.json()
    const chainType = (chain || 'ethereum').toLowerCase()
    
    // Validate chain parameter
    const validChains = ['ethereum', 'bitcoin', 'solana', 'aptos', 'base-account']
    if (chainType && !validChains.includes(chainType)) {
      return NextResponse.json(
        { error: `Invalid chain. Must be one of: ${validChains.join(', ')}` },
        { status: 400 }
      )
    }
    
    // Farcaster users only
    if (!authContext.fid) {
      return NextResponse.json(
        { error: 'Base Account (FID) required' },
        { status: 400 }
      )
    }

    const farcasterWalletService = getFarcasterWalletService()

    if (chainType === 'ethereum') {
      // Ensure trading wallet exists (create if needed)
      const wallet = await farcasterWalletService.ensureTradingWallet(authContext.fid)
      
      if (!wallet) {
        console.error(`[API] Failed to create trading wallet for FID ${authContext.fid}`)
        return NextResponse.json(
          { error: 'Failed to create wallet. Please try again.' },
          { status: 500 }
        )
      }

      console.log(`[API] Trading wallet ready for FID ${authContext.fid}: ${wallet.address}`)

      return NextResponse.json({ 
        wallet: {
          id: wallet.id,
          address: wallet.address,
          chain: wallet.chain,
          createdAt: wallet.createdAt,
          walletType: 'trading'
        }
      })
    }

    if (chainType === 'base-account') {
      const baseAddress = await farcasterWalletService.getBaseAccountAddress(authContext.fid)
      return NextResponse.json({
        wallet: baseAddress
          ? {
              id: `fid_${authContext.fid}_base-account`,
              address: baseAddress,
              chain: 'base',
              createdAt: new Date(),
              walletType: 'base-account'
            }
          : null
      })
    }

    return NextResponse.json(
      { error: `Unsupported chain "${chainType}" for wallet creation.` },
      { status: 400 }
    )
  } catch (error) {
    console.error('Error creating wallet:', error)
    return NextResponse.json(
      { 
        error: 'Failed to create wallet',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    )
  }
}
