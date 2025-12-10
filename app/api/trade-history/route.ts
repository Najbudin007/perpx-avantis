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
    
    if (!wallet || !wallet.privateKey) {
      return NextResponse.json({
        trades: [],
        count: 0,
        error: 'No trading wallet found'
      })
    }
    

    // Get trade history from Avantis service (port 8000)
    const avantisApiUrl = process.env.AVANTIS_SERVICE_URL || 'http://localhost:8000'
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)
      
      const response = await fetch(
        `${avantisApiUrl}/api/trade-history?private_key=${encodeURIComponent(wallet.privateKey)}&limit=50`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        }
      )
      
      clearTimeout(timeoutId)
      
      if (response.ok) {
        const data = await response.json()
        return NextResponse.json({
          trades: data.trades || [],
          count: data.count || 0
        })
      } else {
        const errorText = await response.text().catch(() => 'Unknown error')
        console.error(`[API] Trade history error: ${errorText}`)
        return NextResponse.json({
          trades: [],
          count: 0,
          error: errorText
        })
      }
    } catch (fetchError) {
      console.error('[API] Trade history fetch error:', fetchError)
      return NextResponse.json({
        trades: [],
        count: 0,
        error: 'Failed to fetch trade history'
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
