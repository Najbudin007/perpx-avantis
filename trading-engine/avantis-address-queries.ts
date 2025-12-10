/**
 * Avantis balance and position queries using wallet address (for Base Accounts)
 * Since Base Accounts don't have private keys, we query by address
 */

interface AvantisPosition {
  symbol: string;
  pair_index: number;
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  is_long: boolean;
  leverage: number;
}

interface AvantisBalanceData {
  totalValue: number;
  usdcBalance: number;
  usdcAllowance: number;
  totalCollateral: number;
}

/**
 * Query Avantis API for balance using wallet address
 * Note: This requires the Avantis service to support address-based queries
 */
export async function getAvantisBalanceByAddress(
  address: string,
  avantisApiUrl?: string
): Promise<AvantisBalanceData> {
  try {
    // Default to port 8000 (Avantis service port)
    const apiUrl = avantisApiUrl || process.env.AVANTIS_API_URL || 'http://localhost:8000';
    
    // Call Avantis service API with address
    // Note: The Avantis service may need to be updated to support address-only queries
    const response = await fetch(`${apiUrl}/api/balance?address=${address}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Avantis API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      totalValue: data.total_collateral || data.total_balance || 0,
      usdcBalance: data.usdc_balance || 0,
      usdcAllowance: data.usdc_allowance || 0,
      totalCollateral: data.total_collateral || 0,
    };
  } catch (error) {
    console.error('[AvantisAddressQueries] Error fetching balance by address:', error);
    throw error;
  }
}

/**
 * Query Avantis API for positions using wallet address
 */
export async function getAvantisPositionsByAddress(
  address: string,
  avantisApiUrl?: string
): Promise<AvantisPosition[]> {
  try {
    // Default to port 8000 (Avantis service port)
    const apiUrl = avantisApiUrl || process.env.AVANTIS_API_URL || 'http://localhost:8000';
    
    // Call Avantis service API with address
    const response = await fetch(`${apiUrl}/api/positions?address=${address}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Avantis API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Transform positions to match expected format
    return (data.positions || []).map((pos: any) => ({
      symbol: pos.symbol,
      pair_index: pos.pair_index,
      size: pos.size || (pos.collateral * pos.leverage * (pos.is_long ? 1 : -1)),
      entryPrice: pos.entry_price,
      currentPrice: pos.current_price,
      pnl: pos.pnl || 0,
      is_long: pos.is_long,
      leverage: pos.leverage,
    }));
  } catch (error) {
    console.error('[AvantisAddressQueries] Error fetching positions by address:', error);
    return [];
  }
}

/**
 * Get total PnL for an address
 */
export async function getTotalPnLByAddress(
  address: string,
  avantisApiUrl?: string
): Promise<number> {
  try {
    const positions = await getAvantisPositionsByAddress(address, avantisApiUrl);
    return positions.reduce((sum, pos) => sum + (pos.pnl || 0), 0);
  } catch (error) {
    console.error('[AvantisAddressQueries] Error calculating total PnL:', error);
    return 0;
  }
}

