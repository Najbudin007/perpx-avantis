import { NextRequest, NextResponse } from 'next/server'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'
import { WebWalletService } from '@/lib/services/WebWalletService'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'
import { AvantisClient } from '@/lib/services/AvantisClient'

// Lazy initialization - create services at runtime, not build time
function getFarcasterWalletService(): BaseAccountWalletService {
  return new BaseAccountWalletService()
}

function getWebWalletService(): WebWalletService {
  return new WebWalletService()
}

export async function GET(request: NextRequest) {
  try {
    console.log('[API] Positions endpoint called')
    
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const authContext = await verifyTokenAndGetContext(token)
    
    let wallet: { address: string; privateKey: string } | null = null;
    
    if (authContext.context === 'farcaster') {
      // Farcaster user
      if (!authContext.fid) {
        return NextResponse.json({
          positions: [],
          totalPnL: 0,
          openPositions: 0,
          error: 'User FID required'
        })
      }
      
      // Get user's backend trading wallet (must have private key for automated trading)
      const farcasterWalletService = getFarcasterWalletService()
      const farcasterWallet = await farcasterWalletService.getWalletWithKey(authContext.fid, 'ethereum')
      if (farcasterWallet && farcasterWallet.privateKey) {
        wallet = {
          address: farcasterWallet.address,
          privateKey: farcasterWallet.privateKey
        }
      }
    } else {
      // Web user
      if (!authContext.webUserId) {
        return NextResponse.json({
          positions: [],
          totalPnL: 0,
          openPositions: 0,
          error: 'Web user ID required'
        })
      }
      
      // Get web user's trading wallet
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
        positions: [],
        totalPnL: 0,
        openPositions: 0,
        error: 'No trading wallet found. Please ensure your wallet is set up.'
      })
    }
    
    console.log(`[API] Getting positions for ${authContext.context} user:`, authContext.fid || authContext.webUserId)
    console.log('[API] Using wallet address:', wallet.address)

    // Try to get positions from trading engine first
    const tradingEngineUrl = process.env.TRADING_ENGINE_URL || 'http://localhost:3001'
    
    try {
      console.log(`[API] Fetching positions from trading engine: ${tradingEngineUrl}/api/positions`)
      const tradingResponse = await fetch(`${tradingEngineUrl}/api/positions?privateKey=${encodeURIComponent(wallet.privateKey)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      })
      
      console.log(`[API] Trading engine response status: ${tradingResponse.status}`)
      
      if (tradingResponse.ok) {
        const tradingData = await tradingResponse.json()
        console.log(`[API] Trading engine returned ${tradingData.openPositions || 0} positions`)
        return NextResponse.json({
          positions: tradingData.positions || [],
          totalPnL: tradingData.totalPnL || 0,
          openPositions: tradingData.openPositions || 0
        })
      } else {
        const errorText = await tradingResponse.text().catch(() => 'Unknown error')
        console.error(`[API] Trading engine error: ${errorText}`)
      }
    } catch (tradingError) {
      console.error('[API] Trading engine not available:', tradingError)
    }

    // Fallback: Fetch positions directly from Avantis
    try {
      // Use NEXT_PUBLIC_AVANTIS_API_URL for frontend API routes (CI/CD compliant)
      const avantisApiUrl = process.env.NEXT_PUBLIC_AVANTIS_API_URL || 'http://localhost:8000'
      const avantisClient = new AvantisClient({ 
        baseUrl: avantisApiUrl,
        privateKey: wallet.privateKey 
      })
      
      const positions = await avantisClient.getPositions()
      const balance = await avantisClient.getBalance()
    
      // Convert Avantis positions to our format
      const formattedPositions = positions.map(pos => ({
        coin: pos.symbol,
        symbol: pos.symbol,
        pair_index: pos.pair_index,
        size: (pos.collateral * pos.leverage).toString(),
        side: pos.is_long ? 'long' : 'short',
        entryPrice: pos.entry_price,
        markPrice: pos.current_price,
        pnl: pos.pnl,
        roe: pos.entry_price > 0 ? (pos.pnl / (pos.collateral * pos.leverage)) * 100 : 0,
        positionValue: pos.collateral * pos.leverage,
        margin: pos.collateral.toString(),
        leverage: pos.leverage.toString(),
        liquidationPrice: pos.liquidation_price || null, // Include liquidation price from Avantis
        collateral: pos.collateral,
        takeProfit: pos.take_profit || null,
        stopLoss: pos.stop_loss || null
      }))

      console.log(`[API] Retrieved ${formattedPositions.length} positions directly from Avantis`)
      return NextResponse.json({
        positions: formattedPositions,
        totalPnL: balance.total_collateral || 0,
        openPositions: positions.length
      })
    } catch (avantisError) {
      console.error('[API] Avantis fallback failed:', avantisError)
      return NextResponse.json({
        positions: [],
        totalPnL: 0,
        openPositions: 0,
        error: 'Failed to fetch positions from Avantis'
      })
    }

  } catch (error) {
    console.error('Error fetching positions:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch positions',
        positions: [],
        totalPnL: 0,
        openPositions: 0
      },
      { status: 500 }
    )
  }
}
