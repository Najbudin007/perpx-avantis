import { NextRequest, NextResponse } from 'next/server'
import { AuthService } from '@/lib/services/AuthService'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'
import { getNetworkConfig } from '@/lib/config/network'
import { ethers } from 'ethers'

// Lazy initialization - create services at runtime, not build time
function getAuthService(): AuthService {
  return new AuthService()
}

function getWalletService(): BaseAccountWalletService {
  return new BaseAccountWalletService()
}

const ERC20_INTERFACE = new ethers.Interface([
  'function transfer(address to, uint256 amount) returns (bool)'
])

// Get network config at runtime
function getNetwork() {
  return getNetworkConfig()
}

interface DepositRequestBody {
  amount: string
  asset: 'USDC' | 'ETH'
  baseAddress?: string
}

export async function POST(request: NextRequest) {
  try {
    const authService = getAuthService();
    const walletService = getWalletService();
    const network = getNetwork();
    
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const payload = await authService.verifyToken(token)

    if (!payload.fid) {
      return NextResponse.json(
        { error: 'Base Account (FID) required' },
        { status: 400 }
      )
    }

    const body: DepositRequestBody = await request.json()
    const asset = body.asset || 'USDC'
    const amount = body.amount

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json(
        { error: 'Amount must be greater than zero' },
        { status: 400 }
      )
    }

    if (asset !== 'USDC' && asset !== 'ETH') {
      return NextResponse.json(
        { error: 'Unsupported asset. Only ETH and USDC are supported.' },
        { status: 400 }
      )
    }

    const baseAddress = (body.baseAddress || '').toLowerCase()
    const storedBaseAddress = (await walletService.getBaseAccountAddress(payload.fid))?.toLowerCase() || null

    if (storedBaseAddress && baseAddress && storedBaseAddress !== baseAddress) {
      return NextResponse.json(
        { error: 'Base wallet mismatch. Please reconnect your wallet.' },
        { status: 400 }
      )
    }

    const fromAddress = baseAddress || storedBaseAddress
    if (!fromAddress) {
      return NextResponse.json(
        { error: 'No Base wallet address is stored for this user.' },
        { status: 400 }
      )
    }

    // Ensure trading wallet exists (destination)
    const tradingWallet = await walletService.ensureTradingWallet(payload.fid)
    if (!tradingWallet) {
      return NextResponse.json(
        { error: 'Failed to prepare trading wallet. Please try again.' },
        { status: 500 }
      )
    }

    const destination = tradingWallet.address
    
    // CRITICAL: Log deposit preparation to track all fund movements
    console.log(`[API/DEPOSIT] Preparing deposit: ${amount} ${asset} from ${fromAddress} to ${destination}`)
    console.log(`[API/DEPOSIT] This is a USER-INITIATED deposit via /api/wallet/deposit endpoint`)
    console.log(`[API/DEPOSIT] Trading wallet address: ${destination}`)
    let transaction: { from: string; to: string; value: string; data: string; gas?: string }

    try {
      if (asset === 'ETH') {
        // For ETH deposits, validate that amount doesn't exceed balance minus gas
        // Estimate gas for a simple ETH transfer (21000 gas units)
        // Base network gas price is typically very low (~0.1 gwei), so ~0.0001 ETH should be enough
        const GAS_RESERVE_ETH = '0.0001' // Reserve ~0.0001 ETH for gas fees
        const amountBN = ethers.parseEther(amount)
        const gasReserveBN = ethers.parseEther(GAS_RESERVE_ETH)
        
        // Note: We can't check balance here, but the frontend should handle this
        // The transaction will fail if insufficient balance, but we provide a better error message
        
        const value = ethers.toBeHex(amountBN)
        transaction = {
          from: fromAddress,
          to: destination,
          value,
          data: '0x',
          // Set gas limit for ETH transfer (21000 is standard for simple transfers)
          gas: ethers.toBeHex(BigInt(21000))
        }
      } else {
        const amountInUnits = ethers.parseUnits(amount, network.usdcDecimals)
        transaction = {
          from: fromAddress,
          to: network.usdcAddress,
          value: '0x0',
          data: ERC20_INTERFACE.encodeFunctionData('transfer', [destination, amountInUnits]),
          gas: ethers.toBeHex(BigInt(200000))
        }
      }
    } catch (amountError) {
      return NextResponse.json(
        { error: 'Invalid amount format. Please check your input.' },
        { status: 400 }
      )
    }

    // Check for active trading sessions that might automatically use deposited funds
    let activeSessionWarning = null
    try {
      const tradingEngineUrl = process.env.TRADING_ENGINE_URL || 'http://localhost:3001'
      const sessionsResponse = await fetch(`${tradingEngineUrl}/api/trading/sessions`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        }
      }).catch(() => null)
      
      if (sessionsResponse?.ok) {
        const sessionsData = await sessionsResponse.json()
        const activeSessions = sessionsData.sessions?.filter((s: any) => s.status === 'running') || []
        if (activeSessions.length > 0) {
          activeSessionWarning = `⚠️ WARNING: You have ${activeSessions.length} active trading session(s). Deposited funds may be automatically used to open positions.`
        }
      }
    } catch (sessionCheckError) {
      // Silently fail - don't block deposit if session check fails
      console.warn('[API] Failed to check active sessions:', sessionCheckError)
    }

    return NextResponse.json({
      success: true,
      network: {
        name: network.name,
        chainId: network.chainId
      },
      asset,
      amount,
      depositAddress: destination,
      transaction,
      note: `Send ${asset} from your Base wallet to fund your PrepX trading vault`,
      warning: activeSessionWarning
    })
  } catch (error) {
    console.error('[API] Deposit preparation failed:', error)
    return NextResponse.json(
      {
        error: 'Failed to prepare deposit transaction',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    )
  }
}

