import { AvantisClient } from '@/lib/services/AvantisClient';
import { Position, Balance } from '@/lib/services/AvantisClient';

// Cache for balance data (5 second TTL)
interface CacheEntry {
  data: any;
  timestamp: number;
}

const balanceCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5000; // 5 seconds

export interface AvantisBalance {
  totalValue: number;
  usdcBalance: number;
  usdcAllowance: number;
  totalCollateral: number;
  positions: Array<{
    symbol: string;
    pair_index: number;
    size: number;
    entryPrice: number;
    currentPrice: number;
    pnl: number;
    is_long: boolean;
    leverage: number;
  }>;
}

/**
 * Get Avantis balance for a wallet address (Base Account compatible)
 * For Base Accounts, we can query by address if the Avantis service supports it
 */
export async function getAvantisBalanceByAddress(
  address: string, 
  network?: string
): Promise<AvantisBalance> {
  try {
    // Use NEXT_PUBLIC_ prefix for client-side access, or fetch from API route
    const avantisApiUrl = typeof window !== 'undefined' 
      ? (process.env.NEXT_PUBLIC_AVANTIS_API_URL || '/api/avantis-proxy')
      : (process.env.NEXT_PUBLIC_AVANTIS_API_URL || process.env.AVANTIS_API_URL || 'http://localhost:8000');
    
    // Try to query by address (if Avantis service supports it)
    // Note: This may require updating the Avantis service to support address-based queries
    const response = await fetch(`${avantisApiUrl}/api/balance?address=${address}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Avantis API error: ${response.statusText}`);
    }

    const balanceData = await response.json();
    
    // Get positions by address
    const positionsResponse = await fetch(`${avantisApiUrl}/api/positions?address=${address}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const positionsData = positionsResponse.ok ? await positionsResponse.json() : { positions: [] };
    
    const transformedPositions = (positionsData.positions || []).map((pos: any) => ({
      symbol: pos.symbol,
      pair_index: pos.pair_index,
      size: pos.collateral * pos.leverage * (pos.is_long ? 1 : -1),
      entryPrice: pos.entry_price,
      currentPrice: pos.current_price,
      pnl: pos.pnl,
      is_long: pos.is_long,
      leverage: pos.leverage
    }));

    return {
      totalValue: balanceData.total_collateral || balanceData.total_balance || 0,
      usdcBalance: balanceData.usdc_balance || 0,
      usdcAllowance: balanceData.usdc_allowance || 0,
      totalCollateral: balanceData.total_collateral || 0,
      positions: transformedPositions
    };
  } catch (error) {
    console.error('[AvantisBalance] Error fetching balance by address:', error);
    throw new Error(`Failed to fetch Avantis balance for address: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get Avantis balance for a wallet (using private key - for traditional wallets)
 */
export async function getAvantisBalance(privateKey: string, network?: string): Promise<AvantisBalance> {
  try {
    const cacheKey = `balance_${privateKey}`;
    const cached = balanceCache.get(cacheKey);
    
    // Check cache
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    const avantisApiUrl = process.env.NEXT_PUBLIC_AVANTIS_API_URL || process.env.AVANTIS_API_URL || 'http://localhost:8000';
    const avantisClient = new AvantisClient({
      baseUrl: avantisApiUrl,
      privateKey,
      network: network || process.env.NEXT_PUBLIC_AVANTIS_NETWORK || process.env.AVANTIS_NETWORK || 'base-mainnet'
    });

    // Get balance and positions
    const [balance, positions] = await Promise.all([
      avantisClient.getBalance(),
      avantisClient.getPositions()
    ]);

    // Transform positions to match expected format
    const transformedPositions = positions.map(pos => ({
      symbol: pos.symbol,
      pair_index: pos.pair_index,
      size: pos.collateral * pos.leverage * (pos.is_long ? 1 : -1),
      entryPrice: pos.entry_price,
      currentPrice: pos.current_price,
      pnl: pos.pnl,
      is_long: pos.is_long,
      leverage: pos.leverage
    }));

    const result: AvantisBalance = {
      totalValue: balance.total_collateral,
      usdcBalance: balance.usdc_balance,
      usdcAllowance: balance.usdc_allowance,
      totalCollateral: balance.total_collateral,
      positions: transformedPositions
    };

    // Cache the result
    balanceCache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });

    return result;
  } catch (error) {
    console.error('[AvantisBalance] Error fetching balance:', error);
    // If we get an error, it likely means the wallet is not connected to Avantis
    throw new Error(`Wallet not connected to Avantis: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get Avantis balance in USD
 */
export async function getAvantisBalanceUSD(privateKey: string, network?: string): Promise<number> {
  try {
    const balance = await getAvantisBalance(privateKey, network);
    return balance.totalValue;
  } catch (error) {
    console.error('[AvantisBalance] Error fetching USD balance:', error);
    return 0;
  }
}

/**
 * Check if wallet has real Avantis balance
 */
export async function hasRealAvantisBalance(privateKey: string, network?: string): Promise<{ hasBalance: boolean; balance: number; isConnected: boolean }> {
  try {
    const balance = await getAvantisBalance(privateKey, network);
    const hasBalance = balance.totalValue > 0;
    const isConnected = true; // If we can fetch data, wallet is connected
    
    return {
      hasBalance,
      balance: balance.totalValue,
      isConnected
    };
  } catch (error) {
    console.error('[AvantisBalance] Error checking real balance:', error);
    // If we can't fetch data, wallet is not connected to Avantis
    return {
      hasBalance: false,
      balance: 0,
      isConnected: false
    };
  }
}

/**
 * Get Avantis positions
 */
export async function getAvantisPositions(privateKey: string, network?: string): Promise<Position[]> {
  try {
    const avantisApiUrl = process.env.NEXT_PUBLIC_AVANTIS_API_URL || process.env.AVANTIS_API_URL || 'http://localhost:8000';
    const avantisClient = new AvantisClient({
      baseUrl: avantisApiUrl,
      privateKey,
      network: network || process.env.NEXT_PUBLIC_AVANTIS_NETWORK || process.env.AVANTIS_NETWORK || 'base-mainnet'
    });

    return await avantisClient.getPositions();
  } catch (error) {
    console.error('[AvantisBalance] Error fetching positions:', error);
    return [];
  }
}

/**
 * Get total collateral
 */
export async function getTotalCollateral(privateKey: string, network?: string): Promise<number> {
  try {
    const balance = await getAvantisBalance(privateKey, network);
    return balance.totalCollateral;
  } catch (error) {
    console.error('[AvantisBalance] Error fetching total collateral:', error);
    return 0;
  }
}

/**
 * Check USDC allowance
 */
export async function checkUSDCAllowance(privateKey: string, network?: string): Promise<number> {
  try {
    const avantisApiUrl = process.env.NEXT_PUBLIC_AVANTIS_API_URL || process.env.AVANTIS_API_URL || 'http://localhost:8000';
    const avantisClient = new AvantisClient({
      baseUrl: avantisApiUrl,
      privateKey,
      network: network || process.env.NEXT_PUBLIC_AVANTIS_NETWORK || process.env.AVANTIS_NETWORK || 'base-mainnet'
    });

    const balance = await avantisClient.getBalance();
    return balance.usdc_allowance;
  } catch (error) {
    console.error('[AvantisBalance] Error checking USDC allowance:', error);
    return 0;
  }
}

/**
 * Format balance for display
 */
export function formatBalance(balance: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(balance);
}
