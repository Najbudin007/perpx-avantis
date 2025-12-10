import { ethers } from 'ethers'
import { getNetworkConfig, getSupportedTokens, ZERO_ADDRESS } from '@/lib/config/network'

export interface RealToken {
  address: string
  symbol: string
  name: string
  decimals: number
  isNative?: boolean
}

export interface RealTokenBalance {
  token: RealToken
  balance: string
  balanceFormatted: string
  valueUSD: number
  priceUSD?: number
}

export interface RealBalanceData {
  ethBalance: string
  ethBalanceFormatted: string
  ethPriceUSD: number
  totalPortfolioValue: number
  holdings: RealTokenBalance[]
  dailyChange: number
  dailyChangePercentage: number
  lastDayValue: number
}

// ERC-20 ABI for balance reading
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)'
]

export class RealBalanceService {
  private provider: ethers.JsonRpcProvider
  private tokens: RealToken[]
  private nativeSymbol: string

  constructor() {
    const network = getNetworkConfig()
    this.provider = new ethers.JsonRpcProvider(network.rpcUrl)
    this.nativeSymbol = network.nativeSymbol
    this.tokens = getSupportedTokens().map(token => ({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      isNative: token.isNative
    }))
  }

  async getNativePrice(): Promise<number> {
    try {
      const apis = [
        'https://api.coinbase.com/v2/exchange-rates?currency=ETH',
        'https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT',
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
      ]

      for (const api of apis) {
        try {
          const response = await fetch(api, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(5000)
          })
          const data = await response.json()

          if (api.includes('coinbase')) {
            return parseFloat(data.data.rates.USD) || 2500
          } else if (api.includes('binance')) {
            return parseFloat(data.price) || 2500
          } else if (api.includes('coingecko')) {
            return data.ethereum?.usd || 2500
          }
        } catch (err) {
          console.log(`Failed to fetch from ${api}:`, err instanceof Error ? err.message : String(err))
          continue
        }
      }

      return 2500
    } catch (error) {
      console.error('Error fetching native token price:', error)
      return 2500
    }
  }

  async getTokenPrice(symbol: string): Promise<number> {
    try {
      if (symbol === 'USDC' || symbol === 'USDT' || symbol === 'DAI') {
        return 1
      }

      const apis = [
        `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`,
        `https://api.coingecko.com/api/v3/simple/price?ids=${symbol.toLowerCase()}&vs_currencies=usd`
      ]

      for (const api of apis) {
        try {
          const response = await fetch(api, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(5000)
          })
          const data = await response.json()

          if (api.includes('binance')) {
            return parseFloat(data.price) || 0
          } else if (api.includes('coingecko')) {
            return data[symbol.toLowerCase()]?.usd || 0
          }
        } catch (err) {
          console.log(`Failed to fetch ${symbol} price from ${api}:`, err instanceof Error ? err.message : String(err))
          continue
        }
      }

      return 0
    } catch (error) {
      console.error(`Error fetching ${symbol} price:`, error)
      return symbol === 'USDC' || symbol === 'USDT' ? 1 : 0
    }
  }

  async getNativeBalance(address: string): Promise<{ balance: string; balanceFormatted: string; valueUSD: number }> {
    try {
      const balance = await this.provider.getBalance(address)
      const balanceFormatted = ethers.formatEther(balance)
      const nativePrice = await this.getNativePrice()
      const valueUSD = parseFloat(balanceFormatted) * nativePrice

      return {
        balance: balance.toString(),
        balanceFormatted,
        valueUSD
      }
    } catch (error) {
      console.error('Error fetching native balance:', error)
      return {
        balance: '0',
        balanceFormatted: '0.0',
        valueUSD: 0
      }
    }
  }

  async getTokenBalance(address: string, token: RealToken): Promise<RealTokenBalance> {
    try {
      if (token.isNative || token.address === ZERO_ADDRESS) {
        const nativeData = await this.getNativeBalance(address)
        const priceUSD = await this.getNativePrice()

        return {
          token,
          balance: nativeData.balance,
          balanceFormatted: `${nativeData.balanceFormatted} ${token.symbol}`,
          valueUSD: nativeData.valueUSD,
          priceUSD
        }
      }

      const contract = new ethers.Contract(token.address, ERC20_ABI, this.provider)
      const balance = await contract.balanceOf(address)
      const balanceFormatted = ethers.formatUnits(balance, token.decimals)
      const priceUSD = await this.getTokenPrice(token.symbol)
      const valueUSD = parseFloat(balanceFormatted) * priceUSD

      // Log balance for debugging
      if (token.symbol === 'USDC' && parseFloat(balanceFormatted) === 0) {
        console.log(`[RealBalanceService] USDC balance is 0 for ${address} on Base network. Token contract: ${token.address}`)
      }

      return {
        token,
        balance: balance.toString(),
        balanceFormatted: `${parseFloat(balanceFormatted).toFixed(4)} ${token.symbol}`,
        valueUSD,
        priceUSD
      }
    } catch (error) {
      console.error(`[RealBalanceService] Error fetching ${token.symbol} balance for ${address}:`, error)
      if (error instanceof Error) {
        console.error(`[RealBalanceService] Error details: ${error.message}`)
      }
      return {
        token,
        balance: '0',
        balanceFormatted: `0.0000 ${token.symbol}`,
        valueUSD: 0,
        priceUSD: 0
      }
    }
  }

  async getAllBalances(address: string): Promise<RealBalanceData> {
    try {

      const tokenBalances = await Promise.all(
        this.tokens.map(token => this.getTokenBalance(address, token))
      )

      const nativeBalance = tokenBalances.find(balance => balance.token.isNative) || null

      // Calculate total: sum of ALL token values (including native ETH)
      const totalPortfolioValue = tokenBalances.reduce(
        (sum, tokenBalance) => sum + tokenBalance.valueUSD,
        0
      )

      const dailyChange = 0
      const dailyChangePercentage = 0
      const lastDayValue = totalPortfolioValue


      return {
        ethBalance: nativeBalance?.balance || '0',
        ethBalanceFormatted: nativeBalance
          ? nativeBalance.balanceFormatted.replace(` ${this.nativeSymbol}`, '')
          : '0.0',
        ethPriceUSD: nativeBalance?.priceUSD || (await this.getNativePrice()),
        totalPortfolioValue,
        holdings: tokenBalances,
        dailyChange,
        dailyChangePercentage,
        lastDayValue
      }
    } catch (error) {
      console.error('[RealBalanceService] Error fetching balances:', error)

      return {
        ethBalance: '0',
        ethBalanceFormatted: '0.0',
        ethPriceUSD: 2500,
        totalPortfolioValue: 0,
        holdings: [],
        dailyChange: 0,
        dailyChangePercentage: 0,
        lastDayValue: 0
      }
    }
  }
}
