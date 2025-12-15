"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { ClientWalletService, ClientUserWallet } from '../services/ClientWalletService';
import { RealBalanceData } from '../services/RealBalanceService';
import { useAuth } from '../auth/AuthContext';
import { useMetaMask } from '../hooks/useMetaMask';
import { getNetworkConfig } from '../config/network';

// ============================================================================
// Types
// ============================================================================

export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  price?: number;
  isNative?: boolean;
}

export interface TokenBalance {
  token: Token;
  balance: string;
  balanceFormatted: string;
  valueUSD: number;
}

export interface IntegratedWalletState {
  isConnected: boolean;
  primaryWallet: ClientUserWallet | null;
  tradingWallet: ClientUserWallet | null;
  baseAccountAddress: string | null;
  tradingWalletAddress: string | null;
  allWallets: ClientUserWallet[];
  ethBalance: string;
  ethBalanceFormatted: string;
  holdings: TokenBalance[];
  tradingHoldings: TokenBalance[]; // Holdings from trading wallet only (for Holdings section)
  baseHoldings: TokenBalance[]; // Holdings from Farcaster/Base wallet only (for Deposit Modal)
  totalPortfolioValue: number;
  dailyChange: number;
  dailyChangePercentage: number;
  lastDayValue: number;
  avantisBalance: number;
  isAvantisConnected: boolean;
  hasRealAvantisBalance: boolean;
  isLoading: boolean;
  error: string | null;
  hasCompletedInitialLoad: boolean;
}

export interface IntegratedWalletContextType extends IntegratedWalletState {
  refreshWallets: () => Promise<void>;
  createWallet: (chain: string, mnemonic?: string) => Promise<ClientUserWallet | null>;
  switchToWallet: (walletId: string) => Promise<void>;
  refreshBalances: (forceRefresh?: boolean) => Promise<void>;
  getWalletForChain: (chain: string) => ClientUserWallet | null;
}

// ============================================================================
// Constants
// ============================================================================

const DEBOUNCE_DELAY = 500; // 500ms for MetaMask refresh debounce
const DEBUG_BALANCE_LOGS = false; // Set to true for detailed balance logging

// ============================================================================
// Context
// ============================================================================

const IntegratedWalletContext = createContext<IntegratedWalletContextType | undefined>(undefined);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse formatted balance string to number
 * Example: "20.0000 USDC" -> 20.0
 */
function parseFormattedBalance(str: string): number {
  const match = str.match(/^([\d.]+)/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Format balance with appropriate decimals
 */
function formatBalanceWithDecimals(amount: number, symbol: string): string {
  const decimals = symbol === 'USDC' ? 4 : 6; // USDC uses 4, ETH uses 6
  return `${amount.toFixed(decimals)} ${symbol}`;
}

/**
 * Combine two BigInt balance strings
 */
function combineBalances(balance1: string, balance2: string): string {
  try {
    const big1 = BigInt(balance1 || '0');
    const big2 = BigInt(balance2 || '0');
    return (big1 + big2).toString();
  } catch {
    return '0';
  }
}

/**
 * Validate numeric value is valid and non-negative
 */
function isValidNumber(value: number): boolean {
  return typeof value === 'number' && !isNaN(value) && value >= 0 && isFinite(value);
}

// ============================================================================
// Provider Component
// ============================================================================

export function IntegratedWalletProvider({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuth();
  const clientWalletService = useMemo(
    () =>
      new ClientWalletService(() => {
        if (token) return token;
        if (typeof window !== 'undefined') {
          // Fallback to persisted token
          return localStorage.getItem('base_auth_token') || '';
        }
        return '';
      }),
    [token]
  );
  const { isConnected: isMetaMaskConnected, account: metaMaskAccount } = useMetaMask();
  const networkConfig = useMemo(() => getNetworkConfig(), []);
  const nativeSymbol = networkConfig.nativeSymbol || 'ETH';
  
  // Refs for preventing race conditions
  const isRefreshingRef = useRef(false);
  const lastUpdateTimestampRef = useRef<number>(0); // Track when last update happened
  
  // Initial state
  const [state, setState] = useState<IntegratedWalletState>({
    isConnected: false,
    primaryWallet: null,
    tradingWallet: null,
    baseAccountAddress: null,
    tradingWalletAddress: null,
    allWallets: [],
    ethBalance: '0',
    ethBalanceFormatted: '0.00 ETH',
    holdings: [],
    tradingHoldings: [], // Trading wallet holdings only
    baseHoldings: [], // Farcaster/Base wallet holdings only (for Deposit Modal)
    totalPortfolioValue: 0,
    dailyChange: 0,
    dailyChangePercentage: 0,
    lastDayValue: 0,
    avantisBalance: 0,
    isAvantisConnected: false,
    hasRealAvantisBalance: false,
    isLoading: false,
    error: null,
    hasCompletedInitialLoad: false
  });

  // ============================================================================
  // Balance Data Fetching
  // ============================================================================

  /**
   * Fetch balance data (always fresh - no caching)
   */
  const fetchBalanceData = useCallback(async (address: string, forceRefresh: boolean = false): Promise<RealBalanceData> => {
    if (!token) {
      throw new Error('Not authenticated');
    }

    // Always fetch fresh data
    const url = `/api/wallet/balances?address=${encodeURIComponent(address)}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch balance data');
    }

    const result = await response.json();
    const balanceData = result.balance as RealBalanceData;

    return balanceData;
  }, [token]);

  // ============================================================================
  // Balance Calculation Helpers
  // ============================================================================

  /**
   * Convert RealBalanceData holdings to TokenBalance format
   */
  const convertHoldingsToTokenBalance = useCallback((holdings: RealBalanceData['holdings']): TokenBalance[] => {
    return holdings.map(realToken => ({
      token: {
        address: realToken.token.address,
        symbol: realToken.token.symbol,
        name: realToken.token.name,
        decimals: realToken.token.decimals,
        price: realToken.priceUSD,
        isNative: realToken.token.isNative
      },
      balance: realToken.balance,
      balanceFormatted: realToken.balanceFormatted,
      valueUSD: realToken.valueUSD
    }));
  }, []);

  /**
   * Merge trading vault holdings into base account holdings
   * Deduplicates by token address and combines balances using raw BigInt values
   */
  const mergeHoldings = useCallback((
    baseHoldings: TokenBalance[],
    vaultHoldings: TokenBalance[]
  ): TokenBalance[] => {
    const combinedMap = new Map<string, TokenBalance>();
    
    // Add base account holdings first
    baseHoldings.forEach(holding => {
      const key = holding.token.address.toLowerCase();
      combinedMap.set(key, holding);
    });
    
    // Merge trading vault holdings
    vaultHoldings.forEach(vaultHolding => {
      const key = vaultHolding.token.address.toLowerCase();
      const existing = combinedMap.get(key);
      
      if (existing) {
        // Merge: combine raw balances as BigInt (no precision loss)
        const combinedBalance = combineBalances(existing.balance, vaultHolding.balance);
        
        // Calculate combined amount using decimals
        const decimals = existing.token.decimals;
        const combinedAmount = parseFloat(combinedBalance) / Math.pow(10, decimals);
        const symbol = existing.token.symbol;
        
        // Recalculate balanceFormatted from raw balance using decimals
        const balanceFormatted = formatBalanceWithDecimals(combinedAmount, symbol);
        
        // Combine USD values
        const combinedValueUSD = existing.valueUSD + vaultHolding.valueUSD;
        
        combinedMap.set(key, {
          ...existing,
          balance: combinedBalance,
          balanceFormatted: balanceFormatted,
          valueUSD: combinedValueUSD,
          token: {
            ...existing.token,
            name: existing.token.name // Keep original name
          }
        });
      } else {
        // New holding from vault
        combinedMap.set(key, vaultHolding);
      }
    });
    
    return Array.from(combinedMap.values());
  }, []);


  /**
   * Validate balance calculation integrity
   */
  const validateBalanceCalculation = useCallback((
    totalPortfolioValue: number,
    holdings: TokenBalance[]
  ): void => {
    const holdingsSum = holdings.reduce((sum, holding) => {
      return sum + (isValidNumber(holding.valueUSD) ? holding.valueUSD : 0);
    }, 0);
    
    const difference = Math.abs(totalPortfolioValue - holdingsSum);
    
    // Balance calculation discrepancy check (silent)
  }, []);

  // ============================================================================
  // Core Balance Refresh Logic
  // ============================================================================

  /**
   * Refresh balances for base account and trading vault
   */
  const refreshBalances = useCallback(async (forceRefresh: boolean = false): Promise<void> => {
    // Farcaster users - prefer base account, fallback to trading wallet
    const addressToUse =
      state.primaryWallet?.address ||
      state.baseAccountAddress ||
      user?.baseAccountAddress ||
      state.tradingWallet?.address ||
      state.tradingWalletAddress ||
      null;

    if (!addressToUse || !token) {
      return;
    }

    // Prevent concurrent calls
    if (isRefreshingRef.current) {
      return;
    }

    // Prevent too frequent refreshes (unless force refresh)
    const timeSinceLastRefresh = Date.now() - lastUpdateTimestampRef.current;
    if (!forceRefresh && timeSinceLastRefresh < 2000) {
      return;
    }

    // Always set loading state before starting refresh
    setState(prev => ({
      ...prev,
      isLoading: true,
      error: null
    }));

    // Wrap entire logic in try-finally to ensure isRefreshingRef is always reset
    try {
      isRefreshingRef.current = true;

      // Fetch base account balance (always fetch fresh, cache only raw balances)
      const balanceData = await fetchBalanceData(addressToUse, forceRefresh);
      const baseHoldings = convertHoldingsToTokenBalance(balanceData.holdings);
      
      // Recalculate USD values from fresh prices (don't use cached USD values)
      const baseAccountTotal = baseHoldings.reduce((sum, holding) => {
        return sum + (isValidNumber(holding.valueUSD) ? holding.valueUSD : 0);
      }, 0);

      // Determine trading wallet address from state
      let tradingAddress =
        state.tradingWallet?.address ||
        state.tradingWalletAddress ||
        null;

      // Fetch trading wallet from API if not in state
      let foundTradingWallet: ClientUserWallet | null = null;
      if (!tradingAddress && user?.fid && token) {
        try {
          const wallets = await clientWalletService.getAllUserWallets();
          foundTradingWallet = wallets.find(w => w.walletType === 'trading') || null;
          if (foundTradingWallet) {
            tradingAddress = foundTradingWallet.address;
            // Update state with found trading wallet
            setState(prev => ({
              ...prev,
              tradingWallet: foundTradingWallet,
              tradingWalletAddress: tradingAddress
            }));
          }
        } catch (walletFetchError) {
          console.warn('[IntegratedWallet] Could not fetch trading wallet from API:', walletFetchError);
        }
      }

      // Fetch trading vault balance if it exists and is different from base account
      let tradingVaultTotal = 0;
      let tradingVaultHoldings: TokenBalance[] = [];
      
      // CRITICAL: Always fetch trading wallet balance for Farcaster users (even if same address)
      // This ensures Holdings section shows trading wallet balance, not Farcaster wallet balance
      if (tradingAddress) {
        if (tradingAddress.toLowerCase() !== addressToUse.toLowerCase()) {
          // Different addresses - fetch trading vault balance separately
          try {
            const tradingBalanceData = await fetchBalanceData(tradingAddress, forceRefresh);
            const tradingVaultHoldingsRaw = convertHoldingsToTokenBalance(tradingBalanceData.holdings)
              .filter(vaultHolding => parseFloat(vaultHolding.balance) > 0);
            
            // Recalculate USD values from fresh prices
            tradingVaultTotal = tradingVaultHoldingsRaw.reduce((sum, holding) => {
              return sum + (isValidNumber(holding.valueUSD) ? holding.valueUSD : 0);
            }, 0);
            
            tradingVaultHoldings = tradingVaultHoldingsRaw;
          } catch (vaultError) {
            // Unable to fetch trading vault balance
          }
        } else {
          // For Farcaster users: Even if addresses are the same, fetch trading wallet separately
          // This ensures we get trading wallet balance, not Farcaster wallet balance
          try {
            const tradingBalanceData = await fetchBalanceData(tradingAddress, forceRefresh);
            const tradingVaultHoldingsRaw = convertHoldingsToTokenBalance(tradingBalanceData.holdings)
              .filter(vaultHolding => parseFloat(vaultHolding.balance) > 0);
            
            // Recalculate USD values from fresh prices
            tradingVaultTotal = tradingVaultHoldingsRaw.reduce((sum, holding) => {
              return sum + (isValidNumber(holding.valueUSD) ? holding.valueUSD : 0);
            }, 0);
            
            tradingVaultHoldings = tradingVaultHoldingsRaw;
          } catch (vaultError) {
            console.warn('[IntegratedWallet] Unable to fetch trading vault balance:', vaultError);
          }
        }
      }

      // Merge holdings from base account and trading vault (for total portfolio view)
      const combinedHoldings = mergeHoldings(baseHoldings, tradingVaultHoldings);
      
      // Trading holdings: ONLY from trading vault (for Holdings section display)
      // This ensures Holdings section matches the main trading balance
      const tradingOnlyHoldings = tradingVaultHoldings.length > 0 
        ? tradingVaultHoldings 
        : [];
      
      // Recalculate USD values for combined holdings (fresh prices)
      const holdingsSum = combinedHoldings.reduce((sum, holding) => {
        return sum + (isValidNumber(holding.valueUSD) ? holding.valueUSD : 0);
      }, 0);
      
      // Calculate total portfolio value from recalculated holdings
      const totalPortfolioValue = holdingsSum;
      
      // Validate calculation integrity (after merging and recalculation)
      validateBalanceCalculation(totalPortfolioValue, combinedHoldings);

      // Find native token holding for formatted display
      const NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000';
      const nativeHolding = baseHoldings.find(
        holding => holding.token.address.toLowerCase() === NATIVE_ADDRESS ||
                   holding.token.symbol.toUpperCase() === nativeSymbol.toUpperCase()
      );
      const combinedNativeHolding = combinedHoldings.find(
        holding => holding.token.address.toLowerCase() === NATIVE_ADDRESS ||
                   holding.token.symbol.toUpperCase() === nativeSymbol.toUpperCase()
      );

      // Atomic state update - prevents flickering by updating all values at once
      setState(prev => {
        // Check if this is stale data (older than previous update)
        const currentTimestamp = Date.now();
        const timeSinceLastUpdate = currentTimestamp - lastUpdateTimestampRef.current;
        
        // If we just updated less than 1 second ago and this is not a force refresh, skip if data looks stale
        if (!forceRefresh && timeSinceLastUpdate < 1000 && prev.holdings.length > 0) {
          const hasFewerHoldings = combinedHoldings.length < prev.holdings.length;
          const totalDifference = Math.abs(totalPortfolioValue - prev.totalPortfolioValue);
          const isSignificantDifference = totalDifference > prev.totalPortfolioValue * 0.5; // 50% difference
          
          if (hasFewerHoldings && isSignificantDifference) {
            return prev; // Keep previous state
          }
        }
        
        // Update timestamp
        lastUpdateTimestampRef.current = currentTimestamp;
        
        // Preserve previous values if new data is invalid or empty
        const hasValidNewData = Array.isArray(combinedHoldings) && combinedHoldings.length > 0
        const shouldUpdateHoldings = hasValidNewData || prev.holdings.length === 0
        
        const newTotalPortfolioValue = isValidNumber(totalPortfolioValue) && totalPortfolioValue >= 0
          ? totalPortfolioValue
          : prev.totalPortfolioValue;
        
        // Only update holdings if we have valid new data, or if we have no previous holdings
        const newHoldings = shouldUpdateHoldings ? combinedHoldings : prev.holdings;
        
        // Trading holdings: only from trading vault (for Holdings section)
        const newTradingHoldings = shouldUpdateHoldings ? tradingOnlyHoldings : prev.tradingHoldings;
        
        // Calculate avantis balance - ONLY USDC from TRADING WALLET (not Farcaster/Base wallet)
        let calculatedAvantisBalance = 0;
        
        // CRITICAL: Only show balance from trading wallet, NOT from Farcaster/Base wallet
        if (tradingAddress) {
          // Trading wallet exists - get USDC from trading vault holdings ONLY
          const tradingVaultUSDC = tradingVaultHoldings.find(h => h.token.symbol === 'USDC');
          if (tradingVaultUSDC && tradingVaultUSDC.valueUSD > 0) {
            calculatedAvantisBalance = tradingVaultUSDC.valueUSD;
          }
          // If no USDC in trading vault, balance stays $0
        }
        // If no trading wallet exists, balance stays $0
        
        // Only update avantis balance if it's valid or if we're forcing an update
        const newAvantisBalance = isValidNumber(calculatedAvantisBalance) && calculatedAvantisBalance >= 0
          ? calculatedAvantisBalance
          : prev.avantisBalance;
        
        return {
        ...prev,
          ethBalance: balanceData.ethBalance || prev.ethBalance,
          ethBalanceFormatted: combinedNativeHolding?.balanceFormatted || 
                             nativeHolding?.balanceFormatted || 
                             `${balanceData.ethBalanceFormatted} ${nativeSymbol}` ||
                             prev.ethBalanceFormatted,
          holdings: newHoldings,
          tradingHoldings: newTradingHoldings,
          baseHoldings: shouldUpdateHoldings ? baseHoldings : prev.baseHoldings,
          totalPortfolioValue: newTotalPortfolioValue,
          dailyChange: isValidNumber(balanceData.dailyChange) ? balanceData.dailyChange : prev.dailyChange,
          dailyChangePercentage: isValidNumber(balanceData.dailyChangePercentage) ? balanceData.dailyChangePercentage : prev.dailyChangePercentage,
          lastDayValue: isValidNumber(balanceData.lastDayValue) ? balanceData.lastDayValue : prev.lastDayValue,
          avantisBalance: newAvantisBalance,
          isAvantisConnected: newAvantisBalance > 0,
          hasRealAvantisBalance: newAvantisBalance > 0,
          ...(tradingAddress && !prev.tradingWalletAddress ? {
            tradingWalletAddress: tradingAddress
          } : {}),
          isLoading: false,
        error: null
        };
      });
    } catch (error) {
      console.error('[IntegratedWallet] Error refreshing real balances:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to refresh balances'
      }));
    } finally {
      // Always reset the refresh flag, even if an error occurred
      isRefreshingRef.current = false;
    }
  }, [
    state.primaryWallet,
    state.baseAccountAddress,
    state.tradingWallet,
    state.tradingWalletAddress,
    user?.baseAccountAddress,
    user?.fid,
    token,
    fetchBalanceData,
    convertHoldingsToTokenBalance,
    mergeHoldings,
    validateBalanceCalculation,
    nativeSymbol,
    clientWalletService
  ]);

  // ============================================================================
  // Wallet Management
  // ============================================================================

  /**
   * Refresh wallet list from API
   */
  const refreshWallets = useCallback(async () => {
    // Farcaster users only
    if (!user?.fid || !token) {
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const wallets = await clientWalletService.getAllUserWallets();

      const baseWalletFromApi = wallets.find(w => w.walletType === 'base-account');
      const tradingWallet: ClientUserWallet | null = wallets.find(w => w.walletType === 'trading') || null;

      const baseWallet: ClientUserWallet | null = baseWalletFromApi || (user.baseAccountAddress
        ? {
            id: `fid_${user.fid}_base-account`,
            address: user.baseAccountAddress,
            chain: 'base',
            createdAt: new Date(),
            walletType: 'base-account'
          } as ClientUserWallet
        : null);

      const combinedWallets =
        baseWallet && !baseWalletFromApi
          ? [...wallets, baseWallet]
          : wallets;

      // Farcaster users - base account is primary, trading wallet is fallback
      const primaryWallet = baseWallet || tradingWallet || wallets[0] || null;
      const walletForBalances = baseWallet || primaryWallet;

      // Extract addresses
      const baseAddress: string | null = baseWallet ? baseWallet.address : (user.baseAccountAddress || null);
      const tradingAddress: string | null = tradingWallet ? tradingWallet.address : null;

      if (walletForBalances) {
        // Update wallet state - NO automatic balance refresh
      setState(prev => ({
        ...prev,
        isConnected: !!primaryWallet,
          baseAccountAddress: baseAddress,
          tradingWalletAddress: tradingAddress,
        primaryWallet,
        tradingWallet,
        allWallets: combinedWallets,
          isLoading: false
      }));
      } else {
        // No wallet found
        setState(prev => ({
          ...prev,
          isConnected: !!primaryWallet,
          baseAccountAddress: baseAddress,
          tradingWalletAddress: tradingAddress,
          primaryWallet,
          tradingWallet,
          allWallets: combinedWallets,
          isLoading: false
        }));
      }
    } catch (error) {
      console.error('Error refreshing wallets:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load wallets';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
        baseAccountAddress: user?.baseAccountAddress || null,
        tradingWalletAddress: null
      }));
    }
  }, [user?.fid, user?.baseAccountAddress, token, refreshBalances, clientWalletService]);

  /**
   * Create a new wallet
   */
  const createWallet = useCallback(async (chain: string, mnemonic?: string): Promise<ClientUserWallet | null> => {
    // Farcaster users only
    if (!user?.fid || !token) return null;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await clientWalletService.createWallet({ chain, mnemonic });
      
      if (result.success && result.wallet) {
        await refreshWallets();
        return {
          ...result.wallet,
          walletType: (chain || 'ethereum').toLowerCase() === 'ethereum' ? 'trading' : result.wallet.walletType
        } as ClientUserWallet;
      } else {
        throw new Error(result.error || 'Failed to create wallet');
      }
    } catch (error) {
      console.error('Error creating wallet:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to create wallet'
      }));
      return null;
    }
  }, [user?.fid, token, refreshWallets, clientWalletService]);

  /**
   * Switch to a different wallet
   */
  const switchToWallet = useCallback(async (walletId: string) => {
    const wallet = state.allWallets.find(w => w.id === walletId);
    if (wallet) {
      setState(prev => ({
        ...prev,
        primaryWallet: wallet,
        isConnected: true
      }));
    }
  }, [state.allWallets]);

  /**
   * Get wallet for specific chain
   */
  const getWalletForChain = useCallback((chain: string): ClientUserWallet | null => {
    return state.allWallets.find(wallet => wallet.chain === chain) || null;
  }, [state.allWallets]);

  // ============================================================================
  // Effects
  // ============================================================================

  // Refs for tracking wallet loading state
  const hasLoadedWalletsRef = useRef(false);
  const hasInitialRefreshRef = useRef(false);
  
  useEffect(() => {
    // Farcaster users only
    if (user?.fid && token && !hasLoadedWalletsRef.current) {
      hasLoadedWalletsRef.current = true;
      
      // Just load wallets, don't refresh balances yet
      refreshWallets().catch(err => {
        console.error('[IntegratedWallet] Initial wallet load failed:', err);
      });
    }
  }, [user?.fid, token, refreshWallets]);

  // Do ONE initial balance refresh AFTER wallet addresses are loaded into state
  useEffect(() => {
    if (
      !hasInitialRefreshRef.current && 
      hasLoadedWalletsRef.current && 
      token &&
      (state.baseAccountAddress || state.tradingWalletAddress)
    ) {
      hasInitialRefreshRef.current = true;
      
      // Give it a moment to ensure state is fully settled
      setTimeout(() => {
        refreshBalances(true)
          .then(() => {
            // Mark initial load as complete
            setState(prev => ({ ...prev, hasCompletedInitialLoad: true }));
          })
          .catch(err => {
            console.error('[IntegratedWallet] Initial balance refresh failed:', err);
            // Still mark as complete even if it failed
            setState(prev => ({ ...prev, hasCompletedInitialLoad: true }));
          });
      }, 300);
    }
  }, [state.baseAccountAddress, state.tradingWalletAddress, token, refreshBalances]);

  // ============================================================================
  // Public API Wrapper
  // ============================================================================

  /**
   * Wrapper for refreshBalances to match interface (forceRefresh is optional)
   */
  const refreshBalancesWrapper = useCallback(async (forceRefresh: boolean = false) => {
    return refreshBalances(forceRefresh);
  }, [refreshBalances]);

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: IntegratedWalletContextType = {
    ...state,
    refreshWallets,
    createWallet,
    switchToWallet,
    refreshBalances: refreshBalancesWrapper,
    getWalletForChain
  };

  return (
    <IntegratedWalletContext.Provider value={value}>
      {children}
    </IntegratedWalletContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useIntegratedWallet(): IntegratedWalletContextType {
  const context = useContext(IntegratedWalletContext);
  if (context === undefined) {
    throw new Error('useIntegratedWallet must be used within an IntegratedWalletProvider');
  }
  return context;
}
