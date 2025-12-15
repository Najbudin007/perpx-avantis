import { NextRequest, NextResponse } from 'next/server'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'
import { WebWalletService } from '@/lib/services/WebWalletService'
import { ethers } from 'ethers'
import { getNetworkConfig } from '@/lib/config/network'

// Lazy initialization
function getFarcasterWalletService(): BaseAccountWalletService {
  return new BaseAccountWalletService()
}

function getWebWalletService(): WebWalletService {
  return new WebWalletService()
}

/**
 * GET /api/trading/check-gas - Check if user has sufficient ETH for gas fees
 * Returns the required ETH amount and current balance
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('[check-gas] Missing or invalid authorization header')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    
    // Log token info for debugging (first/last few chars only)
    const tokenPreview = token.length > 20 ? `${token.substring(0, 10)}...${token.substring(token.length - 10)}` : 'SHORT_TOKEN'
    console.log(`[check-gas] Verifying token for user: ${tokenPreview}`)
    
    let authContext
    try {
      authContext = await verifyTokenAndGetContext(token)
      console.log(`[check-gas] ✅ Token verified: ${authContext.context} user (${authContext.context === 'farcaster' ? `FID: ${authContext.fid}` : `WebUserId: ${authContext.webUserId}`})`)
    } catch (authError) {
      console.error(`[check-gas] ❌ Token verification failed:`, authError)
      return NextResponse.json(
        { 
          error: 'Authentication failed',
          hasSufficientGas: false,
          message: authError instanceof Error ? authError.message : 'Token verification failed'
        },
        { status: 401 }
      )
    }
    
    let wallet: { address: string; privateKey: string } | null = null;
    
    if (authContext.context === 'farcaster') {
      if (!authContext.fid) {
        return NextResponse.json({ error: 'User FID required' }, { status: 400 })
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
        return NextResponse.json({ error: 'Web user ID required' }, { status: 400 })
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
      console.error(`[check-gas] ❌ Trading wallet not found for ${authContext.context} user (${authContext.context === 'farcaster' ? `FID: ${authContext.fid}` : `WebUserId: ${authContext.webUserId}`})`)
      return NextResponse.json({ 
        error: 'Trading wallet not found',
        hasSufficientGas: false,
        message: 'Please ensure your trading wallet is set up. You may need to refresh the page.'
      }, { status: 404 })
    }
    
    console.log(`[check-gas] ✅ Trading wallet found: ${wallet.address.substring(0, 10)}...${wallet.address.substring(wallet.address.length - 8)}`)

    // Get network config
    const networkConfig = getNetworkConfig()
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl)
    
    // Get current ETH balance
    const balanceWei = await provider.getBalance(wallet.address)
    const balanceEth = parseFloat(ethers.formatEther(balanceWei))
    
    // Estimate required gas fees
    // Execution fee: 0.0001 ETH (default for opening positions)
    const executionFeeWei = BigInt('100000000000000') // 0.0001 ETH
    const executionFeeEth = 0.0001
    
    // Estimate gas cost: ~300k gas * current gas price
    // Use a conservative estimate of 300k gas
    const estimatedGas = 300000
    let gasPriceWei: bigint
    try {
      const feeData = await provider.getFeeData()
      gasPriceWei = feeData.gasPrice || BigInt('2000000000') // Default to 2 gwei if not available
    } catch {
      gasPriceWei = BigInt('2000000000') // 2 gwei fallback
    }
    
    const estimatedGasCostWei = BigInt(estimatedGas) * gasPriceWei
    const estimatedGasCostEth = parseFloat(ethers.formatEther(estimatedGasCostWei))
    
    // Total required: execution fee + gas cost + 10% buffer
    const totalRequiredWei = executionFeeWei + estimatedGasCostWei
    const totalRequiredWeiWithBuffer = (totalRequiredWei * BigInt(110)) / BigInt(100) // Add 10% buffer
    const totalRequiredEth = parseFloat(ethers.formatEther(totalRequiredWeiWithBuffer))
    
    const hasSufficientGas = balanceWei >= totalRequiredWeiWithBuffer
    const shortfallEth = hasSufficientGas ? 0 : (totalRequiredEth - balanceEth)
    
    return NextResponse.json({
      hasSufficientGas,
      balanceEth: parseFloat(balanceEth.toFixed(6)),
      requiredEth: parseFloat(totalRequiredEth.toFixed(6)),
      shortfallEth: parseFloat(shortfallEth.toFixed(6)),
      breakdown: {
        executionFeeEth: parseFloat(executionFeeEth.toFixed(6)),
        estimatedGasCostEth: parseFloat(estimatedGasCostEth.toFixed(6)),
        bufferEth: parseFloat((totalRequiredEth - executionFeeEth - estimatedGasCostEth).toFixed(6))
      },
      walletAddress: wallet.address
    })
  } catch (error) {
    console.error('[API] Error checking gas fees:', error)
    return NextResponse.json(
      { 
        error: 'Failed to check gas fees',
        hasSufficientGas: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
