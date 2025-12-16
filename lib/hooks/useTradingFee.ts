"use client";

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useBaseMiniApp } from './useBaseMiniApp';
import { useIntegratedWallet } from '../wallet/IntegratedWalletContext';
import { ethers } from 'ethers';
import { BaseAccountTransactionService } from '../services/BaseAccountTransactionService';
import { getNetworkConfig } from '../config/network';

const FEE_RECIPIENT = '0xeb56286910d3Cf36Ba26958Be0BbC91D60B28799';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base mainnet USDC
const USDC_DECIMALS = 6;

export interface FeePaymentResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
  amount: string;
  currency: 'ETH' | 'USDC';
}

interface WalletWithKey {
  address: string;
  privateKey?: string;
  chain: string;
}

export function useTradingFee() {
  const { token } = useAuth();
  const { sdk, isBaseContext } = useBaseMiniApp();
  const { primaryWallet, tradingWallet } = useIntegratedWallet();
  const [isPayingFee, setIsPayingFee] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [tradingWalletWithKey, setTradingWalletWithKey] = useState<WalletWithKey | null>(null);
  const [isCreatingWallet, setIsCreatingWallet] = useState(false);
  const [walletCreationAttempts, setWalletCreationAttempts] = useState(0);

  // Fetch trading wallet with private key when needed
  useEffect(() => {
    // Only fetch if we have both token AND a trading wallet exists in context
    // This prevents fetching during initial wallet creation
    if (!token || !tradingWallet?.address) {
      return;
    }
    
    const fetchTradingWalletWithKey = async () => {
      try {
        const response = await fetch('/api/wallet/primary-with-key', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.wallet && data.wallet.privateKey) {
            setTradingWalletWithKey(data.wallet);
          }
        } else if (response.status === 404) {
          // Wallet not found yet - this is OK during initial creation
        }
      } catch (error) {
        // Exception during wallet fetch
      }
    };

    // Add a small delay to prevent race conditions during wallet creation
    const timeoutId = setTimeout(() => {
      fetchTradingWalletWithKey();
    }, 1000);
    
    return () => clearTimeout(timeoutId);
  }, [token, tradingWallet?.address]);

  // Use trading wallet with private key if available, otherwise fall back to primary wallet
  const walletForFee = tradingWalletWithKey || tradingWallet || primaryWallet;

  /**
   * Get fee payment transaction data from API
   * @param tradingAmount - The amount user wants to trade with (required for fee calculation)
   */
  const getFeeTransactionData = useCallback(async (tradingAmount: number) => {
    if (!token) {
      throw new Error('Not authenticated');
    }

    if (!tradingAmount || tradingAmount <= 0) {
      throw new Error('Trading amount is required for fee calculation');
    }

    const response = await fetch('/api/trading/pay-fee', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ tradingAmount }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to get fee transaction data');
    }

    return response.json();
  }, [token]);

  /**
   * Pay fee using Base Account SDK
   */
  const payFeeWithBaseAccount = useCallback(async (txData: any): Promise<FeePaymentResult> => {
    if (!sdk || !isBaseContext) {
      throw new Error('Base Account SDK not available');
    }

    try {
      const transactionService = new BaseAccountTransactionService(sdk);
      
      // Try USDC first, then ETH
      let result: FeePaymentResult | null = null;

      // Try USDC transfer first (if user has USDC)
      try {
        // Check if we should try USDC (you can add balance check here if needed)
        const usdcTx = await transactionService.signAndSendTransaction({
          to: txData.transactions.usdc.to,
          value: txData.transactions.usdc.value,
          data: txData.transactions.usdc.data,
        });
        
        result = {
          success: true,
          transactionHash: usdcTx,
          amount: txData.amounts.usdc,
          currency: 'USDC',
        };
      } catch (usdcError) {
        console.warn('[useTradingFee] USDC payment failed, trying ETH:', usdcError);
        
        // Fallback to ETH
        try {
          const ethTx = await transactionService.signAndSendTransaction({
            to: txData.transactions.eth.to,
            value: txData.transactions.eth.value,
            data: txData.transactions.eth.data || '0x',
          });
          
          result = {
            success: true,
            transactionHash: ethTx,
            amount: txData.amounts.eth,
            currency: 'ETH',
          };
        } catch (ethError) {
          throw new Error(`Both USDC and ETH payment failed. ETH error: ${ethError instanceof Error ? ethError.message : 'Unknown'}`);
        }
      }

      if (!result) {
        throw new Error('Failed to pay fee');
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to pay fee with Base Account',
        amount: '0',
        currency: 'ETH',
      };
    }
  }, [sdk, isBaseContext]);

  /**
   * Pay fee using fallback wallet (with private key)
   */
  const payFeeWithFallbackWallet = useCallback(async (txData: any): Promise<FeePaymentResult> => {
    if (!walletForFee?.privateKey) {
      throw new Error('No private key available for fee payment');
    }

    try {
      // Connect to Base network
      const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
      const wallet = new ethers.Wallet(walletForFee.privateKey, provider);

      // Try USDC first
      try {
        const usdcAbi = ['function transfer(address to, uint256 amount) returns (bool)'];
        const usdcContract = new ethers.Contract(USDC_ADDRESS, usdcAbi, wallet);
        
        // Get required amount from transaction data (1% of wallet balance)
        const requiredAmount = ethers.parseUnits(txData.amounts.usdc, USDC_DECIMALS);
        
        // Check balance
        const balance = await usdcContract.balanceOf(wallet.address);
        
        if (BigInt(balance.toString()) >= BigInt(requiredAmount.toString())) {
          const tx = await usdcContract.transfer(FEE_RECIPIENT, requiredAmount);
          await tx.wait();
          
          return {
            success: true,
            transactionHash: tx.hash,
            amount: txData.amounts.usdc,
            currency: 'USDC',
          };
        }
      } catch (usdcError) {
        console.warn('[useTradingFee] USDC payment failed, trying ETH:', usdcError);
      }

      // Fallback to ETH
      const ethAmount = txData.transactions.eth.value;
      const balance = await provider.getBalance(wallet.address);
      
      if (BigInt(balance.toString()) < BigInt(ethAmount)) {
        throw new Error('Insufficient ETH balance to pay fee');
      }

      const tx = await wallet.sendTransaction({
        to: FEE_RECIPIENT,
        value: ethAmount,
      });

      await tx.wait();

      return {
        success: true,
        transactionHash: tx.hash,
        amount: txData.amounts.eth,
        currency: 'ETH',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to pay fee with fallback wallet',
        amount: '0',
        currency: 'ETH',
      };
    }
  }, [walletForFee]);

  /**
   * Fetch trading wallet with private key on-demand
   */
  const fetchWalletWithKeyOnDemand = useCallback(async (): Promise<WalletWithKey | null> => {
    if (!token) {
      return null;
    }

    // If we already have it, return it
    if (tradingWalletWithKey?.privateKey) {
      return tradingWalletWithKey;
    }

    // Try to fetch it
    
    try {
      const response = await fetch('/api/wallet/primary-with-key', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.wallet && data.wallet.privateKey) {
          // Validate private key format
          if (data.wallet.privateKey.length === 66 && data.wallet.privateKey.startsWith('0x')) {
            setTradingWalletWithKey(data.wallet);
            return data.wallet;
          } else {
            return null;
          }
        }
      } else if (response.status === 404) {
        // Wallet doesn't exist - try to create it (with safeguards)
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        
        // Prevent infinite loops: max 1 creation attempt per session
        if (isCreatingWallet) {
          return null;
        }
        
        if (walletCreationAttempts >= 1) {
          return null;
        }
        
        setIsCreatingWallet(true);
        setWalletCreationAttempts(prev => prev + 1);
        
        // Try to create the wallet via API with timeout
        try {
          const createPromise = fetch('/api/wallet/user-wallets', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ chain: 'ethereum' })
          });
          
          // Add 10 second timeout to prevent freezing
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Wallet creation timeout')), 10000)
          );
          
          const createResponse = await Promise.race([createPromise, timeoutPromise]) as Response;
          
          if (createResponse.ok) {
            
            // Wait a moment for DB to sync
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Retry fetching after creation (with timeout)
            const retryPromise = fetch('/api/wallet/primary-with-key', {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });
            
            const retryTimeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Fetch timeout')), 5000)
            );
            
            const retryResponse = await Promise.race([retryPromise, retryTimeoutPromise]) as Response;
            
            if (retryResponse.ok) {
              const retryData = await retryResponse.json();
              if (retryData.wallet && retryData.wallet.privateKey) {
                setTradingWalletWithKey(retryData.wallet);
                setIsCreatingWallet(false);
                return retryData.wallet;
              } else {
              }
            } else {
            }
          } else {
            const createError = await createResponse.json().catch(() => ({ error: 'Unknown error' }));
          }
        } catch (createError) {
          if (createError instanceof Error && createError.message.includes('timeout')) {
          } else {
          }
        } finally {
          setIsCreatingWallet(false);
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }, [token, tradingWalletWithKey, isCreatingWallet, walletCreationAttempts]);

  /**
   * Pay trading fee - main function
   * @param tradingAmount - The amount user wants to trade with (required for 1% fee calculation)
   */
  const payTradingFee = useCallback(async (tradingAmount: number): Promise<FeePaymentResult> => {
    setIsPayingFee(true);
    setFeeError(null);

    try {
      if (!tradingAmount || tradingAmount <= 0) {
        throw new Error('Trading amount is required for fee calculation');
      }
      
      // Get transaction data from API first (includes balance validation)
      const txData = await getFeeTransactionData(tradingAmount);

      // If using Base Account SDK, we don't need private key
      if (txData.isBaseAccount && isBaseContext && sdk) {
        const result = await payFeeWithBaseAccount(txData);
        setFeeError(null);
        return result;
      }

      // For trading wallet, we need private key - fetch it on-demand if not loaded
      let walletWithKey = tradingWalletWithKey;
      
      if (!walletWithKey?.privateKey && tradingWallet?.address) {
        walletWithKey = await fetchWalletWithKeyOnDemand();
      }

      // IMPORTANT: Only use trading wallet for fee payment, never fall back to primaryWallet (Farcaster)
      // Update walletForFee with the fetched wallet - but ONLY trading wallet
      const effectiveWallet = walletWithKey || tradingWallet;

      // Check if we have trading wallet available
      if (!effectiveWallet?.address) {
        throw new Error('Trading wallet not available. Please ensure your trading wallet is set up.');
      }
      
      // Ensure we have private key for trading wallet
      if (!effectiveWallet?.privateKey) {
        throw new Error('Trading wallet private key not available. Cannot pay fee.');
      }

      // Determine payment method - always use trading wallet with private key
      let result: FeePaymentResult | null = null;

      // Since we always use trading wallet now, txData.isBaseAccount should always be false
      // But keep this check for safety
      if (txData.isBaseAccount) {
        throw new Error('Fee payment must use trading wallet. Please ensure your trading wallet is set up.');
      }
      
      if (effectiveWallet?.privateKey) {
        // Use trading wallet with private key for automated trading
        if (!effectiveWallet.privateKey) {
          throw new Error('Private key not available');
        }

        const networkConfig = getNetworkConfig();
        const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
        const wallet = new ethers.Wallet(effectiveWallet.privateKey, provider);

        // 1) Try to pay fee in USDC first
        try {
          const usdcAbi = [
            'function balanceOf(address owner) view returns (uint256)',
            'function transfer(address to, uint256 amount) returns (bool)',
          ];
          const usdcDecimals = networkConfig.usdcDecimals ?? USDC_DECIMALS;
          const usdcContract = new ethers.Contract(networkConfig.usdcAddress ?? USDC_ADDRESS, usdcAbi, wallet);

          // Required USDC amount from API (already 1% of trading amount, formatted)
          const requiredUsdcAmount = ethers.parseUnits(txData.amounts.usdc, usdcDecimals);
          const usdcBalance = await usdcContract.balanceOf(wallet.address);

          if (BigInt(usdcBalance.toString()) >= BigInt(requiredUsdcAmount.toString())) {
            const usdcTx = await usdcContract.transfer(FEE_RECIPIENT, requiredUsdcAmount);
            await usdcTx.wait();

            result = {
              success: true,
              transactionHash: usdcTx.hash,
              amount: txData.amounts.usdc,
              currency: 'USDC',
            };
            // Reset wallet creation attempts on success
            setWalletCreationAttempts(0);
          }
        } catch (usdcError) {
          console.warn('[useTradingFee] USDC fee payment failed, falling back to ETH:', usdcError);
        }

        // If USDC transfer did not succeed, fall back to ETH (legacy behaviour)
        if (!result || !result.success) {
          const ethAmount = txData.transactions.eth.value;
          const balance = await provider.getBalance(wallet.address);

          if (BigInt(balance.toString()) < BigInt(ethAmount)) {
            throw new Error('Insufficient ETH balance to pay fee');
          }

          // Get the current nonce to avoid "already known" errors
          // Use 'pending' to include pending transactions in the count
          let nonce = await provider.getTransactionCount(wallet.address, 'pending');

          // Double-check nonce after a short delay to ensure we have the latest
          await new Promise(resolve => setTimeout(resolve, 500));
          const latestNonce = await provider.getTransactionCount(wallet.address, 'pending');
          if (latestNonce > nonce) {
            nonce = latestNonce;
          }

          const tx = await wallet.sendTransaction({
            to: FEE_RECIPIENT,
            value: ethAmount,
            nonce: nonce, // Explicitly set nonce to avoid conflicts
          });

          await tx.wait();

          result = {
            success: true,
            transactionHash: tx.hash,
            amount: txData.amounts.eth,
            currency: 'ETH',
          };
          // Reset wallet creation attempts on success
          setWalletCreationAttempts(0);
        }
      } else {
        // No private key and not a Base Account
        throw new Error('Trading wallet private key not available. Please ensure you have deposited funds and your trading wallet is set up correctly.');
      }

      if (!result.success) {
        setFeeError(result.error || 'Failed to pay fee');
        throw new Error(result.error || 'Failed to pay fee');
      }

      setFeeError(null);
      // Reset wallet creation attempts on success
      setWalletCreationAttempts(0);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to pay trading fee';
      setFeeError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsPayingFee(false);
      // Always reset creation flag in finally
      setIsCreatingWallet(false);
    }
  }, [token, sdk, isBaseContext, tradingWalletWithKey, tradingWallet, primaryWallet, getFeeTransactionData, payFeeWithBaseAccount, fetchWalletWithKeyOnDemand]);

  return {
    payTradingFee,
    isPayingFee,
    feeError,
  };
}

