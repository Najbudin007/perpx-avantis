import { Regime } from './regime';
export declare function getBudgetAndLeverage(regime: Regime, symbol?: string, userBudget?: number): {
    budget: number;
    leverage: number;
};
export declare function getSymbolLeverageLimit(symbol: string, positionSize?: number): number;
export declare function validateLeverage(symbol: string, leverage: number, positionSize?: number): {
    isValid: boolean;
    maxAllowed: number;
    reason?: string;
};
export declare function getMaxLeverageForSymbol(symbol: string): number;
export declare function getLeverageTiersForSymbol(symbol: string): Array<{
    lowerBound: number;
    maxLeverage: number;
}>;
export declare function calculateBudgetLimits(totalBudget: number, maxPositions: number): {
    minBudgetPerPosition: number;
    maxBudgetPerPosition: number;
    recommendedBudgetPerPosition: number;
    isValid: boolean;
    reason?: string;
};
export declare function validateAndCapBudget(totalBudget: number, maxPositions: number, symbol?: string, platform?: 'hyperliquid' | 'avantis'): {
    budgetPerPosition: number;
    isValid: boolean;
    reason?: string;
    warnings?: string[];
};
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
export declare function validateAvantisMinPosition(symbol: string, pairIndex: number, collateral: number, leverage: number, avantisServiceUrl?: string): Promise<{
    isValid: boolean;
    requiredMinCollateral?: number;
    pairMinLevPosUSDC?: number;
    reason?: string;
}>;
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
export declare function validateAndCapBudgetWithAvantis(totalBudget: number, maxPositions: number, options?: {
    symbol?: string;
    pairIndex?: number;
    leverage?: number;
    avantisServiceUrl?: string;
    platform?: 'hyperliquid' | 'avantis';
}): Promise<{
    budgetPerPosition: number;
    isValid: boolean;
    reason?: string;
    warnings?: string[];
    requiredMinCollateral?: number;
    pairMinLevPosUSDC?: number;
}>;
//# sourceMappingURL=BudgetAndLeverage.d.ts.map