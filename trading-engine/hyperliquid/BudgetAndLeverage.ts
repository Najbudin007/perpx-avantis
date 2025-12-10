import adaptiveConfig from './adaptiveConfig.json';
import { Regime } from './regime';

// Avantis service URL for API calls
// HARDCODED for Farcaster users: Always use Avantis service URL (not RPC URL)
// This ensures Farcaster users always connect to the correct Avantis service
// regardless of what's in .env file (which might have RPC URL)
function getAvantisServiceUrl(): string {
  // Check if env var is set and doesn't look like an RPC URL
  const envUrl = process.env.AVANTIS_SERVICE_URL || process.env.AVANTIS_API_URL;
  if (envUrl && 
      !envUrl.includes('alchemy') && 
      !envUrl.includes('rpc') && 
      !envUrl.includes('g.alchemy') &&
      !envUrl.includes('mainnet.base.org') &&
      envUrl.includes('8000')) {
    // Only use env var if it looks like an Avantis service URL (contains 8000 and not RPC)
    return envUrl;
  }
  // HARDCODED: Always use Avantis service URL
  // Try Docker service name first (for containerized deployments)
  return 'http://perpx-avantis-service:8000';
}
const AVANTIS_SERVICE_URL = getAvantisServiceUrl();

// Hyperliquid SDK budget limits
const HYPERLIQUID_BUDGET_LIMITS = {
  MIN_BUDGET_PER_POSITION: 1, // $1 minimum per position
  MAX_BUDGET_PER_POSITION: 1000000, // $1M maximum per position (conservative)
  MIN_TOTAL_BUDGET: 10, // $10 minimum total budget
  MAX_TOTAL_BUDGET: 10000000 // $10M maximum total budget (conservative)
};

export function getBudgetAndLeverage(regime: Regime, symbol?: string, userBudget?: number): {
  budget: number;
  leverage: number;
} {
  // Use user's budget - no fallback to regime-based budget
  const budget = userBudget ?? 200; // Default to $200 if no user budget provided
  
  // ========================================================
  // RISK MANAGEMENT: Leverage based on budget size
  // Smaller budgets = lower leverage to prevent liquidation
  // ========================================================
  let leverage: number;
  
  // Budget-based leverage limits for risk management
  if (budget < 20) {
    // Very small balance: max 5x to give 20% buffer before liquidation
    leverage = 5;
    console.log(`⚠️ Small balance ($${budget}): Using conservative 5x leverage`);
  } else if (budget < 50) {
    // Small balance: max 10x leverage
    leverage = 10;
    console.log(`📊 Medium balance ($${budget}): Using moderate 10x leverage`);
  } else if (budget < 100) {
    // Medium balance: max 15x leverage  
    leverage = 15;
    console.log(`📊 Good balance ($${budget}): Using 15x leverage`);
  } else if (budget < 500) {
    // Larger balance: max 20x leverage
    leverage = 20;
    console.log(`💪 Solid balance ($${budget}): Using 20x leverage`);
  } else {
    // Large balance: allow higher leverage (max 25x for safety)
    leverage = 25;
    console.log(`🚀 Large balance ($${budget}): Using 25x leverage`);
  }
  
  // Get symbol-specific leverage limit if available
  if (symbol && adaptiveConfig.hyperliquidLeverageLimits && symbol in adaptiveConfig.hyperliquidLeverageLimits) {
    const symbolConfig = (adaptiveConfig.hyperliquidLeverageLimits as any)[symbol];
    const symbolMaxLeverage = symbolConfig.maxLeverage;
    
    // Cap at symbol's maximum allowed leverage
    if (leverage > symbolMaxLeverage) {
      leverage = symbolMaxLeverage;
      console.log(`🎯 ${symbol} leverage capped at ${leverage}x (symbol limit)`);
    }
  }
  
  // Apply minimum safety limit
  const minLeverage = adaptiveConfig.leverageSafetySettings?.minLeverage ?? 2;
  leverage = Math.max(minLeverage, leverage);

  return { budget, leverage };
}

export function getSymbolLeverageLimit(symbol: string, positionSize?: number): number {
  if (!adaptiveConfig.hyperliquidLeverageLimits || !(symbol in adaptiveConfig.hyperliquidLeverageLimits)) {
    return 50; // Default high leverage
  }

  const symbolConfig = (adaptiveConfig.hyperliquidLeverageLimits as any)[symbol];

  // Handle tiered leverage - use the highest tier available
  if (symbolConfig.tiered && symbolConfig.tiers && positionSize) {
    // Find the highest leverage tier for the position size
    let maxLeverage = 0;
    for (const tier of symbolConfig.tiers) {
      if (positionSize >= tier.lowerBound && tier.maxLeverage > maxLeverage) {
        maxLeverage = tier.maxLeverage;
      }
    }
    return maxLeverage > 0 ? maxLeverage : symbolConfig.maxLeverage;
  }

  return symbolConfig.maxLeverage;
}



export function validateLeverage(symbol: string, leverage: number, positionSize?: number): {
  isValid: boolean;
  maxAllowed: number;
  reason?: string;
} {
  const symbolLimit = getSymbolLeverageLimit(symbol, positionSize);
  const globalMin = adaptiveConfig.leverageSafetySettings?.minLeverage ?? 1;
  
  // Allow maximum leverage up to symbol limit
  const maxAllowed = symbolLimit;
  
  if (leverage < globalMin) {
    return {
      isValid: false,
      maxAllowed,
      reason: `Leverage ${leverage} is below minimum allowed ${globalMin}`
    };
  }
  
  if (leverage > maxAllowed) {
    return {
      isValid: false,
      maxAllowed,
      reason: `Leverage ${leverage} exceeds maximum allowed ${maxAllowed} for ${symbol}`
    };
  }
  
  return { isValid: true, maxAllowed };
}

// New function to get maximum leverage for a symbol
export function getMaxLeverageForSymbol(symbol: string): number {
  if (!adaptiveConfig.hyperliquidLeverageLimits || !(symbol in adaptiveConfig.hyperliquidLeverageLimits)) {
    return 50; // Default high leverage
  }

  const symbolConfig = (adaptiveConfig.hyperliquidLeverageLimits as any)[symbol];
  return symbolConfig.maxLeverage;
}

// New function to get all available leverage tiers for a symbol
export function getLeverageTiersForSymbol(symbol: string): Array<{lowerBound: number, maxLeverage: number}> {
  if (!adaptiveConfig.hyperliquidLeverageLimits || !(symbol in adaptiveConfig.hyperliquidLeverageLimits)) {
    return [{ lowerBound: 0, maxLeverage: 50 }];
  }

  const symbolConfig = (adaptiveConfig.hyperliquidLeverageLimits as any)[symbol];
  if (symbolConfig.tiered && symbolConfig.tiers) {
    return symbolConfig.tiers;
  }

  return [{ lowerBound: 0, maxLeverage: symbolConfig.maxLeverage }];
}

// New function to calculate budget limits based on Hyperliquid SDK
export function calculateBudgetLimits(
  totalBudget: number, 
  maxPositions: number
): {
  minBudgetPerPosition: number;
  maxBudgetPerPosition: number;
  recommendedBudgetPerPosition: number;
  isValid: boolean;
  reason?: string;
} {
  // Validate total budget
  if (totalBudget < HYPERLIQUID_BUDGET_LIMITS.MIN_TOTAL_BUDGET) {
    return {
      minBudgetPerPosition: HYPERLIQUID_BUDGET_LIMITS.MIN_BUDGET_PER_POSITION,
      maxBudgetPerPosition: HYPERLIQUID_BUDGET_LIMITS.MAX_BUDGET_PER_POSITION,
      recommendedBudgetPerPosition: HYPERLIQUID_BUDGET_LIMITS.MIN_BUDGET_PER_POSITION,
      isValid: false,
      reason: `Total budget $${totalBudget} is below minimum $${HYPERLIQUID_BUDGET_LIMITS.MIN_TOTAL_BUDGET}`
    };
  }

  if (totalBudget > HYPERLIQUID_BUDGET_LIMITS.MAX_TOTAL_BUDGET) {
    return {
      minBudgetPerPosition: HYPERLIQUID_BUDGET_LIMITS.MIN_BUDGET_PER_POSITION,
      maxBudgetPerPosition: HYPERLIQUID_BUDGET_LIMITS.MAX_BUDGET_PER_POSITION,
      recommendedBudgetPerPosition: HYPERLIQUID_BUDGET_LIMITS.MAX_BUDGET_PER_POSITION,
      isValid: false,
      reason: `Total budget $${totalBudget} exceeds maximum $${HYPERLIQUID_BUDGET_LIMITS.MAX_TOTAL_BUDGET}`
    };
  }

  // Calculate per-position budget
  const rawBudgetPerPosition = totalBudget / maxPositions;

  // Apply Hyperliquid SDK limits
  const minBudgetPerPosition = HYPERLIQUID_BUDGET_LIMITS.MIN_BUDGET_PER_POSITION;
  const maxBudgetPerPosition = Math.min(
    HYPERLIQUID_BUDGET_LIMITS.MAX_BUDGET_PER_POSITION,
    totalBudget // Can't exceed total budget
  );

  // Cap the recommended budget within limits
  const recommendedBudgetPerPosition = Math.max(
    minBudgetPerPosition,
    Math.min(maxBudgetPerPosition, rawBudgetPerPosition)
  );

  const isValid = recommendedBudgetPerPosition >= minBudgetPerPosition && 
                  recommendedBudgetPerPosition <= maxBudgetPerPosition;

  return {
    minBudgetPerPosition,
    maxBudgetPerPosition,
    recommendedBudgetPerPosition,
    isValid,
    reason: isValid ? undefined : `Budget per position $${recommendedBudgetPerPosition} is outside valid range`
  };
}

// Avantis minimum collateral requirement
// Updated to match Avantis UI which allows $10 minimum
const AVANTIS_MIN_COLLATERAL = 10.0; // USDC

// New function to validate and cap budget per position
export function validateAndCapBudget(
  totalBudget: number,
  maxPositions: number,
  symbol?: string,
  platform: 'hyperliquid' | 'avantis' = 'avantis' // Default to Avantis for web trading
): {
  budgetPerPosition: number;
  isValid: boolean;
  reason?: string;
  warnings?: string[];
} {
  const budgetLimits = calculateBudgetLimits(totalBudget, maxPositions);
  const warnings: string[] = [];

  // Use platform-specific minimum
  const minRequired = platform === 'avantis' ? AVANTIS_MIN_COLLATERAL : HYPERLIQUID_BUDGET_LIMITS.MIN_BUDGET_PER_POSITION;

  if (!budgetLimits.isValid) {
    return {
      budgetPerPosition: budgetLimits.recommendedBudgetPerPosition,
      isValid: false,
      reason: budgetLimits.reason,
      warnings
    };
  }

  // Check if budget per position meets platform minimum
  if (budgetLimits.recommendedBudgetPerPosition < minRequired) {
    return {
      budgetPerPosition: budgetLimits.recommendedBudgetPerPosition,
      isValid: false,
      reason: `Budget per position $${budgetLimits.recommendedBudgetPerPosition.toFixed(2)} is below ${platform === 'avantis' ? 'Avantis' : 'Hyperliquid'} minimum $${minRequired}. Total budget $${totalBudget} with ${maxPositions} positions = $${(totalBudget / maxPositions).toFixed(2)} per position. Increase budget to at least $${(minRequired * maxPositions).toFixed(2)} or reduce max positions to ${Math.floor(totalBudget / minRequired)}.`,
      warnings
    };
  }

  // Check if budget is too small for effective trading (below recommended)
  if (budgetLimits.recommendedBudgetPerPosition < minRequired * 1.5) {
    warnings.push(`Budget per position $${budgetLimits.recommendedBudgetPerPosition.toFixed(2)} is close to ${platform === 'avantis' ? 'Avantis' : 'Hyperliquid'} minimum $${minRequired}. Consider increasing total budget for better position sizing.`);
  }

  // Check if budget is very large (risk warning)
  if (budgetLimits.recommendedBudgetPerPosition > 10000) {
    warnings.push(`High budget per position: $${budgetLimits.recommendedBudgetPerPosition.toFixed(2)}. Ensure proper risk management.`);
  }

  const result = {
    budgetPerPosition: budgetLimits.recommendedBudgetPerPosition,
    isValid: true,
    warnings: warnings.length > 0 ? warnings : undefined
  };

  return result;
}

/**
 * Validate that a position meets Avantis minimum position size requirements.
 * 
 * This function queries the Avantis service to get the on-chain minimum position
 * size requirement and validates that the provided collateral meets it.
 * 
 * @param symbol - Trading symbol (e.g., "BTC", "ETH")
 * @param pairIndex - Avantis pair index
 * @param collateral - Collateral amount in USDC
 * @param leverage - Leverage multiplier
 * @param avantisServiceUrl - Optional Avantis service URL (defaults to env var or localhost:8000)
 * @returns Validation result with isValid flag and detailed information
 */
export async function validateAvantisMinPosition(
  symbol: string,
  pairIndex: number,
  collateral: number,
  leverage: number,
  avantisServiceUrl: string = AVANTIS_SERVICE_URL
): Promise<{
  isValid: boolean;
  requiredMinCollateral?: number;
  pairMinLevPosUSDC?: number;
  reason?: string;
}> {
  try {
    const url = `${avantisServiceUrl}/api/min-position?pair_index=${pairIndex}&leverage=${leverage}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      // If the contract call reverts (pair index doesn't exist), this is non-blocking
      // The backend validation will catch BELOW_MIN_POS errors anyway
      if (errorText.includes('execution reverted') || errorText.includes('no data')) {
        console.warn(`[validateAvantisMinPosition] On-chain minimum not available for pair ${pairIndex} (contract may not have this pair configured). Allowing trade to proceed - backend will validate.`);
        return {
          isValid: true, // Non-blocking: allow trade, backend will catch BELOW_MIN_POS
          reason: `On-chain minimum not available for this pair, but allowing trade to proceed`
        };
      }
      // CRITICAL FIX: Treat 404 (endpoint not found) as non-blocking
      // The Avantis service endpoint might not exist, but backend will validate anyway
      if (response.status === 404) {
        console.warn(`[validateAvantisMinPosition] Avantis service endpoint not found (404) for pair ${pairIndex}. This is non-blocking - backend will validate minimum position size.`);
        return {
          isValid: true, // Non-blocking: allow trade, backend will catch BELOW_MIN_POS
          reason: `Avantis service endpoint not available, but allowing trade to proceed - backend will validate`
        };
      }
      return {
        isValid: false,
        reason: `Failed to fetch minimum position size: ${response.status} ${response.statusText}. ${errorText}`
      };
    }

    const data = await response.json() as {
      pair_index: number;
      leverage: number;
      pair_min_lev_pos_usdc: number;
      min_collateral_usdc: number;
      status: string;
      error?: string;
    };

    if (data.status === 'error' || data.error) {
      const errorMsg = data.error || 'Failed to fetch minimum position size from contract';
      // If the contract call reverts (pair index doesn't exist or not configured), 
      // this is non-blocking - the backend validation will catch BELOW_MIN_POS errors anyway
      if (errorMsg.includes('execution reverted') || errorMsg.includes('no data')) {
        console.warn(`[validateAvantisMinPosition] On-chain minimum not available for pair ${pairIndex} (contract may not have this pair configured). Allowing trade to proceed - backend will validate.`);
        return {
          isValid: true, // Non-blocking: allow trade, backend will catch BELOW_MIN_POS
          reason: `On-chain minimum not available for this pair, but allowing trade to proceed`
        };
      }
      return {
        isValid: false,
        reason: errorMsg
      };
    }

    const requiredMinCollateral = data.min_collateral_usdc;

    if (collateral < requiredMinCollateral) {
      return {
        isValid: false,
        requiredMinCollateral,
        pairMinLevPosUSDC: data.pair_min_lev_pos_usdc,
        reason: `Position size below Avantis contract minimum for ${symbol}. With ${leverage}x leverage you must use at least ≈ ${requiredMinCollateral.toFixed(2)} USDC collateral. Current: ${collateral.toFixed(2)} USDC. (Contract pairMinLevPosUSDC = ${(data.pair_min_lev_pos_usdc / 1e6).toFixed(2)} USDC)`
      };
    }

    console.log(`✅ ${symbol} position validated: collateral=${collateral.toFixed(2)} USDC, leverage=${leverage}x, min_required=${requiredMinCollateral.toFixed(2)} USDC`);
    
    return {
      isValid: true,
      requiredMinCollateral,
      pairMinLevPosUSDC: data.pair_min_lev_pos_usdc
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[validateAvantisMinPosition] Error validating position for ${symbol}:`, errorMessage);
    return {
      isValid: false,
      reason: `Error validating position: ${errorMessage}`
    };
  }
}

/**
 * Validate and cap budget with Avantis-specific minimum position size checks.
 * 
 * This function combines basic budget validation with on-chain Avantis minimum
 * position size validation when pairIndex and leverage are provided.
 * 
 * @param totalBudget - Total budget available
 * @param maxPositions - Maximum number of positions
 * @param options - Optional configuration including symbol, pairIndex, leverage, etc.
 * @returns Validation result with budget per position and detailed information
 */
export async function validateAndCapBudgetWithAvantis(
  totalBudget: number,
  maxPositions: number,
  options?: {
    symbol?: string;
    pairIndex?: number;
    leverage?: number;
    avantisServiceUrl?: string;
    platform?: 'hyperliquid' | 'avantis';
  }
): Promise<{
  budgetPerPosition: number;
  isValid: boolean;
  reason?: string;
  warnings?: string[];
  requiredMinCollateral?: number;
  pairMinLevPosUSDC?: number;
}> {
  // First, do basic budget validation
  const basicValidation = validateAndCapBudget(
    totalBudget,
    maxPositions,
    options?.symbol,
    options?.platform || 'avantis'
  );

  if (!basicValidation.isValid) {
    return basicValidation;
  }

  // If Avantis-specific validation is requested and we have the required info
  if (options?.platform === 'avantis' && options?.pairIndex !== undefined && options?.leverage !== undefined && options?.symbol) {
    try {
      const avantisValidation = await validateAvantisMinPosition(
        options.symbol,
        options.pairIndex,
        basicValidation.budgetPerPosition,
        options.leverage,
        options.avantisServiceUrl
      );

      if (!avantisValidation.isValid) {
        return {
          budgetPerPosition: basicValidation.budgetPerPosition,
          isValid: false,
          reason: avantisValidation.reason,
          warnings: basicValidation.warnings,
          requiredMinCollateral: avantisValidation.requiredMinCollateral,
          pairMinLevPosUSDC: avantisValidation.pairMinLevPosUSDC
        };
      }

      // If Avantis validation passed, return with additional info
      return {
        budgetPerPosition: basicValidation.budgetPerPosition,
        isValid: true,
        warnings: basicValidation.warnings,
        requiredMinCollateral: avantisValidation.requiredMinCollateral,
        pairMinLevPosUSDC: avantisValidation.pairMinLevPosUSDC
      };
    } catch (error) {
      // If Avantis validation fails due to network/API error, log but don't block
      // (the on-chain validation will catch it anyway)
      console.warn(`[validateAndCapBudgetWithAvantis] Avantis validation error (non-blocking):`, error);
      return basicValidation;
    }
  }

  // Return basic validation if Avantis-specific check not needed
  return basicValidation;
}
