/**
 * Avantis Trading Functions
 * This module provides functions to interact with Avantis API for opening/closing positions
 */
export interface OpenPositionParams {
    symbol: string;
    collateral: number;
    leverage: number;
    is_long: boolean;
    private_key: string;
    tp?: number;
    sl?: number;
}
export interface ClosePositionParams {
    pair_index: number;
    private_key: string;
}
/**
 * Open a position on Avantis with pre-validation to prevent BELOW_MIN_POS errors.
 *
 * This function validates position size against on-chain minimum requirements
 * before sending the transaction, preventing gas waste from reverts.
 */
export declare function openAvantisPositionSafe(params: OpenPositionParams, options?: {
    skipBalanceCheck?: boolean;
    skipVerification?: boolean;
    maxRetries?: number;
    pairIndex?: number;
}): Promise<{
    success: boolean;
    tx_hash?: string;
    pair_index?: number;
    message?: string;
    error?: string;
    verified?: boolean;
}>;
/**
 * Open a position on Avantis with retry logic and verification
 */
export declare function openAvantisPosition(params: OpenPositionParams, options?: {
    skipBalanceCheck?: boolean;
    skipVerification?: boolean;
    maxRetries?: number;
}): Promise<{
    success: boolean;
    tx_hash?: string;
    pair_index?: number;
    message?: string;
    error?: string;
    verified?: boolean;
}>;
/**
 * Close a position on Avantis
 */
export declare function closeAvantisPosition(params: ClosePositionParams): Promise<{
    success: boolean;
    tx_hash?: string;
    message?: string;
    error?: string;
}>;
/**
 * Get positions from Avantis
 */
export declare function getAvantisPositions(privateKey: string): Promise<Array<{
    pair_index: number;
    symbol: string;
    is_long: boolean;
    collateral: number;
    position_size?: number;
    leverage: number;
    entry_price: number;
    current_price: number;
    pnl: number;
}>>;
//# sourceMappingURL=avantis-trading.d.ts.map