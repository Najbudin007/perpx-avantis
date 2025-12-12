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
      // Use ensureTradingWallet() for consistency with trading/start route
      const farcasterWalletService = getFarcasterWalletService()
      const farcasterWallet = await farcasterWalletService.ensureTradingWallet(authContext.fid)
      if (farcasterWallet && farcasterWallet.privateKey) {
        wallet = {
          address: farcasterWallet.address,
          privateKey: farcasterWallet.privateKey
        }
        console.log(`[Positions] Using trading wallet: ${wallet.address} for FID: ${authContext.fid}`)
      } else {
        console.error(`[Positions] Failed to get trading wallet for FID ${authContext.fid}`)
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
    
    // Store privateKey in a const to satisfy TypeScript
    const privateKey = wallet.privateKey

    // Try to get positions from trading engine first (with retry logic)
    const tradingEngineUrl = process.env.TRADING_ENGINE_URL || 'http://localhost:3001'
    
    const fetchWithRetry = async (retries = 2): Promise<any> => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const url = `${tradingEngineUrl}/api/positions?privateKey=${encodeURIComponent(privateKey)}`
          
          // Increase timeout to 60 seconds for position fetching
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 60000)
          
          const tradingResponse = await fetch(url, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
            signal: controller.signal
          })
          
          clearTimeout(timeoutId)
          
          if (tradingResponse.ok) {
            const tradingData = await tradingResponse.json()
            return {
              positions: tradingData.positions || [],
              totalPnL: tradingData.totalPnL || 0,
              openPositions: tradingData.openPositions || 0
            }
          } else {
            const errorText = await tradingResponse.text().catch(() => 'Unknown error')
            console.error(`[API] Trading engine error (attempt ${attempt + 1}/${retries + 1}): ${errorText}`)
            if (attempt < retries) {
              await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))) // Exponential backoff
              continue
            }
          }
        } catch (tradingError) {
          if (tradingError instanceof Error && tradingError.name === 'AbortError') {
            console.error(`[API] Trading engine timeout (attempt ${attempt + 1}/${retries + 1})`)
          } else {
            console.error(`[API] Trading engine error (attempt ${attempt + 1}/${retries + 1}):`, tradingError)
          }
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))) // Exponential backoff
            continue
          }
        }
      }
      return null
    }
    
    try {
      const tradingData = await fetchWithRetry()
      if (tradingData) {
        return NextResponse.json(tradingData)
      }
    } catch (error) {
      console.error('[API] Failed to fetch from trading engine after retries:', error)
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

      // Calculate total PnL from all positions
      const totalPnL = formattedPositions.reduce((sum, pos) => sum + (pos.pnl || 0), 0)
      
      return NextResponse.json({
        positions: formattedPositions,
        totalPnL: totalPnL,
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
