import { NextRequest, NextResponse } from 'next/server'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'
import { WebWalletService } from '@/lib/services/WebWalletService'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'
import { deduplicateRequest, createRequestKey } from './dedup'

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
      // CRITICAL: Use getWalletWithKey() first to get existing wallet, only create if missing
      // This ensures we always use the SAME wallet address for positions (prevents inconsistency)
      const farcasterWalletService = getFarcasterWalletService()
      
      // CRITICAL: Always use getWalletWithKey() first to get EXISTING wallet
      // This ensures we use the SAME wallet address every time (prevents positions appearing/disappearing)
      // Only create wallet if it truly doesn't exist (first-time users)
      let farcasterWallet = await farcasterWalletService.getWalletWithKey(authContext.fid, 'ethereum')
      
      if (farcasterWallet && farcasterWallet.privateKey) {
        // Wallet exists with valid private key - use it (this is the consistent path)
        wallet = {
          address: farcasterWallet.address,
          privateKey: farcasterWallet.privateKey
        }
        console.log(`[Positions] ✅ Using existing trading wallet: ${wallet.address} for FID: ${authContext.fid}`)
      } else {
        // Wallet doesn't exist or has no private key - create it (only for first-time users)
        console.log(`[Positions] ⚠️ No existing trading wallet found for FID ${authContext.fid}, creating one...`)
        farcasterWallet = await farcasterWalletService.ensureTradingWallet(authContext.fid)
        
        if (farcasterWallet && farcasterWallet.privateKey) {
          wallet = {
            address: farcasterWallet.address,
            privateKey: farcasterWallet.privateKey
          }
          console.log(`[Positions] ✅ Created new trading wallet: ${wallet.address} for FID: ${authContext.fid}`)
        } else {
          console.error(`[Positions] ❌ Failed to get/create trading wallet for FID ${authContext.fid}`)
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
      // CRITICAL: Get existing wallet first to ensure consistency (same pattern as Farcaster)
      const webWalletService = getWebWalletService()
      
      // First, try to get existing wallet (prevents creating new wallet on each call)
      let webWallet = await webWalletService.getWallet(authContext.webUserId, 'ethereum')
      
      if (webWallet) {
        // Wallet exists - get private key
        const privateKey = await webWalletService.getPrivateKey(authContext.webUserId, 'ethereum')
        if (privateKey) {
          wallet = {
            address: webWallet.address,
            privateKey: privateKey
          }
          console.log(`[Positions] ✅ Using existing trading wallet: ${wallet.address} for web user: ${authContext.webUserId}`)
        } else {
          console.error(`[Positions] ❌ Failed to get private key for web user ${authContext.webUserId}`)
        }
      } else {
        // Wallet doesn't exist - create it (only for first-time users)
        console.log(`[Positions] ⚠️ No existing trading wallet found for web user ${authContext.webUserId}, creating one...`)
        webWallet = await webWalletService.ensureTradingWallet(authContext.webUserId)
        
        if (webWallet) {
          const privateKey = await webWalletService.getPrivateKey(authContext.webUserId, 'ethereum')
          if (privateKey) {
            wallet = {
              address: webWallet.address,
              privateKey: privateKey
            }
            console.log(`[Positions] ✅ Created new trading wallet: ${wallet.address} for web user: ${authContext.webUserId}`)
          } else {
            console.error(`[Positions] ❌ Failed to get private key for newly created wallet (web user ${authContext.webUserId})`)
          }
        } else {
          console.error(`[Positions] ❌ Failed to get/create trading wallet for web user ${authContext.webUserId}`)
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
    const walletAddress = wallet.address

    // CRITICAL: Validate that private key matches wallet address (prevents using wrong wallet)
    // This ensures consistency for Farcaster users
    try {
      const { ethers } = await import('ethers')
      const walletFromKey = new ethers.Wallet(privateKey)
      const derivedAddress = walletFromKey.address.toLowerCase()
      const storedAddress = walletAddress.toLowerCase()
      
      if (derivedAddress !== storedAddress) {
        console.error(`[Positions] ❌ WALLET MISMATCH for ${authContext.context} user!`)
        console.error(`[Positions] Stored address: ${storedAddress}`)
        console.error(`[Positions] Derived address: ${derivedAddress}`)
        console.error(`[Positions] This indicates a database inconsistency - using derived address for consistency`)
        
        // Use derived address to ensure consistency (private key is source of truth)
        wallet.address = derivedAddress
      } else {
        console.log(`[Positions] ✅ Wallet address validated: ${storedAddress} matches private key`)
      }
    } catch (validationError) {
      console.warn(`[Positions] ⚠️ Could not validate wallet address: ${validationError}`)
      // Continue anyway - address should be correct
    }

    // Log wallet details for debugging (especially important for Farcaster users)
    console.log(`[Positions] Fetching positions for ${authContext.context} user (${authContext.context === 'farcaster' ? `FID: ${authContext.fid}` : `WebUserId: ${authContext.webUserId}`}) - Wallet: ${wallet.address}`)

    // Create request key for deduplication (use both address and private key for uniqueness)
    const requestKey = createRequestKey(privateKey, wallet.address)
    
    // Wrap the entire fetch logic in deduplication
    return deduplicateRequest(requestKey, async () => {
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
      
      // If trading engine fetch failed after retries, return error
      return NextResponse.json({
        positions: [],
        totalPnL: 0,
        openPositions: 0,
        error: 'Failed to fetch positions from trading engine'
      })
    } catch (error) {
      console.error('[API] Failed to fetch from trading engine after retries:', error)
      return NextResponse.json({
        positions: [],
        totalPnL: 0,
        openPositions: 0,
        error: 'Failed to fetch positions from trading engine'
      })
    }
    })
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
