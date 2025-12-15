import { NextRequest, NextResponse } from 'next/server'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'
import { deduplicateRequest, createRequestKey } from './dedup'

// Lazy initialization - create services at runtime, not build time
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
        positions: [],
        totalPnL: 0,
        openPositions: 0,
        error: 'User FID required'
      })
    }
    
    // Get user's backend trading wallet (must have private key for automated trading)
    const farcasterWalletService = getFarcasterWalletService()
    
    // CRITICAL: Always use getWalletWithKey() first to get EXISTING wallet
    let farcasterWallet = await farcasterWalletService.getWalletWithKey(authContext.fid, 'ethereum')
    
    let wallet: { address: string; privateKey: string } | null = null;
    
    if (farcasterWallet && farcasterWallet.privateKey) {
      // Wallet exists with valid private key - use it
      wallet = {
        address: farcasterWallet.address,
        privateKey: farcasterWallet.privateKey
      }
    } else {
      // Wallet doesn't exist or has no private key - create it (only for first-time users)
      farcasterWallet = await farcasterWalletService.ensureTradingWallet(authContext.fid)
      
      if (farcasterWallet && farcasterWallet.privateKey) {
        wallet = {
          address: farcasterWallet.address,
          privateKey: farcasterWallet.privateKey
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
    
    const privateKey = wallet.privateKey
    const walletAddress = wallet.address

    // Validate that private key matches wallet address
    try {
      const { ethers } = await import('ethers')
      const walletFromKey = new ethers.Wallet(privateKey)
      const derivedAddress = walletFromKey.address.toLowerCase()
      const storedAddress = walletAddress.toLowerCase()
      
      if (derivedAddress !== storedAddress) {
        // Use derived address to ensure consistency
        wallet.address = derivedAddress
      }
    } catch {
      // Continue with stored address if validation fails
    }

    // Create request key for deduplication
    const requestKey = createRequestKey(privateKey, wallet.address)
    
    // Wrap the entire fetch logic in deduplication
    return deduplicateRequest(requestKey, async () => {
      const tradingEngineUrl = process.env.TRADING_ENGINE_URL || 'http://localhost:3001'
      
      const fetchWithRetry = async (retries = 2): Promise<any> => {
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            const url = `${tradingEngineUrl}/api/positions?privateKey=${encodeURIComponent(privateKey)}`
        
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
              if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
                continue
              }
            }
          } catch (tradingError) {
            if (attempt < retries) {
              await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
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
        
        return NextResponse.json({
          positions: [],
          totalPnL: 0,
          openPositions: 0
        })
      } catch {
        return NextResponse.json({
          positions: [],
          totalPnL: 0,
          openPositions: 0
        })
      }
    })
  } catch {
    return NextResponse.json(
      { 
        positions: [],
        totalPnL: 0,
        openPositions: 0
      },
      { status: 500 }
    )
  }
}
