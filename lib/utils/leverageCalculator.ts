/**
 * System-controlled, balance-scaled, risk-normalized leverage calculation
 * 
 * Leverage is automatically calculated based on balance with safety constraints.
 * No user input is accepted - leverage is fully system-controlled.
 * 
 * Safety Model:
 * - Leverage is capped at 13x to ensure liquidation distance ≥ 3 × SL distance
 * - SL remains capped at 2.5% (existing logic unchanged)
 * - Liquidation distance = 100% / leverage
 * - Safety: liquidationDistancePct ≥ SL_PCT × LIQ_BUFFER (2.5% × 3 = 7.5%)
 * - Max safe leverage: 100 / 7.5 = 13.33... → capped at 13x
 * 
 * Balance-Scaled Leverage Tiers:
 * - < $10:  2x (minimum safety)
 * - < $25:  3x
 * - < $50:  5x
 * - < $100: 7x
 * - < $250: 10x
 * - ≥ $250: 13x (maximum safe leverage)
 */

// Safety constants
const SL_PCT = 2.5; // Stop loss percentage (existing logic - DO NOT CHANGE)
const LIQ_BUFFER = 3; // Liquidation safety buffer multiplier

// Maximum safe leverage: liquidation distance must be ≥ SL_PCT × LIQ_BUFFER
// liquidationDistancePct = 100 / leverage
// 100 / leverage ≥ SL_PCT × LIQ_BUFFER
// leverage ≤ 100 / (SL_PCT × LIQ_BUFFER)
// leverage ≤ 100 / (2.5 × 3) = 100 / 7.5 = 13.33...
export const MAX_SAFE_LEVERAGE = Math.floor(100 / (SL_PCT * LIQ_BUFFER)); // = 13x

/**
 * Calculate leverage from balance using balance-scaled tiers
 * @param balance - Account balance in USD
 * @returns Leverage multiplier (2x to 13x)
 */
function leverageFromBalance(balance: number): number {
  if (balance < 10) return 2;
  if (balance < 25) return 3;
  if (balance < 50) return 5;
  if (balance < 100) return 7;
  if (balance < 250) return 10;
  return 13;
}

/**
 * Calculate appropriate leverage based on balance/budget
 * 
 * Leverage is fully system-controlled - no user input accepted.
 * Final leverage is clamped by safety constraints (never exceeds MAX_SAFE_LEVERAGE).
 * 
 * @param balance - Account balance in USD
 * @returns System-calculated leverage multiplier (2x to 13x)
 */
export function calculateLeverageFromBalance(balance: number): number {
  // Calculate balance-based leverage
  const balanceLeverage = leverageFromBalance(balance);
  
  // Clamp by safety limit to ensure liquidation buffer
  const finalLeverage = Math.min(balanceLeverage, MAX_SAFE_LEVERAGE);
  
  return finalLeverage;
}

/**
 * Get default leverage when no balance is available
 * Uses minimum safe leverage (2x)
 * 
 * @returns Default leverage multiplier (2x)
 */
export function getDefaultLeverage(): number {
  return 2; // Minimum safe leverage
}

