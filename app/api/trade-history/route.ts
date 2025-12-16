import { NextRequest, NextResponse } from 'next/server'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'

// Lazy initialization
function getFarcasterWalletService(): BaseAccountWalletService {
  return new BaseAccountWalletService()
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
    
    // Farcaster users only
    if (!authContext.fid) {
      return NextResponse.json({
        trades: [],
        count: 0,
        error: 'User FID required'
      })
    }
    
    const farcasterWalletService = getFarcasterWalletService()
    const farcasterWallet = await farcasterWalletService.getWalletWithKey(authContext.fid, 'ethereum')
    
    if (!farcasterWallet || !farcasterWallet.privateKey) {
      return NextResponse.json({
        trades: [],
        count: 0,
        error: 'No trading wallet found'
      })
    }
    
    const wallet = {
      address: farcasterWallet.address,
      privateKey: farcasterWallet.privateKey
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
          break
        }
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error')
          console.error(`[API] Trade history error (${response.status}): ${errorText}`)
          if (page === 1) {
            return NextResponse.json({
              trades: [],
              count: 0,
              error: `Failed to fetch trade history: ${errorText}`
            })
          }
          break
        }
        
        const data = await response.json()
        
        const trades = data.portfolio || []
        if (trades.length === 0) {
          break
        }
        
        allTrades.push(...trades)
        
        const pageCount = data.pageCount
        if (pageCount && page >= pageCount) {
          break
        }
        
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
        
        // Get symbol early for logging
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
        
        // Calculate position size: use from API if available, otherwise calculate from collateral * leverage
        let positionSizeUsdc = args.positionSizeUSDC || 0
        if (positionSizeUsdc === 0 && collateral > 0 && leverage > 0) {
          positionSizeUsdc = collateral * leverage
        }
        
        // Try to get PnL from API response (check multiple possible field names)
        // Convert to number in case API returns string
        let pnl = Number(tradeItem._grossPnl || tradeItem.grossPnl || tradeItem.pnl || tradeItem.realizedPnl || 0)
        
        // Always calculate PnL when we have the necessary data to validate/correct API values
        if (openPrice > 0 && closePrice > 0 && positionSizeUsdc > 0) {
          // Calculate PnL using the same formula as open positions
          // PnL = (close_price - open_price) / open_price * position_size * direction
          const priceDiffPct = (closePrice - openPrice) / openPrice
          const adjustedPriceDiff = isLong ? priceDiffPct : -priceDiffPct
          const calculatedPnl = adjustedPriceDiff * positionSizeUsdc
          
          const apiPnl = pnl
          
          // Use calculated PnL if:
          // 1. API PnL is exactly 0 (or very close to 0) AND calculated PnL is significantly different (not close to 0)
          //    This catches cases where API incorrectly returns 0.00 for a trade with actual profit/loss
          // 2. API PnL is null/undefined
          // 3. API PnL differs significantly from calculated (>10% difference)
          const apiPnlIsZero = Math.abs(pnl) < 0.001 // Consider 0.001 as "zero" to handle floating point
          const calculatedPnlIsSignificant = Math.abs(calculatedPnl) >= 0.01 // At least 1 cent difference
          
          if (pnl === null || pnl === undefined || isNaN(pnl)) {
            // API PnL is missing - use calculated
            pnl = calculatedPnl
            console.log(`[TradeHistory] API PnL missing, using calculated: ${calculatedPnl.toFixed(2)} for ${symbol}`)
          } else if (apiPnlIsZero && calculatedPnlIsSignificant) {
            // API returned 0.00 but calculated shows significant profit/loss - use calculated
            pnl = calculatedPnl
            console.log(`[TradeHistory] API PnL was 0.00 but calculated shows ${calculatedPnl.toFixed(2)}, using calculated for ${symbol}`)
          } else if (!apiPnlIsZero && calculatedPnlIsSignificant && Math.abs(pnl - calculatedPnl) > Math.abs(calculatedPnl) * 0.1) {
            // API PnL exists but differs significantly from calculated (>10%) - use calculated
            pnl = calculatedPnl
            console.log(`[TradeHistory] API PnL (${apiPnl.toFixed(2)}) differs from calculated (${calculatedPnl.toFixed(2)}), using calculated for ${symbol}`)
          }
          // Otherwise, trust API PnL (it's close to calculated or both are near zero)
        }
        
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
