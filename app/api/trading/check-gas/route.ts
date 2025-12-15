import { NextRequest, NextResponse } from 'next/server'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'
import { BaseAccountWalletService } from '@/lib/services/BaseAccountWalletService'
import { ethers } from 'ethers'
import { getNetworkConfig } from '@/lib/config/network'

// Lazy initialization
function getFarcasterWalletService(): BaseAccountWalletService {
  return new BaseAccountWalletService()
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
    
    const tokenPreview = token.length > 20 ? `${token.substring(0, 10)}...${token.substring(token.length - 10)}` : 'SHORT_TOKEN'
    console.log(`[check-gas] Verifying token for user: ${tokenPreview}`)
    
    let authContext
    try {
      authContext = await verifyTokenAndGetContext(token)
      console.log(`[check-gas] ✅ Token verified: FID: ${authContext.fid}`)
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
    
    // Farcaster users only
    if (!authContext.fid) {
      return NextResponse.json({ error: 'User FID required' }, { status: 400 })
    }
    
    const farcasterWalletService = getFarcasterWalletService()
    const farcasterWallet = await farcasterWalletService.getWalletWithKey(authContext.fid, 'ethereum')
    
    if (!farcasterWallet || !farcasterWallet.address) {
      console.error(`[check-gas] ❌ Trading wallet not found for FID: ${authContext.fid}`)
      return NextResponse.json({ 
        error: 'Trading wallet not found',
        hasSufficientGas: false,
        message: 'Please ensure your trading wallet is set up. You may need to refresh the page.'
      }, { status: 404 })
    }
    
    const wallet = {
      address: farcasterWallet.address,
      privateKey: farcasterWallet.privateKey
    }
    
    console.log(`[check-gas] ✅ Trading wallet found: ${wallet.address.substring(0, 10)}...${wallet.address.substring(wallet.address.length - 8)}`)

    // Get network config
    const networkConfig = getNetworkConfig()
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl)
    
    // Get current ETH balance
    const balanceWei = await provider.getBalance(wallet.address)
    const balanceEth = parseFloat(ethers.formatEther(balanceWei))
    
    // Estimate required gas fees
    const executionFeeWei = BigInt('100000000000000') // 0.0001 ETH
    const executionFeeEth = 0.0001
    
    const estimatedGas = 300000
    let gasPriceWei: bigint
    try {
      const feeData = await provider.getFeeData()
      gasPriceWei = feeData.gasPrice || BigInt('2000000000')
    } catch {
      gasPriceWei = BigInt('2000000000')
    }
    
    const estimatedGasCostWei = BigInt(estimatedGas) * gasPriceWei
    const estimatedGasCostEth = parseFloat(ethers.formatEther(estimatedGasCostWei))
    
    // Total required: execution fee + gas cost + 10% buffer
    const totalRequiredWei = executionFeeWei + estimatedGasCostWei
    const totalRequiredWeiWithBuffer = (totalRequiredWei * BigInt(110)) / BigInt(100)
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
