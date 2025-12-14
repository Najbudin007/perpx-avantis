import { NextRequest, NextResponse } from 'next/server'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'
import { WebWalletService } from '@/lib/services/WebWalletService'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'

// Lazy initialization
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
      if (!authContext.fid) {
        return NextResponse.json({
          trades: [],
          count: 0,
          error: 'User FID required'
        })
      }
      
      const farcasterWalletService = getFarcasterWalletService()
      const farcasterWallet = await farcasterWalletService.getWalletWithKey(authContext.fid, 'ethereum')
      if (farcasterWallet && farcasterWallet.privateKey) {
        wallet = {
          address: farcasterWallet.address,
          privateKey: farcasterWallet.privateKey
        }
      }
    } else {
      if (!authContext.webUserId) {
        return NextResponse.json({
          trades: [],
          count: 0,
          error: 'Web user ID required'
        })
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
    
    if (!wallet || !wallet.address) {
      return NextResponse.json({
        trades: [],
        count: 0,
        error: 'No trading wallet found'
      })
    }
    
    // Call Avantis API directly
    const avantisApiUrl = "https://api.avantisfi.com"
    const walletAddress = wallet.address
    const allTrades: any[] = []
    let page = 1
    
    console.log(`[API] Trade history - Fetching from Avantis API for wallet: ${walletAddress.slice(0, 10)}...${walletAddress.slice(-6)}`)
    
    try {
      // Headers to match browser requests
      const headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.avantisfi.com",
        "Origin": "https://www.avantisfi.com",
        "Accept": "application/json",
      }
      
      // Fetch all pages
      while (true) {
        const url = `${avantisApiUrl}/v2/history/portfolio/history/${walletAddress}/${page}`
        
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 30000)
        
        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        })
        
        clearTimeout(timeoutId)
        
        if (response.status === 404) {
          // No more pages
          break
        }
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error')
          console.error(`[API] Trade history error (${response.status}): ${errorText}`)
          if (page === 1) {
            // If first page fails, return error
            return NextResponse.json({
              trades: [],
              count: 0,
              error: `Failed to fetch trade history: ${errorText}`
            })
          }
          break
        }
        
        const data = await response.json()
        
        // Extract trades from portfolio array
        const trades = data.portfolio || []
        if (trades.length === 0) {
          break
        }
        
        allTrades.push(...trades)
        
        // Check if there are more pages
        const pageCount = data.pageCount
        if (pageCount && page >= pageCount) {
          break
        }
        
        // Rate limit: wait 300ms between requests
        await new Promise(resolve => setTimeout(resolve, 300))
        page++
      }
      
      // Normalize trades to match frontend format
      const normalizedTrades = allTrades.map((tradeItem: any) => {
        const event = tradeItem.event || {}
        const args = event.args || {}
        const tradeData = args.t || {}
        
        const isLong = tradeData.buy || false
        const pairIndex = tradeData.pairIndex
        const leverage = tradeData.leverage || 1
        const collateral = tradeData.initialPosToken || 0
        const openPrice = tradeData.openPrice || 0
        const closePrice = args.price || 0
        const tp = tradeData.tp > 0 ? tradeData.tp : null
        const sl = tradeData.sl > 0 ? tradeData.sl : null
        const positionSizeUsdc = args.positionSizeUSDC || 0
        const pnl = tradeItem._grossPnl || 0
        
        // Handle timestamp
        let timestamp = 0
        if (tradeItem.timeStamp) {
          try {
            timestamp = Math.floor(new Date(tradeItem.timeStamp).getTime() / 1000)
          } catch {
            timestamp = tradeData.timestamp || 0
          }
        } else {
          timestamp = tradeData.timestamp || 0
        }
        
        // Get symbol from pair_index
        // Note: Based on API response, pairIndex 0 = ETH, pairIndex 1 = BTC
        const symbolMap: Record<number, string> = {
          0: "ETH",
          1: "BTC",
          2: "SOL",
          3: "AVAX",
          4: "MATIC",
          5: "ARB",
          6: "OP",
          7: "LINK",
          8: "UNI",
          9: "AAVE",
          10: "ATOM",
          11: "DOT",
          12: "ADA",
          13: "XRP",
          14: "DOGE",
          15: "BNB",
        }
        const symbol = symbolMap[pairIndex] || `PAIR-${pairIndex}`
        
        // Format date
        const date = timestamp > 0 ? new Date(timestamp * 1000).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : ""
        
        return {
          id: tradeItem._id || `trade-${tradeItem._id}`,
          symbol,
          pair_index: pairIndex,
          is_long: isLong,
          side: isLong ? "Long" : "Short",
          leverage,
          collateral,
          position_size_usdc: positionSizeUsdc,
          position_size_asset: closePrice > 0 ? positionSizeUsdc / closePrice : 0,
          open_price: openPrice,
          close_price: closePrice,
          tp,
          sl,
          pnl,
          pnl_percentage: collateral > 0 ? (pnl / collateral) * 100 : 0,
          timestamp,
          open_timestamp: tradeData.timestamp || timestamp,
          date,
          trader: tradeData.trader || walletAddress,
          type: "close",
          tx_hash: "",
          block: 0,
        }
      })
      
      // Sort by timestamp descending (most recent first)
      normalizedTrades.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      
      console.log(`[API] Trade history - Success: ${normalizedTrades.length} trades found`)
      return NextResponse.json({
        trades: normalizedTrades,
        count: normalizedTrades.length
      })
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[API] Trade history fetch error:', errorMessage)
      
      return NextResponse.json({
        trades: [],
        count: 0,
        error: `Failed to fetch trade history: ${errorMessage}`
      })
    }

  } catch (error) {
    console.error('Error fetching trade history:', error)
    return NextResponse.json({
      trades: [],
      count: 0,
      error: 'Failed to fetch trade history'
    }, { status: 500 })
  }
}
