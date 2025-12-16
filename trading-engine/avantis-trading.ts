/**
 * Avantis Trading Functions
 * This module provides functions to interact with Avantis API for opening/closing positions
 */

// Load environment variables from trading-engine/.env
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env from trading-engine directory if it exists
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Runtime functions to get environment variables (not evaluated at build time)
function getAvantisApiUrl(): string {
  // Default to port 8000 (Avantis service port)
  return process.env.AVANTIS_API_URL || 'http://localhost:8000';
}

function getBaseRpcUrl(): string {
  return process.env.BASE_RPC_URL || 'https://mainnet.base.org';
}

const TRANSACTION_CONFIRMATION_TIMEOUT = 30000; // 30 seconds
const POSITION_VERIFICATION_TIMEOUT = 20000; // 20 seconds
const POSITION_VERIFICATION_RETRIES = 3;
const POSITION_VERIFICATION_RETRY_DELAY = 2000; // 2 seconds between retries

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
 * Wait for transaction confirmation on Base network
 * Non-blocking with timeout to prevent hanging
 */
async function waitForTransactionConfirmation(
  txHash: string,
  confirmations: number = 2,
  timeout: number = TRANSACTION_CONFIRMATION_TIMEOUT
): Promise<boolean> {
  try {
    const startTime = Date.now();
    let confirmed = false;
    let attempts = 0;
    const maxAttempts = Math.floor(timeout / 2000); // Check every 2 seconds

    while (!confirmed && attempts < maxAttempts && (Date.now() - startTime) < timeout) {
      try {
        // Use Base RPC to check transaction receipt
        const baseRpcUrl = getBaseRpcUrl();
        const response = await fetch(baseRpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getTransactionReceipt',
            params: [txHash],
            id: 1
          })
        });

        if (response.ok) {
          const data = await response.json() as { result?: { blockNumber?: string } };
          if (data.result && data.result.blockNumber) {
            // Transaction is confirmed
            confirmed = true;
            console.log(`[AVANTIS] ✅ Transaction ${txHash.slice(0, 16)}... confirmed on block ${data.result.blockNumber}`);
            return true;
          }
        }
      } catch (error) {
        // Continue retrying on error
        console.warn(`[AVANTIS] ⚠️ Error checking transaction confirmation (attempt ${attempts + 1}):`, error);
      }

      attempts++;
      if (!confirmed && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      }
    }

    if (!confirmed) {
      console.warn(`[AVANTIS] ⚠️ Transaction confirmation timeout after ${timeout}ms - continuing anyway`);
      // Don't fail - transaction might still be processing
      return false;
    }

    return confirmed;
  } catch (error) {
    console.error(`[AVANTIS] ❌ Error waiting for transaction confirmation:`, error);
    // Don't fail - return false but continue
    return false;
  }
}

/**
 * Verify position exists in AvantisFi after opening
 * Uses retry logic with timeout to handle eventual consistency
 */
async function verifyPositionExists(
  pairIndex: number | undefined,
  privateKey: string,
  symbol: string,
  timeout: number = POSITION_VERIFICATION_TIMEOUT
): Promise<boolean> {
  if (!pairIndex) {
    console.warn(`[AVANTIS] ⚠️ No pair_index provided, skipping verification`);
    return false;
  }

  try {
    const startTime = Date.now();
    let verified = false;
    let attempts = 0;

    while (!verified && attempts < POSITION_VERIFICATION_RETRIES && (Date.now() - startTime) < timeout) {
      try {
        const positions = await getAvantisPositions(privateKey);
        const foundPosition = positions.find(p => p.pair_index === pairIndex);

        if (foundPosition) {
          verified = true;
          console.log(`[AVANTIS] ✅ Position verified: pair_index=${pairIndex}, symbol=${foundPosition.symbol}`);
          return true;
        }

        if (attempts < POSITION_VERIFICATION_RETRIES - 1) {
          console.log(`[AVANTIS] ⏳ Position not found yet (attempt ${attempts + 1}/${POSITION_VERIFICATION_RETRIES}), retrying...`);
          await new Promise(resolve => setTimeout(resolve, POSITION_VERIFICATION_RETRY_DELAY));
        }
      } catch (error) {
        console.warn(`[AVANTIS] ⚠️ Error verifying position (attempt ${attempts + 1}):`, error);
        if (attempts < POSITION_VERIFICATION_RETRIES - 1) {
          await new Promise(resolve => setTimeout(resolve, POSITION_VERIFICATION_RETRY_DELAY));
        }
      }

      attempts++;
    }

    if (!verified) {
      console.warn(`[AVANTIS] ⚠️ Position verification failed: pair_index=${pairIndex} not found after ${attempts} attempts`);
      // Don't fail the operation - position might appear later
      return false;
    }

    return verified;
  } catch (error) {
    console.error(`[AVANTIS] ❌ Error verifying position:`, error);
    return false;
  }
}

/**
 * Get Avantis balance for a wallet
 * Used for balance validation before opening positions
 */
async function getAvantisBalance(privateKey: string): Promise<number> {
  try {
    const avantisApiUrl = getAvantisApiUrl();
    const baseUrl = avantisApiUrl.endsWith('/') ? avantisApiUrl.slice(0, -1) : avantisApiUrl;
    
    // Use the /api/balance endpoint with private_key as query parameter
    // Add timeout to prevent hanging (10 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(`${baseUrl}/api/balance?private_key=${encodeURIComponent(privateKey)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[AVANTIS] ⚠️ Failed to get balance: ${response.statusText}`);
      return 0;
    }

    const result = await response.json() as { 
      usdc_balance?: number; 
      avantis_balance?: number;
      available_balance?: number;
      balance?: number;
      total_balance?: number;
      usdc_allowance?: number;
    };
    
    // Return USDC balance (trading balance) - try multiple possible fields
    // Note: usdc_balance might be very small (like 2e-05), but usdc_allowance shows approved amount
    // For trading, we should use available_balance or usdc_balance
    const balance = result.available_balance || result.usdc_balance || result.avantis_balance || result.balance || result.total_balance || 0;
    
    // Log for debugging
    console.log(`[AVANTIS] Balance check result:`, {
      usdc_balance: result.usdc_balance,
      available_balance: result.available_balance,
      usdc_allowance: result.usdc_allowance,
      returned_balance: balance
    });
    
    return balance;
  } catch (error) {
    console.error(`[AVANTIS] ❌ Error getting balance:`, error);
    return 0;
  }
}

/**
 * Check if error is transient (retryable) or permanent (don't retry)
 */
function isTransientError(error: string): boolean {
  // Balance errors are PERMANENT - never retry on insufficient balance
  const permanentPatterns = [
    'transfer amount exceeds balance',
    'erc20: transfer amount exceeds balance',
    'insufficient balance',
    'balance',
    'below minimum',
    'below_min_pos',
    'min position'
  ];

  const errorLower = error.toLowerCase();
  if (permanentPatterns.some(pattern => errorLower.includes(pattern))) {
    return false; // Permanent error - don't retry
  }

  const transientPatterns = [
    'timeout',
    'network',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'fetch failed',
    'temporarily unavailable',
    'rate limit',
    'too many requests'
  ];

  return transientPatterns.some(pattern => errorLower.includes(pattern));
}

/**
 * Get pair index for a symbol from Avantis service
 * This is a helper function to map symbols to pair indices for validation
 * Uses the same mapping as the backend symbol registry
 */
function getPairIndexForSymbol(symbol: string): number | undefined {
  // Symbol to pair index mapping (must match backend symbol_registry.py).
  // NOTE: This is a best-effort map used ONLY for pre-validation; the
  // Python Avantis service is the source of truth and will still validate.
  //
  // IMPORTANT: Do NOT include symbols that are not actually supported on
  // the current Avantis deployment (e.g. ATOM on Base mainnet), otherwise
  // the bot may try to trade unsupported pairs.
  const symbolToPairIndex: Record<string, number> = {
    BTC: 0,
    ETH: 1,
    SOL: 2,
    AVAX: 3,
    BNB: 4,
    ARB: 5,
    DOGE: 6,
    OP: 7,
    LINK: 8,
    AAVE: 9,
    NEAR: 10,
    FET: 11,
    SUI: 12,
    JUP: 13,
    WIF: 14,
    WLD: 15,
    TAO: 16,
    EIGEN: 17,
  };

  const upperSymbol = symbol.toUpperCase().trim() as keyof typeof symbolToPairIndex;
  const pairIndex = symbolToPairIndex[upperSymbol];

  if (pairIndex !== undefined) {
    console.log(`[AVANTIS] ✅ Resolved pair index ${pairIndex} for symbol ${upperSymbol}`);
    return pairIndex;
  }

  console.warn(`[AVANTIS] ⚠️ Symbol ${upperSymbol} not found in pair index mapping (pre-validation only)`);
  console.warn(`[AVANTIS] ⚠️ Available symbols (pre-validation):`, Object.keys(symbolToPairIndex).join(', '));
  return undefined;
}

/**
 * Open a position on Avantis with pre-validation to prevent BELOW_MIN_POS errors.
 * 
 * This function validates position size against on-chain minimum requirements
 * before sending the transaction, preventing gas waste from reverts.
 */
export async function openAvantisPositionSafe(
  params: OpenPositionParams,
  options?: {
    skipBalanceCheck?: boolean;
    skipVerification?: boolean;
    maxRetries?: number;
    pairIndex?: number; // Optional: if not provided, will try to resolve from symbol
  }
): Promise<{
  success: boolean;
  tx_hash?: string;
  pair_index?: number;
  message?: string;
  error?: string;
  verified?: boolean;
}> {
  console.log(`[AVANTIS] 🔍 Pre-validating position for ${params.symbol}...`);
  console.log(`[AVANTIS]    Collateral: $${params.collateral} | Leverage: ${params.leverage}x`);

  // Get pair index for validation
  let pairIndex: number | undefined = options?.pairIndex;
  if (!pairIndex) {
    pairIndex = getPairIndexForSymbol(params.symbol);
    if (pairIndex === undefined) {
      console.warn(`[AVANTIS] ⚠️ Could not resolve pair index for ${params.symbol}, skipping pre-validation`);
      console.warn(`[AVANTIS] ⚠️ Position will still be attempted - backend will validate`);
      // Continue without validation - the backend will catch it
    } else {
      console.log(`[AVANTIS] ✅ Using pair index ${pairIndex} for ${params.symbol}`);
    }
  }

  // Validate minimum position size if we have pair index
  if (pairIndex !== undefined) {
    try {
      const { validateAvantisMinPosition } = await import('./hyperliquid/BudgetAndLeverage');
      const validation = await validateAvantisMinPosition(
        params.symbol,
        pairIndex,
        params.collateral,
        params.leverage
      );

      // Only block if validation explicitly says invalid AND it's not a contract revert error or 404
      // 404 errors and "On-chain minimum not available" are non-blocking - backend will validate
      if (!validation.isValid && 
          !validation.reason?.includes('On-chain minimum not available') &&
          !validation.reason?.includes('Avantis service endpoint not available')) {
        console.error(`[AVANTIS] ❌ BELOW_MIN_POS pre-check FAILED for ${params.symbol}`);
        console.error(`[AVANTIS]    ${validation.reason}`);
        console.error(`[AVANTIS] ⏭️ Skipping ${params.symbol}: BELOW_MIN_POS`);
        
        return {
          success: false,
          error: validation.reason || 'Position size below minimum requirement'
        };
      }

      if (validation.isValid) {
        if (validation.requiredMinCollateral) {
          console.log(`[AVANTIS] ✅ BELOW_MIN_POS pre-check PASSED for ${params.symbol}`);
          console.log(`[AVANTIS]    Required min: $${validation.requiredMinCollateral.toFixed(2)} USDC`);
        } else {
          console.log(`[AVANTIS] ⚠️ BELOW_MIN_POS pre-check: On-chain minimum not available, proceeding (backend will validate)`);
        }
      }
    } catch (validationError) {
      // If validation fails due to API error, log but continue
      // The backend validation will catch it anyway
      console.warn(`[AVANTIS] ⚠️ Pre-validation error (non-blocking):`, validationError);
    }
  } else {
    console.log(`[AVANTIS] ⚠️ Pair index not available for ${params.symbol}, skipping pre-validation (backend will validate)`);
  }

  // If validation passed (or was skipped), proceed with normal position opening
  return openAvantisPosition(params, options);
}

/**
 * Open a position on Avantis with retry logic and verification
 */
export async function openAvantisPosition(
  params: OpenPositionParams,
  options?: {
    skipBalanceCheck?: boolean;
    skipVerification?: boolean;
    maxRetries?: number;
  }
): Promise<{
  success: boolean;
  tx_hash?: string;
  pair_index?: number;
  message?: string;
  error?: string;
  verified?: boolean;
}> {
  const maxRetries = options?.maxRetries || 2;
  const skipBalanceCheck = options?.skipBalanceCheck || false;
  const skipVerification = options?.skipVerification || false;

  // Retry loop for transient errors
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
  try {
    console.log(`[AVANTIS] ==========================================`);
      console.log(`[AVANTIS] 🚀 OPENING POSITION ON REAL AVANTIS PLATFORM${attempt > 0 ? ` (Retry ${attempt}/${maxRetries})` : ''}`);
    console.log(`[AVANTIS] Symbol: ${params.symbol}`);
    console.log(`[AVANTIS] Direction: ${params.is_long ? 'LONG' : 'SHORT'}`);
    console.log(`[AVANTIS] Collateral: $${params.collateral}`);
    console.log(`[AVANTIS] Leverage: ${params.leverage}x`);
    console.log(`[AVANTIS] Private Key: ${params.private_key ? `${params.private_key.slice(0, 10)}...${params.private_key.slice(-4)}` : 'MISSING!'}`);
    const avantisApiUrl = getAvantisApiUrl();
    console.log(`[AVANTIS] API URL: ${avantisApiUrl}/api/open-position`);
    console.log(`[AVANTIS] ==========================================`);
    
    if (!params.private_key) {
      console.error(`[AVANTIS] ❌ CRITICAL: Private key is missing! Cannot open position on Avantis.`);
      return {
        success: false,
        error: 'Private key is required to open positions on Avantis'
      };
    }

    // Remove trailing slash from AVANTIS_API_URL if present
    const baseUrl = avantisApiUrl.endsWith('/') ? avantisApiUrl.slice(0, -1) : avantisApiUrl;

      // Small random delay to prevent nonce conflicts when multiple positions open simultaneously
      // This helps when BTC and ETH positions try to approve at the same time
      const randomDelay = Math.random() * 500; // 0-500ms random delay
      await new Promise(resolve => setTimeout(resolve, randomDelay));

      // Balance validation before opening (CRITICAL: Check balance AFTER accounting for existing positions)
      if (!skipBalanceCheck) {
        try {
          // Get current balance
          const balance = await Promise.race([
            getAvantisBalance(params.private_key),
            new Promise<number>((_, reject) => 
              setTimeout(() => reject(new Error('Balance check timeout')), 5000)
            )
          ]);

          // Get existing positions to calculate reserved collateral
          let reservedCollateral = 0;
          try {
            const existingPositions = await getAvantisPositions(params.private_key);
            reservedCollateral = existingPositions.reduce((sum, pos) => {
              // Use collateral from position (or estimate from position_size / leverage)
              const posCollateral = pos.collateral || (pos.position_size ? pos.position_size / pos.leverage : 0);
              return sum + posCollateral;
            }, 0);
            
            if (existingPositions.length > 0) {
              console.log(`[AVANTIS] 📊 Found ${existingPositions.length} existing position(s) with $${reservedCollateral.toFixed(2)} reserved collateral`);
            }
          } catch (posError) {
            console.warn(`[AVANTIS] ⚠️ Could not fetch existing positions for balance check:`, posError);
            // Continue with balance check anyway - better to be conservative
          }

          // Calculate available balance (total - reserved)
          const availableBalance = balance - reservedCollateral;
          
          // Add small buffer for gas fees (0.1 USDC)
          const requiredAmount = params.collateral + 0.1;

          if (availableBalance < requiredAmount) {
            console.error(`[AVANTIS] ❌ Insufficient available balance:`);
            console.error(`[AVANTIS]    Total balance: $${balance.toFixed(2)}`);
            console.error(`[AVANTIS]    Reserved (existing positions): $${reservedCollateral.toFixed(2)}`);
            console.error(`[AVANTIS]    Available: $${availableBalance.toFixed(2)}`);
            console.error(`[AVANTIS]    Required: $${requiredAmount.toFixed(2)} (collateral + gas)`);
            return {
              success: false,
              error: `Insufficient available balance: $${availableBalance.toFixed(2)} available ($${balance.toFixed(2)} total - $${reservedCollateral.toFixed(2)} reserved), $${requiredAmount.toFixed(2)} required`
            };
          }
          console.log(`[AVANTIS] ✅ Balance check passed:`);
          console.log(`[AVANTIS]    Total: $${balance.toFixed(2)} | Reserved: $${reservedCollateral.toFixed(2)} | Available: $${availableBalance.toFixed(2)} >= Required: $${requiredAmount.toFixed(2)}`);
        } catch (balanceError) {
          // Balance check failed - this is a critical error, don't proceed
          const errorMessage = balanceError instanceof Error ? balanceError.message : String(balanceError);
          console.error(`[AVANTIS] ❌ Balance check failed: ${errorMessage}`);
          return {
            success: false,
            error: `Balance check failed: ${errorMessage}. Cannot open position without balance verification.`
          };
        }
      }

      // USDC Approval check before opening (CRITICAL)
      // Check current allowance first, then approve if needed, and wait for confirmation
      try {
        console.log(`[AVANTIS] 🔐 Checking USDC allowance...`);
        const requiredAmount = params.collateral * 1.5; // Need 150% to ensure enough for fees
        
        // Step 1: Check current allowance
        let currentAllowance = 0;
        try {
          const allowanceResponse = await fetch(`${baseUrl}/api/usdc-allowance?private_key=${encodeURIComponent(params.private_key)}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(10000), // 10 second timeout
          });
          
          if (allowanceResponse.ok) {
            const allowanceData = await allowanceResponse.json() as { allowance?: number };
            currentAllowance = allowanceData.allowance || 0;
            console.log(`[AVANTIS] Current USDC allowance: $${currentAllowance.toFixed(2)}`);
          }
        } catch (allowanceCheckError) {
          console.warn(`[AVANTIS] ⚠️ Could not check current allowance, will approve anyway:`, allowanceCheckError);
        }
        
        // Step 2: Approve if current allowance is insufficient
        if (currentAllowance < requiredAmount) {
          console.log(`[AVANTIS] ⚠️ Insufficient allowance ($${currentAllowance.toFixed(2)} < $${requiredAmount.toFixed(2)}), approving...`);
        
        const approveResponse = await fetch(`${baseUrl}/api/approve-usdc`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
              amount: requiredAmount,
            private_key: params.private_key,
          }),
            signal: AbortSignal.timeout(70000), // 70 second timeout (approval waits for confirmation)
        });

        if (approveResponse.ok) {
            const approveResult = await approveResponse.json() as { success?: boolean; confirmed?: boolean; tx_hash?: string };
            if (approveResult.success && approveResult.confirmed) {
              console.log(`[AVANTIS] ✅ USDC approval confirmed on-chain: $${requiredAmount.toFixed(2)} (TX: ${approveResult.tx_hash?.slice(0, 16)}...)`);
              
              // Step 3: Verify allowance after approval (double-check)
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds for blockchain state to update
              
              try {
                const verifyResponse = await fetch(`${baseUrl}/api/usdc-allowance?private_key=${encodeURIComponent(params.private_key)}`, {
                  method: 'GET',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  signal: AbortSignal.timeout(10000),
                });
                
                if (verifyResponse.ok) {
                  const verifyData = await verifyResponse.json() as { allowance?: number };
                  const newAllowance = verifyData.allowance || 0;
                  console.log(`[AVANTIS] Verified allowance after approval: $${newAllowance.toFixed(2)}`);
                  
                  if (newAllowance < requiredAmount) {
                    console.warn(`[AVANTIS] ⚠️ Allowance still insufficient after approval ($${newAllowance.toFixed(2)} < $${requiredAmount.toFixed(2)}), but continuing...`);
                  }
                }
              } catch (verifyError) {
                console.warn(`[AVANTIS] ⚠️ Could not verify allowance after approval:`, verifyError);
              }
            } else {
              console.warn(`[AVANTIS] ⚠️ USDC approval sent but not confirmed yet: ${approveResult.tx_hash || 'no tx hash'}`);
            }
          } else {
            const errorData = await approveResponse.json().catch(() => ({ detail: 'Approval failed' })) as { detail?: string };
            console.warn(`[AVANTIS] ⚠️ USDC approval failed: ${errorData.detail || 'Approval failed'}`);
            // Don't continue if approval failed - position will fail anyway
            return {
              success: false,
              error: `USDC approval failed: ${errorData.detail || 'Approval failed'}. Cannot open position without sufficient allowance.`
            };
          }
        } else {
          console.log(`[AVANTIS] ✅ Sufficient USDC allowance already exists: $${currentAllowance.toFixed(2)} >= $${requiredAmount.toFixed(2)}`);
        }
      } catch (approvalError) {
        const errorMessage = approvalError instanceof Error ? approvalError.message : String(approvalError);
        console.error(`[AVANTIS] ❌ USDC approval process failed:`, errorMessage);
        // Don't continue if approval failed - position will fail anyway
        return {
          success: false,
          error: `USDC approval failed: ${errorMessage}. Cannot open position without sufficient allowance.`
        };
      }
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        console.error(`[AVANTIS] ❌ Timeout opening position after 30 seconds`);
      }, 30000); // 30 second timeout

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/api/open-position`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            symbol: params.symbol,
            collateral: params.collateral,
            leverage: params.leverage,
            is_long: params.is_long,
            private_key: params.private_key,
            tp: params.tp,
            sl: params.sl,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText })) as { detail?: string };
        const errorMessage = errorData.detail || response.statusText;
        
        console.error(`[AVANTIS] ❌ Failed to open position: ${errorMessage}`);
      console.error(`[AVANTIS] Response status: ${response.status}`);

        // Check if error is a balance error - these are permanent and should never retry
        const errorLower = errorMessage.toLowerCase();
        const isBalanceError = errorLower.includes('transfer amount exceeds balance') ||
                              errorLower.includes('insufficient balance') ||
                              errorLower.includes('erc20: transfer amount exceeds balance') ||
                              errorLower.includes('balance');
        if (isBalanceError) {
          console.error(`[AVANTIS] 🛑 Balance error detected - will NOT retry`);
          console.error(`[AVANTIS]    This is a permanent error - insufficient funds`);
          return {
            success: false,
            error: errorMessage
          };
        }

        // Check if error is transient and we should retry
        if (isTransientError(errorMessage) && attempt < maxRetries) {
          const delay = (attempt + 1) * 1000; // Exponential backoff
          console.log(`[AVANTIS] ⏳ Transient error detected, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // Retry
        }

        // Permanent error or max retries reached
      return {
        success: false,
          error: errorMessage
      };
    }

    const result = await response.json() as {
      tx_hash?: string;
      pair_index?: number;
      symbol?: string;
      message?: string;
    };

      if (!result.tx_hash) {
        console.error(`[AVANTIS] ❌ No transaction hash returned from API`);
        return {
          success: false,
          error: 'No transaction hash returned from Avantis API'
        };
      }

    console.log(`[AVANTIS] ==========================================`);
      console.log(`[AVANTIS] ✅ Position open request successful`);
    console.log(`[AVANTIS] Transaction Hash: ${result.tx_hash}`);
    console.log(`[AVANTIS] Pair Index: ${result.pair_index}`);
    console.log(`[AVANTIS] Symbol: ${result.symbol || params.symbol}`);
    console.log(`[AVANTIS] Direction: ${params.is_long ? 'LONG' : 'SHORT'}`);
    console.log(`[AVANTIS] Collateral: $${params.collateral}`);
    console.log(`[AVANTIS] Leverage: ${params.leverage}x`);
    console.log(`[AVANTIS] ==========================================`);

      // Transaction confirmation (non-blocking, runs in parallel with verification)
      let txConfirmed = false;
      if (result.tx_hash) {
        waitForTransactionConfirmation(result.tx_hash, 2, TRANSACTION_CONFIRMATION_TIMEOUT)
          .then(confirmed => {
            txConfirmed = confirmed;
            if (confirmed) {
              console.log(`[AVANTIS] ✅ Transaction confirmed on-chain`);
            }
          })
          .catch(err => {
            console.warn(`[AVANTIS] ⚠️ Transaction confirmation check failed:`, err);
          });
      }

      // Position verification (non-blocking, but we wait a bit for it)
      let positionVerified = false;
      if (!skipVerification && result.pair_index) {
        console.log(`[AVANTIS] 🔍 Verifying position exists in AvantisFi...`);
        positionVerified = await verifyPositionExists(
          result.pair_index,
          params.private_key,
          result.symbol || params.symbol,
          POSITION_VERIFICATION_TIMEOUT
        );
        
        if (positionVerified) {
          console.log(`[AVANTIS] ✅ Position verified in AvantisFi dashboard`);
        } else {
          console.warn(`[AVANTIS] ⚠️ Position verification failed - position may appear later`);
        }
      }

      console.log(`[AVANTIS] ==========================================`);
      console.log(`[AVANTIS] ✅✅✅ POSITION OPENED SUCCESSFULLY ON AVANTIS!`);
    console.log(`[AVANTIS] 📊 THIS POSITION IS NOW LIVE ON AVANTIS DASHBOARD`);
    console.log(`[AVANTIS] 📊 Connect your backend wallet to avantisfi.com to see it`);
    console.log(`[AVANTIS] 📊 The position will appear in your "Current Positions" section`);
      if (txConfirmed) {
        console.log(`[AVANTIS] ✅ Transaction confirmed on-chain`);
      }
      if (positionVerified) {
        console.log(`[AVANTIS] ✅ Position verified in AvantisFi`);
      }
    console.log(`[AVANTIS] ==========================================`);
    
    return {
      success: true,
      tx_hash: result.tx_hash,
      pair_index: result.pair_index,
        message: result.message || 'Position opened successfully on Avantis',
        verified: positionVerified
    };
      } catch (fetchError) {
        clearTimeout(timeoutId);
        
        // Handle timeout and connection errors
        if (fetchError instanceof Error) {
          if (fetchError.name === 'AbortError' || fetchError.message.includes('timeout')) {
            const errorMessage = `Timeout opening position - Avantis service may be slow or down`;
            console.error(`[AVANTIS] ❌ ${errorMessage}`);
            
            // Check if error is transient and we should retry
            if (attempt < maxRetries) {
              const delay = (attempt + 1) * 2000; // Exponential backoff
              console.log(`[AVANTIS] ⏳ Retrying after timeout in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue; // Retry
            }
            
            return {
              success: false,
              error: errorMessage
            };
          } else if (fetchError.message.includes('ECONNREFUSED') || fetchError.message.includes('other side closed')) {
            const errorMessage = `Avantis service connection refused - check if service is running on ${baseUrl}`;
            console.error(`[AVANTIS] ❌ ${errorMessage}`);
            
            // Check if error is transient and we should retry
            if (attempt < maxRetries) {
              const delay = (attempt + 1) * 2000; // Exponential backoff
              console.log(`[AVANTIS] ⏳ Retrying after connection error in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue; // Retry
            }
            
            return {
              success: false,
              error: errorMessage
            };
          }
        }
        
        // Check if error is transient and we should retry
        const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        if (isTransientError(errorMessage) && attempt < maxRetries) {
          const delay = (attempt + 1) * 1000; // Exponential backoff
          console.log(`[AVANTIS] ⏳ Transient error detected, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // Retry
        }
        
        // If we get here, it's not a retryable error or max retries reached
        return {
          success: false,
          error: errorMessage
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[AVANTIS] ❌ Exception opening position${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}:`, error);

      // Check if error is transient and we should retry
      if (isTransientError(errorMessage) && attempt < maxRetries) {
        const delay = (attempt + 1) * 1000; // Exponential backoff
        console.log(`[AVANTIS] ⏳ Transient error detected, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue; // Retry
      }

      // Permanent error or max retries reached
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  // Should not reach here, but just in case
  return {
    success: false,
    error: 'Failed to open position after all retries'
  };
}

/**
 * Close a position on Avantis
 */
export async function closeAvantisPosition(params: ClosePositionParams): Promise<{
  success: boolean;
  tx_hash?: string;
  message?: string;
  error?: string;
}> {
  try {
    console.log(`[AVANTIS] Closing position: pair_index=${params.pair_index}`);
    
    // Remove trailing slash from AVANTIS_API_URL if present
    const avantisApiUrl = getAvantisApiUrl();
    const baseUrl = avantisApiUrl.endsWith('/') ? avantisApiUrl.slice(0, -1) : avantisApiUrl;
    const response = await fetch(`${baseUrl}/api/close-position`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pair_index: params.pair_index,
        private_key: params.private_key,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText })) as { detail?: string };
      console.error(`[AVANTIS] Failed to close position: ${errorData.detail || response.statusText}`);
      return {
        success: false,
        error: errorData.detail || response.statusText
      };
    }

    const result = await response.json() as { tx_hash?: string; message?: string };
    console.log(`[AVANTIS] Position closed successfully: ${JSON.stringify(result)}`);
    
    return {
      success: true,
      tx_hash: result.tx_hash,
      message: result.message || 'Position closed successfully'
    };
  } catch (error) {
    console.error(`[AVANTIS] Error closing position:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get positions from Avantis
 */
export async function getAvantisPositions(privateKey: string): Promise<Array<{
  pair_index: number;
  symbol: string;
  is_long: boolean;
  collateral: number;
  position_size?: number; // Leveraged position size (collateral * leverage)
  leverage: number;
  entry_price: number;
  current_price: number;
  pnl: number;
}>> {
  try {
    // Remove trailing slash from AVANTIS_API_URL if present
    const avantisApiUrl = getAvantisApiUrl();
    const baseUrl = avantisApiUrl.endsWith('/') ? avantisApiUrl.slice(0, -1) : avantisApiUrl;
    
    // Add timeout to prevent hanging when Avantis service is down
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.warn(`[AVANTIS] ⚠️ Timeout fetching positions from Avantis service (${baseUrl})`);
    }, 35000); // 35 second timeout (increased to handle RPC rate limiting and slow responses)
    
    try {
      const response = await fetch(`${baseUrl}/api/positions?private_key=${encodeURIComponent(privateKey)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`[AVANTIS] Failed to get positions: ${response.status} ${response.statusText}`);
        return [];
      }

      const result = await response.json() as { positions?: Array<{
        pair_index: number;
        symbol: string;
        is_long: boolean;
        collateral: number;
        leverage: number;
        entry_price: number;
        current_price: number;
        pnl: number;
      }> };
      return result.positions || [];
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      // Check if it's a timeout or connection error
      if (fetchError instanceof Error) {
        if (fetchError.name === 'AbortError' || fetchError.message.includes('timeout')) {
          console.warn(`[AVANTIS] ⚠️ Timeout fetching positions - Avantis service may be slow or down`);
          console.warn(`[AVANTIS] ⚠️ Returning empty positions array - trading will continue`);
        } else if (fetchError.message.includes('ECONNREFUSED') || fetchError.message.includes('other side closed')) {
          console.warn(`[AVANTIS] ⚠️ Avantis service connection refused or closed`);
          console.warn(`[AVANTIS] ⚠️ Check if Avantis service is running on ${baseUrl}`);
          console.warn(`[AVANTIS] ⚠️ Returning empty positions array - trading will continue`);
        } else {
          console.error(`[AVANTIS] Error fetching positions:`, fetchError.message);
        }
      }
      return [];
    }
  } catch (error) {
    console.error(`[AVANTIS] Unexpected error getting positions:`, error);
    return [];
  }
}

