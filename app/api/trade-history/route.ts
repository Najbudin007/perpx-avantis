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
    // Use NEXT_PUBLIC_AVANTIS_API_URL to match other API routes
    const avantisApiUrl = process.env.NEXT_PUBLIC_AVANTIS_API_URL || process.env.AVANTIS_SERVICE_URL || 'http://localhost:8000'
    
    console.log(`[API] Trade history - Fetching from: ${avantisApiUrl}/api/trade-history`)
    console.log(`[API] Trade history - Wallet address: ${wallet.address.slice(0, 10)}...${wallet.address.slice(-6)}`)
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)
      
      // Build query params - include both private_key and address for Base Accounts support
      const params = new URLSearchParams({
        private_key: wallet.privateKey,
        address: wallet.address,
        limit: '50'
      })
      
      const url = `${avantisApiUrl}/api/trade-history?${params.toString()}`
      console.log(`[API] Trade history - Request URL: ${url.replace(/private_key=[^&]+/, 'private_key=***')}`)
      
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      })
      
      clearTimeout(timeoutId)
      
      if (response.ok) {
        const data = await response.json()
        console.log(`[API] Trade history - Success: ${data.count || 0} trades found`)
        return NextResponse.json({
          trades: data.trades || [],
          count: data.count || 0
        })
      } else {
        const errorText = await response.text().catch(() => 'Unknown error')
        let errorMessage = errorText
        
        // Try to parse JSON error if possible
        try {
          const errorJson = JSON.parse(errorText)
          errorMessage = errorJson.detail || errorJson.error || errorJson.message || errorText
        } catch {
          // Not JSON, use as-is
        }
        
        console.error(`[API] Trade history error (${response.status}): ${errorMessage}`)
        return NextResponse.json({
          trades: [],
          count: 0,
          error: errorMessage || `HTTP ${response.status}: ${response.statusText}`
        })
      }
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError)
      console.error('[API] Trade history fetch error:', {
        error: errorMessage,
        avantisApiUrl,
        walletAddress: wallet.address,
        isAbortError: fetchError instanceof Error && fetchError.name === 'AbortError'
      })
      
      // Provide more specific error messages
      if (fetchError instanceof Error) {
        if (fetchError.name === 'AbortError') {
          return NextResponse.json({
            trades: [],
            count: 0,
            error: 'Request timeout: Avantis service did not respond in time'
          })
        }
        if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
          return NextResponse.json({
            trades: [],
            count: 0,
            error: `Cannot connect to Avantis service at ${avantisApiUrl}. Please ensure the service is running.`
          })
        }
      }
      
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
