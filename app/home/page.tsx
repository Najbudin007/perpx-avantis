"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useIntegratedWallet } from "@/lib/wallet/IntegratedWalletContext"
import { useAuth } from "@/lib/auth/AuthContext"
import { useTrading } from "@/lib/hooks/useTrading"
import { useTradingProfits } from "@/lib/hooks/useTradingProfits"
import { usePositions } from "@/lib/hooks/usePositions"
import { useTradingSession } from "@/lib/hooks/useTradingSession"
import { ProtectedRoute } from "@/components/ProtectedRoute"
import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useToast } from "@/components/ui/toast"
import { ProgressIndicator } from "@/components/ui/progress-indicator"
import { EmptyState } from "@/components/ui/empty-state"
import { BalanceSkeleton, CardSkeleton } from "@/components/ui/loading-skeleton"
import { NavigationHeader } from "@/components/NavigationHeader"
import { DepositModal } from "@/components/DepositModal"
import { WalletConnectionModal } from "@/components/WalletConnectionModal"
import { WithdrawModal } from "@/components/WithdrawModal"
import { BuildTimestamp } from "@/components/BuildTimestamp"
import { PositionsTable } from "@/components/PositionsTable"
import type { Position } from "@/types/trading"
import { FloatingLiveCard } from "@/components/FloatingLiveCard"
import { Modal } from "@/components/ui/modal"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useBaseAccountTransactions } from "@/lib/services/BaseAccountTransactionService"
import { useBaseMiniApp } from "@/lib/hooks/useBaseMiniApp"

// Type definitions
interface TokenBalance {
  token: {
    symbol: string
    name: string
    decimals: number
  }
  balance: string
  balanceFormatted: string
  valueUSD: number
}

// Memoized components for better performance
const PortfolioBalanceCard = ({ 
  avantisBalance,
  totalProfits, 
  isBalanceVisible, 
  setIsBalanceVisible,
  isConnected,
  isTradingLoading,
  tradingError,
  isLoading,
  positionCollateral = 0,
  positionPnL = 0,
  openPositions = 0
}: {
  avantisBalance: number
  totalProfits: number
  isBalanceVisible: boolean
  setIsBalanceVisible: (visible: boolean) => void
  isConnected: boolean
  isTradingLoading: boolean
  tradingError: string | null
  isLoading: boolean
  positionCollateral?: number
  positionPnL?: number
  openPositions?: number
}) => {
  // avantisBalance is the wallet USDC balance (not including collateral in positions)
  // Total balance = wallet USDC + collateral locked in positions + unrealized PnL
  const totalAccountValue = avantisBalance + positionCollateral + positionPnL
  // Display the TOTAL balance (including positions and PnL) - this matches what users expect
  const totalTradingValue = totalAccountValue
  const availableBalance = avantisBalance // Available for new trades
  const hasActivePositions = openPositions > 0
  
  const [displayBalance, setDisplayBalance] = useState(totalTradingValue)
  const [isAnimating, setIsAnimating] = useState(false)
  const prevBalanceRef = useRef(totalTradingValue)

  const formatValue = useCallback((value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value)
  }, [])

  // Animate balance changes
  useEffect(() => {
    if (prevBalanceRef.current !== totalTradingValue && !isLoading) {
      const oldBalance = prevBalanceRef.current
      setIsAnimating(true)
      const diff = totalTradingValue - oldBalance
      const steps = 20
      const stepSize = diff / steps
      let currentStep = 0

      const interval = setInterval(() => {
        currentStep++
        if (currentStep >= steps) {
          setDisplayBalance(totalTradingValue)
          setIsAnimating(false)
          prevBalanceRef.current = totalTradingValue // Update ref only after animation completes
          clearInterval(interval)
        } else {
          setDisplayBalance(oldBalance + (stepSize * currentStep))
        }
      }, 30)

      return () => clearInterval(interval)
    } else if (isLoading) {
      setDisplayBalance(totalTradingValue)
      prevBalanceRef.current = totalTradingValue
    } else if (prevBalanceRef.current === totalTradingValue) {
      // No change, just ensure display matches
      setDisplayBalance(totalTradingValue)
    }
  }, [totalTradingValue, isLoading])

  const toggleBalance = useCallback(() => setIsBalanceVisible(!isBalanceVisible), [isBalanceVisible, setIsBalanceVisible])

  return (
    <Card className="bg-[#1a1a1a] border-[#262626] p-4 sm:p-6 rounded-2xl">
      <div className="space-y-2">
        <h2 className="text-[#b4b4b4] text-sm font-medium">Trading Balance</h2>
        <div className="flex items-center space-x-3">
          <span 
            className={`text-3xl sm:text-4xl font-bold text-white transition-all duration-300 ${
              isAnimating ? 'scale-110' : 'scale-100'
            } ${totalTradingValue > prevBalanceRef.current ? 'text-green-400' : totalTradingValue < prevBalanceRef.current ? 'text-red-400' : 'text-white'}`}
          >
            {isLoading && totalTradingValue === 0 ? (
              <span className="text-[#9ca3af] text-2xl sm:text-3xl">Loading...</span>
            ) : (
              isBalanceVisible ? formatValue(displayBalance) : "••••••"
            )}
          </span>
          <button
            onClick={toggleBalance}
            className="text-white hover:text-gray-300 transition-colors p-1"
          >
            {isBalanceVisible ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-white">
                <path d="M1 12S5 4 12 4S23 12 23 12S19 20 12 20S1 12 1 12Z" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-white">
                <path
                  d="M9.88 9.88a3 3 0 1 0 4.24 4.24"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
        
        {/* Simplified status info focused on trading */}
        <div className="text-xs text-[#9ca3af] mt-2">
          {hasActivePositions ? (
            <span className="text-green-400">
              {openPositions} active position{openPositions > 1 ? 's' : ''} • 
              Collateral: ${positionCollateral.toFixed(2)} • 
              PnL: <span className={positionPnL >= 0 ? 'text-green-400' : 'text-red-400'}>${positionPnL.toFixed(2)}</span>
            </span>
          ) : (
            <>Available for automated trading • {totalTradingValue >= 10 ? 'Ready to trade' : 'Minimum $10 required'}</>
          )}
        </div>
        
        {/* Trading Profits Breakdown */}
        {totalProfits > 0 && (
          <div className="mt-3 p-3 bg-[#1f2937] border border-[#374151] rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-[#9ca3af] text-sm">Trading Profits:</span>
              <span className="text-[#27c47d] font-medium text-sm">+${totalProfits.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

const TradingCard = ({ 
  targetProfit, 
  setTargetProfit,
  targetProfitPercent,
  setTargetProfitPercent,
  investmentAmount,
  setInvestmentAmount, 
  primaryWallet, 
  baseAccountAddress,
  tradingWalletAddress,
  avantisBalance,
  onDeposit,
  isDepositing,
  depositError,
  recentDepositHash,
  isBaseContextAvailable,
  holdings = [],
  ethBalanceFormatted = '0',
  onViewTrades,
  isRefreshingBalance = false,
  addToast,
  startTradingSession,
}: {
  targetProfit: string
  setTargetProfit: (value: string) => void
  targetProfitPercent: string
  setTargetProfitPercent: (value: string) => void
  investmentAmount: string
  setInvestmentAmount: (value: string) => void
  primaryWallet: { address: string; privateKey?: string; chain: string } | null
  baseAccountAddress: string | null
  tradingWalletAddress: string | null
  avantisBalance: number
  onDeposit: (params: { amount: string; asset: 'USDC' | 'ETH' }) => Promise<void>
  isDepositing: boolean
  depositError: string | null
  recentDepositHash: string | null
  isBaseContextAvailable: boolean
  holdings?: TokenBalance[]
  ethBalanceFormatted?: string
  onViewTrades?: () => Promise<void>
  isRefreshingBalance?: boolean
  addToast: (toast: { type: 'success' | 'error' | 'warning' | 'info'; title: string; message: string }) => void
  startTradingSession: (config: {
    investmentAmount?: number;
    profitGoal?: number;
    targetProfit?: number;
    maxPerSession?: number;
    lossThreshold?: number;
  }, onProgress?: (step: string, message: string) => void) => Promise<string>
}) => {
  const [isTrading, setIsTrading] = useState(false)
  const { positionData } = usePositions() // Removed positionsLoading - it shouldn't block button
  const [depositAsset, setDepositAsset] = useState<'USDC' | 'ETH'>('USDC')
  const [depositAmount, setDepositAmount] = useState('')
  const [hasSuccessfulDeposit, setHasSuccessfulDeposit] = useState(false)
  const [lossThreshold, setLossThreshold] = useState('10')
  const [maxPositions, setMaxPositions] = useState('1')
  
  // Min/Max validation constants
  const MIN_INVESTMENT = 10 // Minimum $10 to trade
  const FEE_PERCENTAGE = 0.01 // 1% commission fee
  
  // Memoize validation calculations for performance
  // Parse investment amount for validation - use useMemo to avoid recalculation on every render
  const investmentNum = useMemo(() => parseFloat(investmentAmount) || 0, [investmentAmount])
  const targetProfitPercentNum = useMemo(() => parseFloat(targetProfitPercent) || 0, [targetProfitPercent])
  
  // Calculate target profit USD from percent for validation and trading
  const targetProfitNum = useMemo(() => {
    if (investmentNum > 0 && targetProfitPercentNum > 0) {
      return (targetProfitPercentNum / 100) * investmentNum
    }
    return 0
  }, [investmentNum, targetProfitPercentNum])

  // Sync targetProfit USD value when percent or investment changes
  // Optimized: Only update when values actually change, not on every render
  useEffect(() => {
    if (targetProfitPercent && investmentNum > 0) {
      const pct = parseFloat(targetProfitPercent)
      if (!isNaN(pct) && pct >= 0) {
        const amount = (pct / 100) * investmentNum
        const newTargetProfit = amount.toFixed(2)
        // Only update if value actually changed (prevents unnecessary re-renders)
        if (targetProfit !== newTargetProfit) {
          setTargetProfit(newTargetProfit)
        }
      }
    } else if (!targetProfitPercent) {
      if (targetProfit !== "") {
        setTargetProfit("")
      }
    }
  }, [targetProfitPercent, investmentAmount, investmentNum, targetProfit, setTargetProfit])
  
  // Memoize all validation calculations for instant button state updates
  const validation = useMemo(() => {
  // Calculate commission fee (1% of trading amount)
  const commissionFee = investmentNum * FEE_PERCENTAGE
  
  // Total required = trading amount + commission fee
  const totalRequired = investmentNum + commissionFee
  
  // Maximum investment = balance - fee (so user can pay both)
  // For max, we need to solve: amount + (amount * 0.01) = balance
  // amount * 1.01 = balance => amount = balance / 1.01
  const MAX_INVESTMENT = avantisBalance / (1 + FEE_PERCENTAGE)
  
  // Minimum balance needed = $10 + $0.10 fee = $10.10
  const MIN_BALANCE_REQUIRED = MIN_INVESTMENT * (1 + FEE_PERCENTAGE)
  
    // Validation checks - all synchronous, no async operations
  const isInvestmentBelowMin = investmentNum > 0 && investmentNum < MIN_INVESTMENT
  const isInvestmentAboveMax = investmentNum > MAX_INVESTMENT && MAX_INVESTMENT > 0
  const hasEnoughForFee = avantisBalance >= totalRequired
  const isInvestmentValid = investmentNum >= MIN_INVESTMENT && investmentNum <= MAX_INVESTMENT && hasEnoughForFee
  const isBalanceTooLow = avantisBalance < MIN_BALANCE_REQUIRED
  const isTargetProfitTooHigh = targetProfitPercentNum > 100
    
    return {
      commissionFee,
      totalRequired,
      MAX_INVESTMENT,
      MIN_BALANCE_REQUIRED,
      isInvestmentBelowMin,
      isInvestmentAboveMax,
      hasEnoughForFee,
      isInvestmentValid,
      isBalanceTooLow,
      isTargetProfitTooHigh
    }
  }, [investmentNum, targetProfitPercentNum, avantisBalance])
  
  // Destructure for use in component
  const {
    commissionFee,
    totalRequired,
    MAX_INVESTMENT,
    MIN_BALANCE_REQUIRED,
    isInvestmentBelowMin,
    isInvestmentAboveMax,
    hasEnoughForFee,
    isInvestmentValid,
    isBalanceTooLow,
    isTargetProfitTooHigh
  } = validation

  const explorerBaseUrl = process.env.NEXT_PUBLIC_AVANTIS_NETWORK === 'base-mainnet'
    ? 'https://basescan.org'
    : 'https://sepolia.basescan.org'

  const router = useRouter()

  useEffect(() => {
    if (recentDepositHash) {
      setHasSuccessfulDeposit(true)
      setDepositAmount('')
    }
  }, [recentDepositHash])

  useEffect(() => {
    if (depositError) {
      setHasSuccessfulDeposit(false)
    }
  }, [depositError])

  // Check if there are active positions
  const hasActivePositions = positionData && positionData.openPositions > 0

  // Memoize button disabled state for instant updates - calculate before render
  const isButtonDisabled = useMemo(() => {
    if (isTrading) return true
    if (hasActivePositions) return false
    // All validation checks are synchronous and use memoized values
    return (
      isTargetProfitTooHigh ||
      !targetProfitPercent || 
      !investmentAmount || 
      targetProfitPercentNum <= 0 || 
      targetProfitPercentNum > 100 ||
      !isInvestmentValid
    )
  }, [isTrading, hasActivePositions, isTargetProfitTooHigh, targetProfitPercent, investmentAmount, targetProfitPercentNum, isInvestmentValid])

  // Guard against duplicate session starts
  const isStartingTradingRef = useRef(false)
  
  const handleStartTrading = async () => {
    // Guard: Prevent duplicate session starts
    if (isStartingTradingRef.current || isTrading) {
      addToast({
        type: 'warning',
        title: 'Already Starting',
        message: 'Trading session is already being started. Please wait...'
      })
      return
    }
    
    // Validate that both fields are filled
    if (!targetProfitPercent || !investmentAmount) {
      addToast({
        type: 'error',
        title: 'Validation Error',
        message: 'Please fill in both target profit and investment amount.'
      })
      return;
    }
    
    const profitPercentNum = parseFloat(targetProfitPercent);
    const investmentNum = parseFloat(investmentAmount);
    
    // Validate numeric values
    if (isNaN(profitPercentNum) || profitPercentNum <= 0 || profitPercentNum > 100) {
      addToast({
        type: 'error',
        title: 'Invalid Target Profit',
        message: 'Target profit must be between 0% and 100%.'
      })
      return;
    }
    
    if (isNaN(investmentNum) || investmentNum <= 0) {
      addToast({
        type: 'error',
        title: 'Invalid Investment',
        message: 'Investment amount must be greater than 0.'
      })
      return;
    }

    // Check ETH balance for gas fees
    // Minimum ETH required: ~0.0002 ETH (0.0001 for execution fee + 0.0001 buffer for gas)
    const MIN_ETH_REQUIRED = 0.0002;
    const ethBalanceNum = ethBalanceFormatted 
      ? parseFloat(ethBalanceFormatted.replace(/[^0-9.]/g, '')) || 0
      : 0;
    
    if (ethBalanceNum < MIN_ETH_REQUIRED) {
      addToast({
        type: 'error',
        title: 'Insufficient ETH Balance',
        message: `You need at least ${MIN_ETH_REQUIRED} ETH for gas fees to start trading. Your current ETH balance is ${ethBalanceNum.toFixed(6)} ETH. Please deposit ETH to your wallet.`
      })
      return;
    }

    // Calculate target profit USD from percent (already validated to be <= 100%)
    const profitNum = (profitPercentNum / 100) * investmentNum;
    
    // Set guard flag
    isStartingTradingRef.current = true
    setIsTrading(true)
    
    try {
      addToast({
        type: 'info',
        title: 'Starting Trading',
        message: 'Initializing trading session...'
      })
      
      // Start trading session with progress callbacks
      await startTradingSession({
        investmentAmount: investmentNum,
        profitGoal: profitNum,
        targetProfit: profitNum,
        maxPerSession: parseInt(maxPositions) || 1,
        lossThreshold: parseFloat(lossThreshold) || 10,
        // Pass wallet details so backend doesn’t reject
        walletAddress: tradingWalletAddress || baseAccountAddress || primaryWallet?.address || ''
      } as any, (step: string, message: string) => {
        try {
          // Show progress updates via toast with error handling
          if (step === 'fee') {
            addToast({
              type: 'info',
              title: 'Processing Fee',
              message: message
            })
          } else if (step === 'session') {
            addToast({
              type: 'info',
              title: 'Starting Session',
              message: message
            })
          } else if (step === 'complete') {
            // Use setTimeout to ensure toast doesn't crash the app
            setTimeout(() => {
              try {
                addToast({
                  type: 'success',
                  title: 'Trading Started',
                  message: 'Your trading session is now active!'
                })
              } catch (toastError) {
                console.error('Error showing success toast:', toastError)
              }
            }, 100)
          }
        } catch (progressError) {
          console.error('Error in progress callback:', progressError)
          // Don't throw - just log the error
        }
      })
      
      // Clear form after successful start
      setTargetProfitPercent('')
      setInvestmentAmount('')
      setTargetProfit('')
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start trading'
      console.error('[handleStartTrading] Error starting trading:', error)
      
      // Show error toast with error handling
      try {
        addToast({
          type: 'error',
          title: 'Trading Start Failed',
          message: errorMessage
        })
      } catch (toastError) {
        console.error('Error showing error toast:', toastError)
        // Fallback: at least log to console
        console.error('Trading Start Failed:', errorMessage)
      }
    } finally {
      setIsTrading(false)
      isStartingTradingRef.current = false
    }
  }



  return (
    <div className="space-y-4">
      {/* Start Trading Card */}
      <Card className="bg-[#1a1a1a] border-[#262626] p-4 sm:p-6 rounded-2xl">
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-[#8759ff]">
          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="currentColor"/>
        </svg>
        <h3 className="text-white font-semibold text-lg">AI Trading Goals</h3>
      </div>
      
        <div className="space-y-4">
        {/* Only show input fields when no active positions */}
        {!hasActivePositions && (
          <>
            {/* Target Profit (Percent) */}
            <div>
              <label className="block text-[#9ca3af] text-xs font-medium mb-1">
                Target Profit* (% of investment)
              </label>
              <div className="relative">
                <Input
                  type="number"
                  value={targetProfitPercent}
                  onChange={(e) => {
                    const value = e.target.value
                    // Allow empty input - update immediately
                    if (value === "") {
                      setTargetProfitPercent("")
                      setTargetProfit("")
                      return
                    }

                    let pct = parseFloat(value)
                    if (isNaN(pct) || pct < 0) {
                      // Allow typing negative numbers temporarily, but don't update targetProfit
                      setTargetProfitPercent(value)
                      return
                    }

                    // Clamp to 0-100% - update immediately
                    if (pct > 100) pct = 100
                    setTargetProfitPercent(pct.toString())

                    // Calculate target profit immediately (synchronous, no delay)
                    const investmentVal = parseFloat(investmentAmount) || 0
                    if (investmentVal > 0) {
                      const amount = (pct / 100) * investmentVal
                      setTargetProfit(amount.toFixed(2))
                    } else {
                      setTargetProfit("")
                    }
                  }}
                  className={`bg-[#2a2a2a] border-[#444] text-white text-sm pr-12 ${
                    isTargetProfitTooHigh ? "border-red-500" : ""
                  }`}
                  placeholder="20"
                  min={0}
                  max={100}
                />
                <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[#9ca3af] text-sm">%</span>
              </div>
            </div>
            
            {/* Investment Amount */}
            <div>
              <label className="block text-[#9ca3af] text-xs font-medium mb-1">
                Investment Amount*
              </label>
              <div className="relative">
                <Input
                  type="number"
                  value={investmentAmount}
                  onChange={(e) => {
                    // Update immediately - no debouncing or delays
                    const value = e.target.value
                    setInvestmentAmount(value)
                    
                    // Also update target profit if percent is set (synchronous calculation)
                    if (targetProfitPercent) {
                      const pct = parseFloat(targetProfitPercent) || 0
                      const inv = parseFloat(value) || 0
                      if (pct > 0 && inv > 0) {
                        const amount = (pct / 100) * inv
                        setTargetProfit(amount.toFixed(2))
                      } else {
                        setTargetProfit("")
                      }
                    }
                  }}
                  className={`bg-[#2a2a2a] border-[#444] text-white text-sm pr-12 ${
                    (isInvestmentBelowMin || isInvestmentAboveMax) ? 'border-red-500' : ''
                  }`}
                  placeholder="50"
                  min={MIN_INVESTMENT}
                  max={MAX_INVESTMENT > 0 ? MAX_INVESTMENT : undefined}
                />
                <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[#9ca3af] text-sm">USD</span>
              </div>
            </div>
            
            {/* Loss Threshold */}
            <div>
              <label className="block text-[#9ca3af] text-xs font-medium mb-1">
                Loss Threshold
              </label>
              <div className="relative">
                <Input
                  type="number"
                  value={lossThreshold}
                  onChange={(e) => setLossThreshold(e.target.value)}
                  className="bg-[#2a2a2a] border-[#444] text-white text-sm pr-20"
                  placeholder="10"
                  min="5"
                  max="25"
                />
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => {
                        const current = parseInt(lossThreshold) || 10;
                        if (current < 25) setLossThreshold((current + 1).toString());
                      }}
                      className="text-[#9ca3af] hover:text-white text-xs leading-none h-2 flex items-center"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const current = parseInt(lossThreshold) || 10;
                        if (current > 5) setLossThreshold((current - 1).toString());
                      }}
                      className="text-[#9ca3af] hover:text-white text-xs leading-none h-2 flex items-center"
                    >
                      ▼
                    </button>
                  </div>
                  <span className="text-[#9ca3af] text-sm">%</span>
                </div>
              </div>
            </div>
            
            {/* Max No. of Positions */}
            <div>
              <label className="block text-[#9ca3af] text-xs font-medium mb-2">
                Max No. of Positions
              </label>
              <div className="space-y-2">
                <Input
                  type="number"
                  value={maxPositions}
                  onChange={(e) => setMaxPositions(e.target.value)}
                  className="bg-[#2a2a2a] border-[#444] text-white text-sm"
                  placeholder="1"
                  min="1"
                  max="10"
                />
                <div className="flex gap-2">
                  {[1, 3, 5, 10].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setMaxPositions(num.toString())}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        maxPositions === num.toString()
                          ? 'bg-[#8759ff] text-white'
                          : 'bg-[#2a2a2a] text-[#9ca3af] hover:bg-[#374151]'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
        
        {/* Validation & Helper Messages */}
        {!hasActivePositions && (
          <>
            {/* Target profit vs investment validation */}
            {isTargetProfitTooHigh && (
              <div className="text-red-400 text-xs flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Target profit cannot exceed 100% of the investment amount.
              </div>
            )}
            
            {/* Investment Amount Validation Messages */}
            
            {isInvestmentBelowMin && !isBalanceTooLow && (
              <div className="text-red-400 text-xs flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Minimum investment is ${MIN_INVESTMENT.toFixed(2)}
              </div>
            )}
            
            {isInvestmentAboveMax && (
              <div className="text-red-400 text-xs flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Maximum investment is ${MAX_INVESTMENT.toFixed(2)} (balance minus 1% fee)
              </div>
            )}
            
            {/* Show fee breakdown when valid amount entered */}
            {investmentNum >= MIN_INVESTMENT && hasEnoughForFee && (
              <div className="bg-[#1f2937]/50 border border-[#374151] rounded-lg p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#9ca3af]">Trading Amount:</span>
                  <span className="text-white">${investmentNum.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-xs mt-1">
                  <span className="text-[#9ca3af]">Platform Fee (1%):</span>
                  <span className="text-yellow-400">-${commissionFee.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-xs mt-1 pt-1 border-t border-[#374151]">
                  <span className="text-[#9ca3af]">Total Required:</span>
                  <span className="text-white font-medium">${totalRequired.toFixed(2)}</span>
                </div>
              </div>
            )}
            
          </>
        )}
        
        
        {/* Show active positions info when positions exist */}
        {hasActivePositions && (
          <div className="bg-[#1f2937] border border-[#374151] rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-white font-medium">Active Positions</h3>
              <span className="text-[#27c47d] text-sm font-medium">
                {positionData.openPositions} position{positionData.openPositions !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#9ca3af] text-sm">Total PnL:</span>
              <span className={`font-medium ${positionData.totalPnL >= 0 ? 'text-[#27c47d]' : 'text-[#ef4444]'}`}>
                ${positionData.totalPnL.toFixed(2)}
              </span>
            </div>
          </div>
        )}
        
        
        <Button 
          onClick={hasActivePositions ? (onViewTrades || (() => {})) : handleStartTrading}
          disabled={isButtonDisabled}
          className="w-full bg-[#8759ff] hover:bg-[#7C3AED] text-white font-semibold py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-opacity duration-150"
        >
          {isTrading ? 'Starting...' : hasActivePositions ? 'View Trades' : 'Start Trading'}
        </Button>
        
        {/* Show helpful message when no funds and no trading wallet exists yet (first time) */}
        {avantisBalance === 0 && !tradingWalletAddress && (
          <div className="mt-4 p-4 bg-yellow-900/20 border border-yellow-500 rounded-xl">
            <h4 className="text-yellow-400 font-semibold mb-2">Add Funds to Start Trading</h4>
            <p className="text-yellow-300 text-sm mb-3">
              Your trading balance is $0.00. Deposit funds from your Base wallet into your PrepX trading vault to start trading.
            </p>
            
            {/* Available Funds Section */}
            {holdings.length > 0 && (
              <div className="bg-[#0d0d0d] border border-yellow-700/50 rounded-lg p-3 mb-4 max-h-36 overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <h5 className="text-yellow-200 text-xs font-medium">💼 Your Available Funds</h5>
                  <span className="text-yellow-400 text-[10px]">Farcaster Wallet</span>
                </div>
                <div className="space-y-1.5">
                  {/* ETH Balance */}
                  {(() => {
                    // Parse ETH balance - handle formats like "0.001 ETH" or "0.001"
                    const ethBalanceNum = ethBalanceFormatted 
                      ? parseFloat(ethBalanceFormatted.replace(/[^0-9.]/g, '')) || 0
                      : 0;
                    return ethBalanceNum > 0 ? (
                      <div className="flex items-center justify-between p-1.5 bg-[#1a1a1a] rounded-md">
                        <div className="flex items-center space-x-1.5">
                          <div className="w-5 h-5 rounded-full bg-[#627eea] flex items-center justify-center text-white font-bold text-[9px]">
                            Ξ
                          </div>
                          <span className="text-yellow-100 text-xs font-medium">ETH</span>
                        </div>
                        <div className="text-right">
                          <p className="text-yellow-100 text-xs font-semibold">{ethBalanceNum.toFixed(4)}</p>
                        </div>
                      </div>
                    ) : null;
                  })()}
                  
                  {/* Other Token Holdings */}
                  {holdings.filter(h => h.token.symbol !== 'ETH' && parseFloat(h.balance) > 0).map((holding, index) => (
                    <div key={index} className="flex items-center justify-between p-1.5 bg-[#1a1a1a] rounded-md">
                      <div className="flex items-center space-x-1.5">
                        <div className="w-5 h-5 rounded-full bg-[#2775ca] flex items-center justify-center text-white font-bold text-[9px]">
                          {holding.token.symbol.charAt(0)}
                        </div>
                        <span className="text-yellow-100 text-xs font-medium">{holding.token.symbol}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-yellow-100 text-xs font-semibold">{holding.balanceFormatted}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDepositAsset('USDC')}
                  className={`px-3 py-1 text-sm rounded-lg border transition-colors ${
                    depositAsset === 'USDC' ? 'bg-yellow-500 text-black border-yellow-400' : 'border-yellow-600 text-yellow-300 hover:bg-yellow-800/40'
                  }`}
                >
                  USDC
                </button>
                <button
                  onClick={() => setDepositAsset('ETH')}
                  className={`px-3 py-1 text-sm rounded-lg border transition-colors ${
                    depositAsset === 'ETH' ? 'bg-yellow-500 text-black border-yellow-400' : 'border-yellow-600 text-yellow-300 hover:bg-yellow-800/40'
                  }`}
                >
                  ETH
                </button>
              </div>
              <div>
                <label className="block text-xs text-yellow-200 mb-1">
                  Amount ({depositAsset})
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="bg-[#2a2a2a] border-yellow-700 text-yellow-50 text-sm"
                  placeholder={depositAsset === 'USDC' ? 'Enter USDC amount' : 'Enter ETH amount'}
                />
                <p className="text-[10px] text-yellow-300 mt-1">
                  Base wallet: {baseAccountAddress ? `${baseAccountAddress.slice(0, 6)}...${baseAccountAddress.slice(-4)}` : '—'}
                </p>
                {tradingWalletAddress && (
                  <p className="text-[10px] text-yellow-300">
                    Trading vault: {tradingWalletAddress.slice(0, 6)}...{tradingWalletAddress.slice(-4)}
                  </p>
                )}
              </div>

            <Button
                disabled={
                  isDepositing ||
                  !depositAmount ||
                  Number(depositAmount) <= 0 ||
                  !isBaseContextAvailable
                }
                onClick={async () => {
                  if (!depositAmount) return
                  try {
                    await onDeposit({ amount: depositAmount, asset: depositAsset })
                    setHasSuccessfulDeposit(true)
                  } catch (error) {
                    setHasSuccessfulDeposit(false)
                  }
                }}
                className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold text-sm"
              >
                {isDepositing ? '🚀 Processing...' : `⚡ Deposit ${depositAsset}`}
            </Button>

              {hasSuccessfulDeposit && (
                <div className="text-green-400 text-xs space-y-1">
                  {isRefreshingBalance ? (
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <p>
                        Transaction confirmed! Updating balance...
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <p>
                        ✅ Deposit successful! Balance updated.
                      </p>
                    </div>
                  )}
                  {recentDepositHash && (
                    <a
                      className="underline hover:text-green-200"
                      target="_blank"
                      rel="noopener noreferrer"
                      href={`${explorerBaseUrl}/tx/${recentDepositHash}`}
                    >
                      View transaction on BaseScan
                    </a>
                  )}
                </div>
              )}
              {!isBaseContextAvailable && (
                <p className="text-yellow-300 text-xs">
                  Deposits require the Base mini app context. Please open PrepX inside the Base/Farcaster app.
                </p>
              )}
              {depositError && (
                <p className="text-red-400 text-xs">
                  {depositError}
                </p>
              )}
            </div>
          </div>
        )}
        
            {/* Trading Status */}
        <div className="bg-[#1f2937] border border-[#374151] rounded-lg p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#9ca3af]">Trading Status:</span>
            <span className={`font-medium ${
              hasActivePositions 
                ? 'text-[#27c47d]' 
                : avantisBalance > 0 
                  ? 'text-[#27c47d]' 
                  : 'text-[#f59e0b]'
            }`}>
              {hasActivePositions 
                ? 'Trading Active' 
                : avantisBalance > 0 
                  ? 'Ready to Trade' 
                  : 'Add Funds to Start'
              }
            </span>
          </div>
          <div className="flex items-center justify-between text-sm mt-1">
            <span className="text-[#9ca3af]">Platform:</span>
            <span className="text-white font-medium">Avantis</span>
          </div>
          <div className="flex items-center justify-between text-sm mt-1">
            <span className="text-[#9ca3af]">Wallet:</span>
            <span className="text-white font-medium">
              {tradingWalletAddress ? `${tradingWalletAddress.slice(0, 6)}...${tradingWalletAddress.slice(-4)}` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm mt-1">
            <span className="text-[#9ca3af]">Trading Balance:</span>
            <span className="font-medium text-white">
              ${avantisBalance.toFixed(2)}
            </span>
          </div>
          {hasActivePositions && (
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-[#9ca3af]">Open Positions:</span>
              <span className="font-medium text-[#27c47d]">
                {positionData.openPositions}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  </Card>

    </div>
  )
}

const WalletInfoCard = ({ 
  tradingWallet,
  ethBalanceFormatted,
  avantisBalance,
  tradingWalletAddress,
  baseAccountAddress,
  token: authToken,
  isLoading = false,
  onDeposit,
  isDepositing,
  depositError,
  recentDepositHash,
  holdings = [],
}: {
  tradingWallet: { address: string; privateKey?: string; chain: string } | null
  ethBalanceFormatted: string
  avantisBalance: number
  tradingWalletAddress?: string | null
  baseAccountAddress?: string | null
  token: string | null
  isLoading?: boolean
  onDeposit: (params: { amount: string; asset: 'USDC' | 'ETH' }) => Promise<void>
  isDepositing: boolean
  depositError: string | null
  recentDepositHash: string | null
  holdings?: TokenBalance[]
}) => {
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [copiedPrivateKey, setCopiedPrivateKey] = useState(false)
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [tradingWalletWithKey, setTradingWalletWithKey] = useState<{ address: string; privateKey?: string; chain: string } | null>(tradingWallet)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [hasAttemptedFetch, setHasAttemptedFetch] = useState(false) // Track if we've already tried fetching
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false)
  const [isWalletConnectionModalOpen, setIsWalletConnectionModalOpen] = useState(false)
  
  // Check if we're in Farcaster mini-app or web version
  const { isBaseContext, sdk: baseSdk } = useBaseMiniApp()

  // Update local wallet state when props change (but don't fetch)
  useEffect(() => {
    if (tradingWallet && !tradingWalletWithKey) {
      setTradingWalletWithKey(tradingWallet)
    }
  }, [tradingWallet, tradingWalletWithKey])
  
  // Fetch trading wallet with private key ONLY ONCE on mount or when explicitly needed
  useEffect(() => {
    // Don't fetch if:
    // 1. We already have wallet info with private key
    // 2. We don't have a token
    // 3. We've already attempted to fetch (prevents infinite loops when no wallet exists)
    if ((tradingWalletWithKey?.privateKey) || !authToken || hasAttemptedFetch) return
    
    // Only fetch once
    let isMounted = true
    
    const fetchTradingWallet = async () => {
      setIsFetching(true)
      setFetchError(null)
      
      try {
        // Fetch wallet with private key for MetaMask connection
        const response = await fetch('/api/wallet/primary-with-key', {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        })
        
        if (!isMounted) return
        
        if (response.ok) {
          const data = await response.json()
          if (data.wallet && isMounted) {
            setTradingWalletWithKey({
              address: data.wallet.address,
              chain: data.wallet.chain || 'ethereum',
              privateKey: data.wallet.privateKey
            })
            setFetchError(null)
            setHasAttemptedFetch(true)
          } else if (isMounted) {
            // No wallet found - this is OK, user needs to deposit
            setFetchError(null) // Don't show error, it's expected
            setHasAttemptedFetch(true) // Mark as attempted to prevent refetch loop
          }
        } else if (response.status === 404) {
          // Wallet not found yet - this is OK during initial creation
          if (isMounted) {
            setFetchError(null)
            setHasAttemptedFetch(true)
          }
        } else {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
          if (isMounted) {
            setFetchError(`Failed to fetch wallet: ${errorData.error || 'Unknown error'}`)
            setHasAttemptedFetch(true)
          }
        }
      } catch (error) {
        if (isMounted) {
          setFetchError(error instanceof Error ? error.message : 'Failed to fetch trading wallet')
          setHasAttemptedFetch(true)
        }
      } finally {
        if (isMounted) {
          setIsFetching(false)
        }
      }
    }

    fetchTradingWallet()
    
    return () => {
      isMounted = false
    }
  }, [authToken, tradingWalletWithKey?.privateKey, hasAttemptedFetch]) // Depend on privateKey to refetch if missing

  const walletToDisplay = tradingWalletWithKey || tradingWallet

  const copyWalletAddress = useCallback(async () => {
    if (walletToDisplay?.address) {
      try {
        await navigator.clipboard.writeText(walletToDisplay.address)
        setCopiedAddress(true)
        setTimeout(() => setCopiedAddress(false), 2000)
      } catch (err) {
        // Failed to copy address
      }
    }
  }, [walletToDisplay?.address])

  const copyPrivateKey = useCallback(async () => {
    if (walletToDisplay?.privateKey) {
      try {
        await navigator.clipboard.writeText(walletToDisplay.privateKey)
        setCopiedPrivateKey(true)
        setTimeout(() => setCopiedPrivateKey(false), 2000)
      } catch (err) {
        // Failed to copy private key
      }
    }
  }, [walletToDisplay?.privateKey])

  if (!walletToDisplay) {
    return (
      <Card className="bg-[#1a1a1a] border-[#262626] p-4 sm:p-6 rounded-2xl">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-semibold text-lg">Your Trading Wallet</h3>
          </div>
          
          {/* Only show loading during the INITIAL fetch, not repeatedly */}
          {isFetching && !hasAttemptedFetch ? (
            <div className="p-3 bg-blue-900/20 border border-blue-500/50 rounded">
              <p className="text-blue-400 text-sm font-semibold mb-1">Loading trading wallet...</p>
              <p className="text-blue-300 text-xs">Checking for existing wallet...</p>
            </div>
          ) : tradingWalletAddress ? (
            <div className="p-3 bg-yellow-900/20 border border-yellow-500/50 rounded">
              <p className="text-yellow-400 text-xs font-semibold mb-1">Trading Wallet Address Found</p>
              <p className="text-yellow-300 text-xs break-all font-mono">{tradingWalletAddress}</p>
              <p className="text-yellow-300 text-xs mt-1">Balance: ${avantisBalance.toFixed(2)}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[#9ca3af] text-sm">💡 No trading wallet yet. Make your first deposit to create one automatically.</p>
              {fetchError && (
                <div className="p-3 bg-red-900/20 border border-red-500/50 rounded">
                  <p className="text-red-400 text-xs font-semibold mb-1">Error:</p>
                  <p className="text-red-300 text-xs">{fetchError}</p>
                </div>
              )}
            </div>
          )}
          
          {/* Debug Info - Always visible */}
          <div className="mt-3 p-2 bg-[#1f2937] border border-[#374151] rounded text-xs">
            <p className="text-[#9ca3af] font-semibold mb-1">Status:</p>
            <div className="space-y-1 text-[#6b7280]">
              <div className="flex justify-between">
                <span>Wallet Address:</span>
                <span className="text-[#9ca3af] font-mono text-[10px]">
                  {tradingWalletAddress ? `${tradingWalletAddress.slice(0, 8)}...${tradingWalletAddress.slice(-6)}` : 'Not found'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Trading Balance:</span>
                <span className={avantisBalance > 0 ? 'text-green-400' : 'text-yellow-400'}>
                  ${avantisBalance.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Loading State:</span>
                <span className={isLoading || isFetching ? 'text-yellow-400' : 'text-green-400'}>
                  {isLoading || isFetching ? 'Loading...' : 'Ready'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="bg-[#1a1a1a] border-[#262626] p-4 sm:p-6 rounded-2xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold text-lg">
            Your Trading Wallet
          </h3>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${avantisBalance > 0 ? 'bg-green-400' : 'bg-yellow-400'}`}></div>
            <span className={`text-sm font-medium ${avantisBalance > 0 ? 'text-green-400' : 'text-yellow-400'}`}>
              {avantisBalance > 0 ? 'Ready' : 'Add Funds'}
            </span>
          </div>
        </div>
        
        {/* Show visible status messages */}
        {fetchError && (
          <div className="p-3 bg-red-900/20 border border-red-500/50 rounded">
            <p className="text-red-400 text-xs font-semibold mb-1">❌ Error:</p>
            <p className="text-red-300 text-xs">{fetchError}</p>
          </div>
        )}
        
        {/* Only show loading if actively fetching (not just isLoading from parent) */}
        {isFetching ? (
          <div className="p-3 bg-blue-900/20 border border-blue-500/50 rounded">
            <p className="text-blue-400 text-xs font-semibold mb-1">Refreshing wallet data...</p>
            <p className="text-blue-300 text-xs">Please wait while we fetch the latest balance</p>
          </div>
        ) : null}
        
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[#9ca3af] text-sm">Wallet Address:</span>
            <div className="flex items-center space-x-2">
              <code className="text-white text-sm font-mono bg-[#374151] px-2 py-1 rounded">
                {walletToDisplay.address?.slice(0, 6)}...{walletToDisplay.address?.slice(-4)}
              </code>
              <button
                onClick={copyWalletAddress}
                className={`text-sm transition-all duration-200 flex items-center space-x-1 ${
                  copiedAddress 
                    ? 'text-green-400 hover:text-green-300' 
                    : 'text-[#7c3aed] hover:text-[#6d28d9]'
                }`}
              >
                {copiedAddress ? (
                  <>
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                      <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                    </svg>
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Full Address - Commented out as copy functionality exists above */}
          {/* <div className="flex items-center justify-between">
            <span className="text-[#9ca3af] text-sm">Full Address:</span>
            <code className="text-white text-xs font-mono bg-[#374151] px-2 py-1 rounded break-all">
              {walletToDisplay.address}
            </code>
          </div> */} 
          
          <div className="flex items-center justify-between">
            <span className="text-[#9ca3af] text-sm">Chain:</span>
            <span className="text-white text-sm capitalize">{walletToDisplay.chain || 'ethereum'}</span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-[#9ca3af] text-sm">Trading Balance:</span>
            <span className="text-white text-sm font-medium">${avantisBalance.toFixed(2)}</span>
          </div>

          {walletToDisplay.privateKey && (
            <div className="space-y-2 pt-2 border-t border-[#374151]">
              <div className="flex items-center justify-between">
                <span className="text-[#9ca3af] text-sm">Private Key:</span>
                <button
                  onClick={() => setShowPrivateKey(!showPrivateKey)}
                  className="text-[#7c3aed] hover:text-[#6d28d9] text-sm"
                >
                  {showPrivateKey ? 'Hide' : 'Show'} PK
                </button>
              </div>
              {showPrivateKey && (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <code className="text-white text-xs font-mono bg-[#374151] px-2 py-1 rounded break-all flex-1">
                      {walletToDisplay.privateKey}
                    </code>
                    <button
                      onClick={copyPrivateKey}
                      className={`text-sm transition-all duration-200 flex items-center space-x-1 px-2 py-1 rounded ${
                        copiedPrivateKey 
                          ? 'text-green-400 bg-green-900/20' 
                          : 'text-[#7c3aed] hover:bg-[#7c3aed]/20'
                      }`}
                    >
                      {copiedPrivateKey ? (
                        <>
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                            <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                          </svg>
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        
        <div className="pt-2 border-t border-[#374151]">
          <div className="space-y-3">
            <p className="text-[#9ca3af] text-xs">
              {avantisBalance > 0
                ? `Your backend trading wallet is ready with a balance of $${avantisBalance.toFixed(2)}. This wallet is used for automated trading.`
                : 'Your backend trading wallet is ready but has no funds. Add funds to start trading.'
              }
            </p>
            
            {/* {walletToDisplay.privateKey && (
              <div className="mt-2 p-2 bg-blue-900/20 border border-blue-500/50 rounded">
                <p className="text-blue-400 text-xs font-semibold mb-1">🔑 MetaMask Connection</p>
                <p className="text-blue-300 text-xs">
                  You can copy your private key above and import it into MetaMask to connect this wallet externally.
                </p>
              </div>
            )} */}
            
            {/* Debug Info Section */}
            <div className="mt-3 p-2 bg-[#1f2937] border border-[#374151] rounded text-xs">
              <p className="text-[#9ca3af] font-semibold mb-1">Trading Vault Status:</p>
              <div className="space-y-1 text-[#6b7280]">
                <div className="flex justify-between">
                  <span>Wallet Address:</span>
                  <span className="text-[#9ca3af] font-mono text-[10px]">
                    {walletToDisplay.address ? `${walletToDisplay.address.slice(0, 8)}...${walletToDisplay.address.slice(-6)}` : 'Not found'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Trading Balance:</span>
                  <span className={avantisBalance > 0 ? 'text-green-400' : 'text-yellow-400'}>
                    ${avantisBalance.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Private Key:</span>
                  <span className={walletToDisplay.privateKey ? 'text-green-400' : 'text-yellow-400'}>
                    {walletToDisplay.privateKey ? 'Available' : 'Fetching...'}
                  </span>
                </div>
                {tradingWalletAddress && tradingWalletAddress !== walletToDisplay.address && (
                  <div className="flex justify-between">
                    <span>Vault Address:</span>
                    <span className="text-[#9ca3af] font-mono text-[10px]">
                      {tradingWalletAddress.slice(0, 8)}...{tradingWalletAddress.slice(-6)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Deposit Button - Only show if wallet exists */}
            {walletToDisplay.address && (
              <Button
                onClick={() => {
                  // In web version, show wallet connection modal
                  // In Farcaster mini-app, show deposit modal
                  if (isBaseContext) {
                    setIsDepositModalOpen(true)
                  } else {
                    setIsWalletConnectionModalOpen(true)
                  }
                }}
                className="w-full bg-[#8759ff] hover:bg-[#7c4dff] text-white font-medium py-2.5 rounded-xl shadow-md hover:shadow-lg transition-all duration-200"
              >
                <span className="flex items-center justify-center space-x-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Deposit Funds</span>
                </span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Deposit Modal - Only show in Farcaster mini-app */}
      {isBaseContext && (
        <DepositModal
          isOpen={isDepositModalOpen}
          onClose={() => setIsDepositModalOpen(false)}
          onDeposit={onDeposit}
          isDepositing={isDepositing}
          depositError={depositError}
          recentDepositHash={recentDepositHash}
          baseAccountAddress={baseAccountAddress || null}
          tradingWalletAddress={tradingWalletAddress || null}
          holdings={holdings}
          ethBalance={ethBalanceFormatted}
        />
      )}
      
      {/* Wallet Connection Modal - Only show in web version */}
      {!isBaseContext && (
        <WalletConnectionModal
          isOpen={isWalletConnectionModalOpen}
          onClose={() => setIsWalletConnectionModalOpen(false)}
        />
      )}
    </Card>
  )
}

// Trade History Tab Component - Shows actual closed trades from Avantis
const TradeHistoryTab = ({ 
  tradingSession, 
  positionData,
  getTradingSessions,
  token: authToken
}: {
  tradingSession: any
  positionData: any
  getTradingSessions: () => Promise<any[]>
  token: string | null
}) => {
  const [tradeHistory, setTradeHistory] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalTrades, setTotalTrades] = useState(0)
  const tradesPerPage = 4
  
  // Define loadTradeHistory using useCallback so it can be shared across useEffects
  const loadTradeHistory = useCallback(async () => {
    if (!authToken) {
      console.log('[TradeHistory] No auth token, skipping load')
      return
    }
    
    setIsLoading(true)
    setError(null)
    try {
      console.log('[TradeHistory] Fetching trade history...')
      // Fetch actual trade history from Avantis (closed trades)
      const response = await fetch('/api/trade-history', {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      })
      
      if (response.ok) {
        const data = await response.json()
        console.log('[TradeHistory] Received data:', { count: data.count, tradesLength: data.trades?.length || 0, error: data.error })
        const allTrades = data.trades || []
        setTotalTrades(allTrades.length)
        setTotalPages(Math.ceil(allTrades.length / tradesPerPage))
        
        // Paginate trades
        const startIndex = (currentPage - 1) * tradesPerPage
        const endIndex = startIndex + tradesPerPage
        setTradeHistory(allTrades.slice(startIndex, endIndex))
        
        if (data.error) {
          console.warn('[TradeHistory] API returned error:', data.error)
          setError(data.error)
        }
      } else {
        const errorText = await response.text().catch(() => 'Unknown error')
        console.error('[TradeHistory] API error:', response.status, errorText)
        setError(`Failed to load trade history: ${errorText}`)
        setTradeHistory([])
      }
    } catch (err) {
      console.error('[TradeHistory] Fetch error:', err)
      setError(`Failed to load trade history: ${err instanceof Error ? err.message : 'Unknown error'}`)
      setTradeHistory([])
    } finally {
      setIsLoading(false)
    }
  }, [authToken, currentPage, tradesPerPage])
  
  useEffect(() => {
    loadTradeHistory()
  }, [loadTradeHistory])
  
  useEffect(() => {
    // Listen for position closed events to reload trade history
    const handlePositionClosed = () => {
      console.log('[TradeHistory] Position closed event received, reloading...')
      // Wait longer for blockchain to confirm and Avantis service to index
      setTimeout(() => {
        console.log('[TradeHistory] Reloading after position close...')
        loadTradeHistory()
      }, 5000) // Increased to 5 seconds for blockchain confirmation
      
      // Also reload after 30 seconds in case indexing takes longer
      setTimeout(() => {
        console.log('[TradeHistory] Secondary reload after position close...')
        loadTradeHistory()
      }, 30000)
    }
    window.addEventListener('position-closed', handlePositionClosed)
    
    // Refresh every 120 seconds (reduced frequency to reduce server load)
    const interval = setInterval(() => {
      console.log('[TradeHistory] Auto-refreshing trade history...')
      loadTradeHistory()
    }, 120000) // 2 minutes instead of 1 minute
    
    return () => {
      clearInterval(interval)
      window.removeEventListener('position-closed', handlePositionClosed)
    }
  }, [loadTradeHistory])
  
  const formatDate = (timestamp: number | string | undefined) => {
    if (!timestamp) return 'N/A'
    try {
      const d = typeof timestamp === 'number' 
        ? new Date(timestamp * 1000)  // Unix timestamp 
        : new Date(timestamp)
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return 'N/A'
    }
  }
  
  const formatPrice = (price: number | undefined) => {
    if (!price) return '$0.00'
    return price >= 1000 
      ? `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `$${price.toFixed(4)}`
  }
  
  if (isLoading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="text-center text-[#9ca3af] text-sm">Loading trade history...</div>
      </div>
    )
  }
  
  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-[#2a2a2a] border border-[#ef4444]/30 rounded-lg p-4">
          <div className="text-center text-[#ef4444] text-sm mb-2">{error}</div>
          <div className="text-center text-[#9ca3af] text-xs mb-3">
            {error.includes('Cannot connect') || error.includes('timeout') 
              ? 'Please ensure the Avantis service is running on port 8000.'
              : 'This may be normal if you haven\'t closed any trades yet, or the service may need time to index closed positions.'}
          </div>
          <div className="text-center">
            <button
              onClick={() => {
                loadTradeHistory()
              }}
              className="px-4 py-2 bg-[#8759ff] hover:bg-[#7c4dff] text-white text-xs rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="p-4 sm:p-6">
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold text-lg">Trade History</h3>
            <button
              onClick={() => {
                loadTradeHistory()
              }}
              disabled={isLoading}
              className="px-3 py-1.5 bg-[#262626] hover:bg-[#2a2a2a] text-[#9ca3af] hover:text-white text-xs rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          
          
          {tradeHistory.length > 0 ? (
            <div className="space-y-3">
              {tradeHistory.map((trade, index) => {
                const pnl = trade.pnl || 0
                const pnlPercentage = trade.pnl_percentage || 0
                const isProfitable = pnl >= 0
                
                return (
                  <div key={trade.id || trade.tx_hash || index} className="bg-[#2a2a2a] border border-[#374151] rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-white font-semibold">{trade.symbol}USD</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${trade.is_long ? 'bg-[#27c47d]/20 text-[#27c47d]' : 'bg-[#ef4444]/20 text-[#ef4444]'}`}>
                          {trade.side || (trade.is_long ? 'Long' : 'Short')} {trade.leverage}x
                        </span>
                      </div>
                      <span className="text-[#9ca3af] text-xs">{trade.date || formatDate(trade.timestamp)}</span>
                    </div>
                    
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-[#9ca3af] text-xs block">Collateral</span>
                        <span className="text-white">{trade.collateral?.toFixed(2) || '0.00'} USDC</span>
                      </div>
                      <div>
                        <span className="text-[#9ca3af] text-xs block">Open Price</span>
                        <span className="text-white">{formatPrice(trade.open_price)}</span>
                      </div>
                      <div>
                        <span className="text-[#9ca3af] text-xs block">Close Price</span>
                        <span className="text-white">{formatPrice(trade.close_price)}</span>
                      </div>
                      <div>
                        <span className="text-[#9ca3af] text-xs block">PnL</span>
                        <span className={isProfitable ? 'text-[#27c47d]' : 'text-[#ef4444]'}>
                          {isProfitable ? '+' : ''}{pnl.toFixed(2)} USDC ({pnlPercentage.toFixed(2)}%)
                        </span>
                      </div>
                    </div>
                    
                    {trade.tx_hash && (
                      <div className="mt-2 pt-2 border-t border-[#374151]">
                        <a 
                          href={`https://basescan.org/tx/${trade.tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#8759ff] text-xs hover:underline"
                        >
                          View on Basescan →
                        </a>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="bg-[#2a2a2a] border border-[#374151] rounded-lg p-8 text-center">
              <p className="text-[#9ca3af] text-sm">No trade history available</p>
              <p className="text-[#666] text-xs mt-2">Your completed trades will appear here</p>
            </div>
          )}
          
          {/* Pagination Controls */}
          {totalTrades > tradesPerPage && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#374151]">
              <div className="text-[#9ca3af] text-sm">
                Showing {((currentPage - 1) * tradesPerPage) + 1} to {Math.min(currentPage * tradesPerPage, totalTrades)} of {totalTrades} trades
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1 || isLoading}
                  className="px-3 py-1.5 bg-[#262626] hover:bg-[#2a2a2a] text-[#9ca3af] hover:text-white text-xs rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-[#9ca3af] text-sm">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages || isLoading}
                  className="px-3 py-1.5 bg-[#262626] hover:bg-[#2a2a2a] text-[#9ca3af] hover:text-white text-xs rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
          
        </div>
      </div>
    </div>
  )
}

// Keep the old session-based component for reference (renamed)
const TradingSessionsTab = ({ 
  tradingSession, 
  positionData,
  getTradingSessions,
  token: authToken
}: {
  tradingSession: any
  positionData: any
  getTradingSessions: () => Promise<any[]>
  token: string | null
}) => {
  const [allSessions, setAllSessions] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  
  useEffect(() => {
    const loadSessions = async () => {
      if (!authToken) return
      
      setIsLoading(true)
      try {
        const sessions = await getTradingSessions()
        setAllSessions(sessions || [])
      } catch (err) {
        console.error('Failed to load sessions:', err)
      } finally {
        setIsLoading(false)
      }
    }
    
    loadSessions()
    // Refresh every 60 seconds (reduced from 10)
    const interval = setInterval(loadSessions, 60000)
    return () => clearInterval(interval)
  }, [authToken, getTradingSessions])
  
  // Combine current running session with all sessions
  const sessionsToShow = useMemo(() => {
    const sessions = [...allSessions]
    
    // If there's a running session not in the list, add it
    if (tradingSession && tradingSession.status === 'running') {
      const exists = sessions.find(s => s.id === tradingSession.id || s.sessionId === tradingSession.sessionId)
      if (!exists) {
        sessions.unshift({
          id: tradingSession.id || tradingSession.sessionId,
          sessionId: tradingSession.sessionId || tradingSession.id,
          status: tradingSession.status,
          startTime: tradingSession.startTime,
          totalPnL: positionData?.totalPnL || tradingSession.totalPnL || 0,
          openPositions: positionData?.openPositions || tradingSession.openPositions || 0,
          config: tradingSession.config
        })
      }
    }
    
    // Sort by start time (newest first)
    return sessions.sort((a, b) => {
      const timeA = a.startTime ? new Date(a.startTime).getTime() : 0
      const timeB = b.startTime ? new Date(b.startTime).getTime() : 0
      return timeB - timeA
    })
  }, [allSessions, tradingSession, positionData])
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'text-[#27c47d]'
      case 'completed':
        return 'text-[#8759ff]'
      case 'stopped':
        return 'text-[#9ca3af]'
      case 'error':
        return 'text-[#ef4444]'
      default:
        return 'text-[#9ca3af]'
    }
  }
  
  const formatDate = (date: Date | string | undefined) => {
    if (!date) return 'N/A'
    try {
      const d = typeof date === 'string' ? new Date(date) : date
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return 'N/A'
    }
  }
  
  if (isLoading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="text-center text-[#9ca3af] text-sm">Loading sessions...</div>
      </div>
    )
  }
  
  return (
    <div className="p-4 sm:p-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-white font-semibold text-lg mb-4">Bot Sessions</h3>
          {sessionsToShow.length > 0 ? (
            <div className="space-y-3">
              {sessionsToShow.map((session) => {
                const sessionPnL = session.totalPnL || 0
                const sessionOpenPositions = session.openPositions || session.positions || 0
                const isCurrentSession = tradingSession && (session.id === tradingSession.id || session.sessionId === tradingSession.sessionId)
                const displayPnL = isCurrentSession ? (positionData?.totalPnL ?? sessionPnL) : sessionPnL
                const displayPositions = isCurrentSession ? (positionData?.openPositions ?? sessionOpenPositions) : sessionOpenPositions
                
                return (
                  <div key={session.id || session.sessionId} className="bg-[#2a2a2a] border border-[#374151] rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[#9ca3af] text-sm">Session ID</span>
                      <span className="text-white font-mono text-xs">
                        {session.sessionId?.slice(-8) || session.id?.slice(-8) || 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[#9ca3af] text-sm">Status</span>
                      <span className={`font-semibold ${getStatusColor(session.status)}`}>
                        {session.status === 'running' ? 'Running' : 
                         session.status === 'completed' ? 'Completed' :
                         session.status === 'stopped' ? 'Stopped' :
                         session.status === 'error' ? 'Error' : session.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[#9ca3af] text-sm">Started</span>
                      <span className="text-white text-xs">
                        {formatDate(session.startTime)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[#9ca3af] text-sm">Total PnL</span>
                      <span className={`font-semibold ${displayPnL >= 0 ? 'text-[#27c47d]' : 'text-[#ef4444]'}`}>
                        ${displayPnL.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#9ca3af] text-sm">Open Positions</span>
                      <span className="text-white font-semibold">
                        {displayPositions}
                      </span>
                    </div>
                    {session.config?.profitGoal && (
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#374151]">
                        <span className="text-[#9ca3af] text-sm">Target Profit</span>
                        <span className="text-white text-xs">
                          ${session.config.profitGoal.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="bg-[#2a2a2a] border border-[#374151] rounded-lg p-8 text-center">
              <p className="text-[#9ca3af] text-sm">No trade history available</p>
              <p className="text-[#666] text-xs mt-2">Your completed trades will appear here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const HoldingsSection = ({ holdings }: { holdings: Array<{
  token: { symbol: string; name: string; address: string; decimals: number; price: number };
  balance: string;
  valueUSD: number;
  color: string;
  link: string;
}> }) => {
  const formatValue = useCallback((value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value)
  }, [])

  if (holdings.length === 0) return null

  return (
    <div className="space-y-4 sm:space-y-6 mt-6 sm:mt-8">
      <div className="flex items-center justify-between px-1 sm:px-2">
        <h3 className="text-lg sm:text-xl font-bold text-white">Your Holdings</h3>
      </div>

      <div className="space-y-5 sm:space-y-6 pb-6 sm:pb-8 px-0 sm:px-1">
        {holdings.map((holding, index) => (
          <Link key={index} href={holding.link}>
            <Card className="bg-[#1a1a1a] border-[#262626] p-4 sm:p-6 rounded-2xl hover:bg-[#1f1f1f] transition-colors cursor-pointer">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 sm:space-x-4">
                  <div 
                    className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-white font-bold text-sm sm:text-base"
                    style={{ backgroundColor: holding.color }}
                  >
                    {holding.token.symbol.charAt(0)}
                  </div>
                  <div>
                    <h4 className="text-white font-semibold text-base sm:text-lg">{holding.token.symbol}</h4>
                    <p className="text-[#9ca3af] text-sm">{holding.token.name}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-white font-semibold text-base sm:text-lg">{holding.balance}</p>
                  <p className="text-[#9ca3af] text-sm">{formatValue(holding.valueUSD)}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}

export default function HomePage() {
  const { user, token: authToken } = useAuth()
  const [isBalanceVisible, setIsBalanceVisible] = useState(true)
  const [targetProfit, setTargetProfit] = useState("") // Internal: calculated from percent for trading
  const [targetProfitPercent, setTargetProfitPercent] = useState("")
  const [investmentAmount, setInvestmentAmount] = useState("")
  const [isDepositing, setIsDepositing] = useState(false)
  const [depositError, setDepositError] = useState<string | null>(null)
  const [recentDepositHash, setRecentDepositHash] = useState<string | null>(null)
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false)
  const hasRefreshedForTxRef = useRef<Set<string>>(new Set()) // Track which tx hashes we've already refreshed for
  
  // Tab state for Positions/Balances/Trade History
  const [activeTab, setActiveTab] = useState<'positions' | 'balances' | 'tradeHistory'>('positions')
  
  // Withdraw modal state
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false)
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const [recentWithdrawHash, setRecentWithdrawHash] = useState<string | null>(null)
  
  // Session start modal state
  const [isSessionStartModalOpen, setIsSessionStartModalOpen] = useState(false)
  const [newSessionData, setNewSessionData] = useState<{ sessionId: string; investmentAmount: number; profitGoal: number } | null>(null)
  
  const { addToast } = useToast()

  // Optimized hook usage - only essential hooks
  const {
    primaryWallet,
    tradingWallet,
    baseAccountAddress,
    tradingWalletAddress,
    allWallets,
    totalPortfolioValue,
    ethBalanceFormatted,
    holdings,
    tradingHoldings, // Trading wallet holdings only (for Holdings section)
    baseHoldings, // Farcaster/Base wallet holdings only (for Deposit Modal)
    dailyChange,
    dailyChangePercentage,
    isLoading,
    isConnected,
    avantisBalance,
    error,
    createWallet,
    refreshBalances,
    refreshWallets,
    hasCompletedInitialLoad
  } = useIntegratedWallet()

  const { isLoading: isTradingLoading, error: tradingError, getTradingSessions } = useTrading()
  const { totalProfits } = useTradingProfits()
  const { tradingSession, refreshSessionStatus, startTrading: startTradingSession } = useTradingSession()
  const router = useRouter()
  
  // Modal state for viewing positions
  const [isPositionsModalOpen, setIsPositionsModalOpen] = useState(false)
  
  // Note: activeSessions state removed - we now use FloatingLiveCard instead

  const { signAndSendTransaction, waitForTransaction, isAvailable: isBaseTxAvailable, estimateGas } = useBaseAccountTransactions()
  const { sdk: baseSdk } = useBaseMiniApp()
  
  // Refresh session status when component mounts or when positions change
  const { positionData, isLoading: positionsLoading, hasStaleData, closePosition, fetchPositions } = usePositions()
  
  // 🛑 STABILIZE: Use refs to avoid function dependency
  const fetchPositionsRef = useRef(fetchPositions);
  const refreshBalancesRef = useRef(refreshBalances);
  useEffect(() => {
    fetchPositionsRef.current = fetchPositions;
    refreshBalancesRef.current = refreshBalances;
  }, [fetchPositions, refreshBalances]);
  
  // Listen for position closed events to refresh balance
  useEffect(() => {
    const handlePositionClosed = () => {
      // Refresh balance and positions after close
      refreshBalancesRef.current?.()
      fetchPositionsRef.current?.(true)
    }
    
    window.addEventListener('position-closed', handlePositionClosed)
    return () => window.removeEventListener('position-closed', handlePositionClosed)
  }, []) // Empty deps - handler uses refs
  
  // Handle viewing trades - show positions in modal
  const handleViewTrades = useCallback(async () => {
    if (positionData && positionData.openPositions > 0) {
      setIsPositionsModalOpen(true)
    } else {
      addToast({
        type: 'info',
        title: 'No Active Positions',
        message: 'You don\'t have any open positions at the moment.'
      })
    }
  }, [positionData, addToast]);
  
  // 🛑 STABILIZE: Extract primitive values from tradingSession
  const tradingSessionStatusRef = useRef<string | null>(null);
  const refreshSessionStatusRef = useRef(refreshSessionStatus);
  
  useEffect(() => {
    tradingSessionStatusRef.current = tradingSession?.status || null;
    refreshSessionStatusRef.current = refreshSessionStatus;
  }, [tradingSession?.status, refreshSessionStatus]);
  
  useEffect(() => {
    if (!isConnected) return
    
    const sessionStatus = tradingSessionStatusRef.current;
    
    // Initial refresh
    if (sessionStatus === 'running') {
      refreshSessionStatusRef.current?.(false);
      // Also refresh positions when session is running
      fetchPositionsRef.current?.(true);
    }
    
    // Set up polling interval (reduced frequency to reduce server load)
    const interval = setInterval(() => {
      const currentStatus = tradingSessionStatusRef.current;
      if (currentStatus === 'running') {
        refreshSessionStatusRef.current?.(false); // Just refresh existing session
        // Also refresh positions when session is active
        // Reduced frequency to 30 seconds to reduce server load
        fetchPositionsRef.current?.();
      }
    }, 30000); // Refresh every 30 seconds (was 10 seconds)
    
    // Cleanup: Clear interval on unmount or dependency change
    return () => {
      clearInterval(interval);
    };
  }, [isConnected]); // Only depend on isConnected (primitive)
  
  // 🛑 STABILIZE: Extract primitive values
  const openPositionsCountRef = useRef(0);
  const tradingSessionStatusRef2 = useRef<string | null>(null);
  const refreshSessionStatusRef2 = useRef(refreshSessionStatus);
  
  useEffect(() => {
    openPositionsCountRef.current = positionData?.openPositions || 0;
    tradingSessionStatusRef2.current = tradingSession?.status || null;
    refreshSessionStatusRef2.current = refreshSessionStatus;
  }, [positionData?.openPositions, tradingSession?.status, refreshSessionStatus]);
  
  useEffect(() => {
    if (!isConnected) return
    
    let timeoutId: NodeJS.Timeout | null = null
    
    const openPositions = openPositionsCountRef.current;
    const sessionStatus = tradingSessionStatusRef2.current;
    
    if (openPositions > 0 && !sessionStatus && avantisBalance > 0) {
      // Restore session if positions exist but no session
      timeoutId = setTimeout(() => {
        refreshSessionStatusRef2.current?.(true).catch(err => {
          // Silent error handling
        });
      }, 1000); // Small delay to avoid race conditions
    } else if (openPositions === 0 && sessionStatus && sessionStatus !== 'running') {
      // Clean up session if no positions and session not running
    }
    
    // Cleanup: Clear timeout on unmount or dependency change
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isConnected, avantisBalance]); // Only primitives
  
  // Transaction status polling with timeout
  const pollTransactionStatus = useCallback((
    txHash: string,
    timeout: number = 60000, // 60 seconds default
    onConfirmed?: () => void,
    onTimeout?: () => void
  ) => {
    const startTime = Date.now()
    const pollInterval = 3000 // Poll every 3 seconds
    let pollTimer: NodeJS.Timeout | null = null
    let isCleanedUp = false
    
    const poll = async () => {
      if (isCleanedUp) return false
      
      try {
        const explorerBaseUrl = process.env.NEXT_PUBLIC_AVANTIS_NETWORK === 'base-mainnet'
          ? 'https://basescan.org'
          : 'https://sepolia.basescan.org'
        
        const response = await fetch(`${explorerBaseUrl}/api?module=transaction&action=gettxreceiptstatus&txhash=${txHash}`)
        const data = await response.json()
        
        if (data.status === '1' && data.result?.status === '1') {
          // Transaction confirmed
          if (pollTimer) clearInterval(pollTimer)
          pollTimer = null
          onConfirmed?.()
          return true
        }
        
        // Check timeout
        if (Date.now() - startTime > timeout) {
          if (pollTimer) clearInterval(pollTimer)
          pollTimer = null
          onTimeout?.()
          return false
        }
        
        return false
      } catch (error) {
        // Continue polling on error
        return false
      }
    }
    
    // Start polling
    pollTimer = setInterval(async () => {
      const confirmed = await poll()
      if (confirmed && pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }, pollInterval)
    
    // Initial poll (non-blocking)
    poll().catch(() => {
      // Ignore initial poll errors
    })
    
    // Return cleanup function
    return () => {
      isCleanedUp = true
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }
  }, [])
  
  // Handle closing a position with optimistic update
  const handleClosePosition = useCallback(async (position: Position) => {
    // Use pair_index as position identifier (required by Avantis)
    const positionId = position.pair_index;
    
    // Validate pair_index is available
    if (!positionId && positionId !== 0) {
      console.error('[HomePage] Cannot close position: pair_index is missing', position);
      addToast({
        type: 'error',
        title: 'Close Failed',
        message: `Cannot close ${position.coin} position: Missing pair index`
      });
      return;
    }
    
    // Optimistic update: Store previous state
    const previousPositions = positionData?.positions || []
    const previousOpenPositions = positionData?.openPositions || 0
    
    try {
      // Optimistic UI update
      addToast({
        type: 'info',
        title: 'Closing Position',
        message: `Closing ${position.coin} ${position.side.toUpperCase()}...`
      });
      
      console.log('[HomePage] Closing position with pair_index:', positionId);
      const success = await closePosition(positionId);
      
      if (success) {
        addToast({
          type: 'success',
          title: 'Position Closed',
          message: `Successfully closed ${position.coin} ${position.side.toUpperCase()}`
        });
        // Refresh positions after successful close
        await fetchPositions?.(true);
      } else {
        // Rollback: Position close failed
        addToast({
          type: 'error',
          title: 'Close Failed',
          message: `Failed to close ${position.coin}. Please try again.`
        });
      }
    } catch (error) {
      // Rollback on error
      addToast({
        type: 'error',
        title: 'Close Failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    }
  }, [closePosition, addToast, positionData, fetchPositions]);
  
  // Note: Removed activeSessions fetching - FloatingLiveCard handles session display now

  // Auto-create wallet if user doesn't have one - optimized with useCallback
  // NOTE: For web users, wallet is created during OTP verification, so this is mainly for Farcaster users
  useEffect(() => {
    // Only create wallet if:
    // 1. User is logged in (Farcaster only - web users get wallet during auth)
    // 2. Not currently loading
    // 3. No primary wallet is connected
    // 4. No wallets exist for this user
    // 5. Not already creating a wallet (prevent multiple simultaneous calls)
    // 6. User is Farcaster (web users already have wallet from OTP verification)
    // 7. For web users, if no wallet is loaded after 2 seconds, try refreshing (wallet should exist)
    if (user?.webUserId && !isLoading && !primaryWallet && allWallets && allWallets.length === 0) {
      // Web user - wallet should already exist, try refreshing after a delay
      const timer = setTimeout(() => {
        refreshWallets().catch(() => {
          // Wallet refresh error
        });
      }, 2000);
      return () => clearTimeout(timer);
    } else if (user?.fid && !user?.webUserId && !isLoading && !primaryWallet && allWallets && allWallets.length === 0 && !error) {
      // Farcaster user - create wallet if needed
      const timer = setTimeout(() => {
        createWallet('ethereum').catch(() => {
          // Wallet creation error
        })
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [user?.fid, user?.webUserId, isLoading, primaryWallet, allWallets, createWallet, refreshWallets, error])


  const handleDeposit = useCallback(
    async ({ amount, asset }: { amount: string; asset: 'USDC' | 'ETH' }) => {
      if (!authToken) {
        const message = 'Authentication required. Please reconnect your wallet.'
        setDepositError(message)
        throw new Error(message)
      }

      const fromAddress = primaryWallet?.address || baseAccountAddress
      if (!fromAddress) {
        const message = 'No Base wallet connected.'
        setDepositError(message)
        throw new Error(message)
      }

      if (!isBaseTxAvailable) {
        const message = 'Base mini app context unavailable. Open the app inside Farcaster/Base.'
        setDepositError(message)
        throw new Error(message)
      }

      // CRITICAL: Log deposit attempt to prevent automatic transfers
      console.log(`[DEPOSIT] User-initiated deposit: ${amount} ${asset} from ${fromAddress}`)
      console.log(`[DEPOSIT] This is a MANUAL deposit - no automatic transfers should occur`)

      // Optimistic update: Store previous balance
      const previousBalance = avantisBalance
      
      setIsDepositing(true)
      setDepositError(null)
      setRecentDepositHash(null)
      
      // Show loading toast
      addToast({
        type: 'info',
        title: 'Processing Deposit',
        message: `Depositing ${amount} ${asset}...`
      })

      try {
        const response = await fetch('/api/wallet/deposit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({
            asset,
            amount,
            baseAddress: fromAddress
          })
        })

        const data = await response.json()

        if (!response.ok) {
          const message = data.error || 'Failed to prepare deposit transaction'
          setDepositError(message)
          throw new Error(message)
        }

        // For ETH deposits, validate balance before sending
        if (asset === 'ETH') {
          try {
            // Try to get provider from SDK
            let provider: any = null
            if (baseSdk) {
              provider = await (baseSdk as any).wallet?.getEthereumProvider?.() || (baseSdk as any).provider
            }
            
            // If no SDK provider, try to get from window.ethereum (fallback)
            if (!provider && typeof window !== 'undefined' && (window as any).ethereum) {
              provider = (window as any).ethereum
            }
            
            if (provider) {
              const balanceHex = await provider.request({
                method: 'eth_getBalance',
                params: [fromAddress, 'latest']
              })
              const balance = BigInt(balanceHex)
              const depositAmount = BigInt(data.transaction.value)
              
              // Estimate gas for the transaction
              let gasEstimate = BigInt(21000) // Default for simple ETH transfer
              try {
                if (estimateGas) {
                  const estimatedGas = await estimateGas({
                    from: fromAddress,
                    to: data.transaction.to,
                    value: data.transaction.value,
                    data: data.transaction.data || '0x'
                  })
                  gasEstimate = BigInt(estimatedGas)
                }
              } catch (gasError) {
                // Use a more conservative estimate if gas estimation fails
                gasEstimate = BigInt(25000) // Slightly higher to be safe
              }
              
              // Get gas price
              let gasPrice = BigInt('0x3b9aca00') // ~1 gwei default
              try {
                const gasPriceHex = await provider.request({
                  method: 'eth_gasPrice',
                  params: []
                })
                gasPrice = BigInt(gasPriceHex)
              } catch (priceError) {
                // Use 2 gwei as a safer default for Base network
                gasPrice = BigInt('0x77359400') // ~2 gwei
              }
              
              const gasCost = gasEstimate * gasPrice
              const totalNeeded = depositAmount + gasCost
              
              if (balance < totalNeeded) {
                const balanceETH = Number(balance) / 1e18
                const neededETH = Number(totalNeeded) / 1e18
                const depositETH = Number(depositAmount) / 1e18
                const gasETH = Number(gasCost) / 1e18
                const maxAllowed = Math.max(0, balanceETH - gasETH)
                const message = `Insufficient balance for gas fees. You have ${balanceETH.toFixed(6)} ETH but need ${neededETH.toFixed(6)} ETH total (${depositETH.toFixed(6)} ETH deposit + ~${gasETH.toFixed(6)} ETH gas). Maximum you can deposit: ${maxAllowed.toFixed(6)} ETH. Use the MAX button to automatically set the correct amount.`
                setDepositError(message)
                throw new Error(message)
              }
            } else {
              // No provider available - show warning but continue (transaction will fail with better error)
            }
          } catch (balanceError) {
            // If balance check fails, re-throw our custom error
            if (balanceError instanceof Error && balanceError.message.includes('Insufficient balance')) {
              throw balanceError
            }
            // For other errors, continue - transaction will fail with wallet error
          }
        }

        const txRequest = {
          from: fromAddress,
          to: data.transaction.to,
          value: data.transaction.value,
          data: data.transaction.data,
          gas: data.transaction.gas
        }

        const txHash = await signAndSendTransaction(txRequest)
        setRecentDepositHash(txHash)
        
        // Start transaction status polling with timeout
        addToast({
          type: 'info',
          title: 'Transaction Submitted',
          message: `Waiting for confirmation...`
        })
        
        // Poll transaction status with timeout
        const cleanupPoll = pollTransactionStatus(
          txHash,
          60000, // 60 second timeout
          async () => {
            // Transaction confirmed
            addToast({
              type: 'success',
              title: 'Deposit Confirmed',
              message: `Successfully deposited ${amount} ${asset}`
            })
            
            // Ensure we only refresh once per transaction hash
            if (hasRefreshedForTxRef.current.has(txHash)) {
              return
            }
            
            // Mark this transaction as refreshed
            hasRefreshedForTxRef.current.add(txHash)
            
            // Auto-refresh balance after successful deposit confirmation
            setIsRefreshingBalance(true)
            try {
              await new Promise(resolve => setTimeout(resolve, 2000))
              await refreshBalances(true) // Force refresh
            } catch (refreshError) {
              // Don't throw - deposit was successful, just balance refresh failed
            } finally {
              setIsRefreshingBalance(false)
            }
          },
          () => {
            // Transaction timeout - still try to refresh
            addToast({
              type: 'warning',
              title: 'Confirmation Timeout',
              message: 'Transaction may still be processing. Balance will update when confirmed.'
            })
            
            if (hasRefreshedForTxRef.current.has(txHash)) {
              return
            }
            
            hasRefreshedForTxRef.current.add(txHash)
            
            // Try to refresh even on timeout
            setIsRefreshingBalance(true)
            setTimeout(async () => {
              try {
                await refreshBalances(true)
              } catch (refreshError) {
                // Balance refresh failed
              } finally {
                setIsRefreshingBalance(false)
              }
            }, 5000)
          }
        )
        
        // Also wait for transaction (fallback)
        try {
          await waitForTransaction(txHash, 2) // Wait up to 2 confirmations
        } catch (waitError) {
          // Polling will handle the status
        }
        
      } catch (error) {
        // Rollback optimistic update on error
        const message = error instanceof Error ? error.message : 'Deposit failed'
        setDepositError(message)
        setRecentDepositHash(null)
        
        addToast({
          type: 'error',
          title: 'Deposit Failed',
          message: message
        })
        
        throw error
      } finally {
        setIsDepositing(false)
      }
    },
    [
      authToken,
      primaryWallet?.address,
      baseAccountAddress,
      signAndSendTransaction,
      waitForTransaction,
      isBaseTxAvailable,
      refreshBalances,
      refreshWallets,
      estimateGas,
      baseSdk,
      pollTransactionStatus,
      addToast,
      avantisBalance,
      hasRefreshedForTxRef
    ]
  )

  // Handle withdraw from trading wallet with optimistic update and transaction polling
  const handleWithdraw = useCallback(
    async ({ amount, recipientAddress }: { amount: string; recipientAddress: string }) => {
      // Optimistic update: Store previous balance
      const previousBalance = avantisBalance
      
      setWithdrawError(null)
      setRecentWithdrawHash(null)
      setIsWithdrawing(true)
      
      // Show loading toast
      addToast({
        type: 'info',
        title: 'Processing Withdrawal',
        message: `Withdrawing $${amount} USDC...`
      })

      try {
        if (!authToken) {
          throw new Error('Authentication required')
        }

        // Call backend API to execute withdrawal
        const response = await fetch('/api/wallet/withdraw', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount,
            recipientAddress,
            asset: 'USDC'
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Withdrawal failed')
        }

        const txHash = data.txHash
        setRecentWithdrawHash(txHash)
        
        // Start transaction status polling with timeout
        addToast({
          type: 'info',
          title: 'Transaction Submitted',
          message: 'Waiting for confirmation...'
        })
        
        // Poll transaction status with timeout
        pollTransactionStatus(
          txHash,
          60000, // 60 second timeout
          async () => {
            // Transaction confirmed
            addToast({
              type: 'success',
              title: 'Withdrawal Confirmed',
              message: `Successfully withdrew $${amount} USDC`
            })
            
            // Refresh balance after successful withdrawal confirmation
            setIsRefreshingBalance(true)
            try {
              await new Promise(resolve => setTimeout(resolve, 2000))
              await refreshBalances(true)
            } catch (refreshError) {
              // Don't throw - withdrawal was successful
            } finally {
              setIsRefreshingBalance(false)
            }
          },
          () => {
            // Transaction timeout - still try to refresh
            addToast({
              type: 'warning',
              title: 'Confirmation Timeout',
              message: 'Transaction may still be processing. Balance will update when confirmed.'
            })
            
            // Try to refresh even on timeout
            setIsRefreshingBalance(true)
            setTimeout(async () => {
              try {
                await refreshBalances(true)
              } catch (refreshError) {
                // Balance refresh failed
              } finally {
                setIsRefreshingBalance(false)
              }
            }, 5000)
          }
        )
        
      } catch (error) {
        // Rollback optimistic update on error
        const message = error instanceof Error ? error.message : 'Withdrawal failed'
        setWithdrawError(message)
        setRecentWithdrawHash(null)
        
        addToast({
          title: 'Withdrawal Failed',
          message: message,
          type: 'error'
        })
        throw error
      } finally {
        setIsWithdrawing(false)
      }
    },
    [authToken, refreshBalances, addToast, pollTransactionStatus, avantisBalance]
  )

  // Memoized holdings calculation - use tradingHoldings for Holdings section
  // This ensures Holdings section shows trading wallet balance (matches main balance)
  const realHoldings = useMemo(() => {
    if (!isConnected) return []

    // Use tradingHoldings (trading wallet only) instead of merged holdings
    // This ensures Holdings section matches the main trading balance
    // CRITICAL: For Farcaster users, always use tradingHoldings (even if empty)
    // Don't fall back to merged holdings (which includes Farcaster wallet)
    const holdingsToUse = tradingHoldings || []

    const nativeSymbol = holdingsToUse.find(holding => holding.token.isNative)?.token.symbol || 'ETH'
    const nativeHolding = holdingsToUse.find(
      holding => holding.token.symbol.toUpperCase() === nativeSymbol.toUpperCase()
    )

    const otherHoldings = holdingsToUse.filter(
      holding => holding.token.symbol.toUpperCase() !== nativeSymbol.toUpperCase()
    )

    const formattedHoldings = []

    if (nativeHolding) {
      formattedHoldings.push({
        token: {
          symbol: nativeHolding.token.symbol,
          name: nativeHolding.token.name,
          address: nativeHolding.token.address,
          decimals: nativeHolding.token.decimals,
          price: nativeHolding.token.price || 0
        },
        balance: nativeHolding.balanceFormatted,
        valueUSD: nativeHolding.valueUSD,
        color: '#627eea',
        link: `/detail/${nativeHolding.token.symbol.toLowerCase()}`,
      })
    }

    formattedHoldings.push(
      ...otherHoldings.map(holding => ({
        token: {
          ...holding.token,
          price: holding.token.price || 0
        },
        balance: holding.balanceFormatted,
        valueUSD: holding.valueUSD,
        color: holding.token.symbol === 'WBTC' ? '#f7931a' : '#f4b731',
        link: `/detail/${holding.token.symbol.toLowerCase()}`,
      }))
    )

    return formattedHoldings
  }, [isConnected, tradingHoldings, holdings])

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-[#0d0d0d] text-white relative">
        <NavigationHeader
          title="Home"
          breadcrumbs={[{ label: 'Home' }]}
          actions={
            isConnected && hasCompletedInitialLoad ? (
              <div className="flex items-center gap-2">
                {/* Withdraw Button - shown for Farcaster users with balance */}
                {!user?.webUserId && avantisBalance > 0 && (
                  <Button
                    onClick={() => setIsWithdrawModalOpen(true)}
                    className="bg-[#8759ff] hover:bg-[#7c4dff] text-white px-3 py-2 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-1.5 text-sm font-medium"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-white">
                      <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Withdraw
                  </Button>
                )}
                
                {/* Show BuildTimestamp for web users or when no balance */}
                {(user?.webUserId || avantisBalance === 0) && <BuildTimestamp />}
                
                <Button
                  onClick={async () => {
                    try {
                      await refreshWallets()
                      await refreshBalances(true)
                    } catch (err) {
                      // Refresh failed
                    }
                  }}
                  disabled={isLoading}
                  className="bg-[#8759ff] hover:bg-[#7c4dff] text-white p-2 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={isLoading ? 'Refreshing...' : 'Refresh Balances'}
                >
                  <svg 
                    className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      strokeWidth={2.5} 
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" 
                    />
                  </svg>
                </Button>
              </div>
            ) : undefined
          }
        />

        <div className="px-4 sm:px-6 py-6 space-y-8 max-w-md mx-auto">

          {/* Portfolio Balance Card */}
          {!isConnected ? (
            <BalanceSkeleton />
          ) : (
            isLoading && avantisBalance === 0 && !((positionData?.openPositions ?? 0) > 0) ? (
              <BalanceSkeleton />
            ) : (
              <PortfolioBalanceCard
                avantisBalance={avantisBalance}
                totalProfits={totalProfits}
                isBalanceVisible={isBalanceVisible}
                setIsBalanceVisible={setIsBalanceVisible}
                isConnected={isConnected}
                isTradingLoading={isTradingLoading}
                tradingError={tradingError}
                isLoading={isLoading || isRefreshingBalance}
                positionCollateral={positionData?.positions?.reduce((sum, p) => sum + (p.collateral || 0), 0) || 0}
                positionPnL={positionData?.totalPnL || 0}
                openPositions={positionData?.openPositions || 0}
              />
            )
          )}



          {/* Start Trading Card - Show when wallet is connected */}
          {isConnected && primaryWallet && (
            <TradingCard
              targetProfit={targetProfit}
              setTargetProfit={setTargetProfit}
              targetProfitPercent={targetProfitPercent}
              setTargetProfitPercent={setTargetProfitPercent}
              investmentAmount={investmentAmount}
              setInvestmentAmount={setInvestmentAmount}
              primaryWallet={primaryWallet}
              baseAccountAddress={baseAccountAddress || primaryWallet.address}
              tradingWalletAddress={tradingWalletAddress || tradingWallet?.address || null}
              avantisBalance={avantisBalance}
              onDeposit={handleDeposit}
              isDepositing={isDepositing}
              depositError={depositError}
              recentDepositHash={recentDepositHash}
              isBaseContextAvailable={isBaseTxAvailable}
              holdings={baseHoldings} // Use Farcaster/Base wallet holdings for deposit source
              ethBalanceFormatted={ethBalanceFormatted}
              onViewTrades={handleViewTrades}
              isRefreshingBalance={isRefreshingBalance}
              addToast={addToast}
              startTradingSession={async (config, onProgress) => {
                try {
                  let returnedSessionId: string | undefined
                  
                  const sessionId = await startTradingSession(config, (step, message) => {
                    onProgress?.(step, message)
                    // Open modal when session starts
                    if (step === 'session' && message.includes('Session started')) {
                      // Extract session ID from message
                      const extractedId = message.match(/session[_\s]*([a-f0-9]+)/i)?.[1] || 
                                         message.match(/([a-f0-9]{8,})/i)?.[1] || 
                                         'N/A'
                      
                      returnedSessionId = extractedId
                      
                      setNewSessionData({
                        sessionId: extractedId,
                        investmentAmount: config.investmentAmount || 0,
                        profitGoal: config.profitGoal || config.targetProfit || 0
                      })
                      setIsSessionStartModalOpen(true)
                    }
                  })
                  
                  // Also open modal after a short delay if not already opened
                  setTimeout(() => {
                    if (!isSessionStartModalOpen && (sessionId || returnedSessionId)) {
                      setNewSessionData({
                        sessionId: sessionId || returnedSessionId || 'N/A',
                        investmentAmount: config.investmentAmount || 0,
                        profitGoal: config.profitGoal || config.targetProfit || 0
                      })
                      setIsSessionStartModalOpen(true)
                    }
                  }, 1000)
                  
                  return sessionId
                } catch (error) {
                  throw error
                }
              }}
            />
          )}

          {/* Positions, Balances & Trade History Tabs - Always visible when connected */}
          {isConnected && (
            <Card className="bg-[#1a1a1a] border-[#262626] rounded-2xl overflow-hidden">
              {/* Tabs */}
              <div className="flex border-b border-[#262626] overflow-x-auto">
                <button
                  onClick={() => setActiveTab('positions')}
                  className={`px-4 sm:px-6 py-3 text-sm font-medium transition-colors whitespace-nowrap border-b-2 ${
                    activeTab === 'positions'
                      ? 'text-[#8759ff] border-[#8759ff]'
                      : 'text-[#9ca3af] border-transparent hover:text-white'
                  }`}
                >
                  Positions
                </button>
                <button
                  onClick={() => setActiveTab('balances')}
                  className={`px-4 sm:px-6 py-3 text-sm font-medium transition-colors whitespace-nowrap border-b-2 ${
                    activeTab === 'balances'
                      ? 'text-[#8759ff] border-[#8759ff]'
                      : 'text-[#9ca3af] border-transparent hover:text-white'
                  }`}
                >
                  Balances
                </button>
                <button
                  onClick={() => setActiveTab('tradeHistory')}
                  className={`px-4 sm:px-6 py-3 text-sm font-medium transition-colors whitespace-nowrap border-b-2 ${
                    activeTab === 'tradeHistory'
                      ? 'text-[#8759ff] border-[#8759ff]'
                      : 'text-[#9ca3af] border-transparent hover:text-white'
                  }`}
                >
                  Trade History
                </button>
              </div>

              {/* Tab Content - Scrollable */}
              <div className="overflow-y-auto" style={{ maxHeight: '600px' }}>
                {/* Positions Tab - Always visible */}
                {activeTab === 'positions' && (
                  <div className="p-4 sm:p-6">
                    {/* Debug info in development */}
                    {process.env.NODE_ENV === 'development' && (
                      <div className="mb-4 text-xs text-gray-500">
                        Positions: {positionData?.positions?.length || 0} | 
                        Open: {positionData?.openPositions || 0} | 
                        Loading: {positionsLoading ? 'Yes' : 'No'}
                        {positionData?.error && ` | Error: ${positionData.error}`}
                      </div>
                    )}
                    <PositionsTable
                      positions={positionData?.positions || []}
                      isLoading={positionsLoading}
                      hasStaleData={hasStaleData}
                      onClosePosition={handleClosePosition}
                    />
                    {/* Show message if no positions but session is running */}
                    {!positionsLoading && (!positionData?.positions || positionData.positions.length === 0) && tradingSession?.status === 'running' && (
                      <div className="text-center py-8 text-gray-400">
                        <p>No positions found yet.</p>
                        <p className="text-sm mt-2">Positions will appear here once opened by the trading bot.</p>
                        <button
                          onClick={() => fetchPositions?.(true)}
                          className="mt-4 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm"
                        >
                          Refresh Positions
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Balances Tab */}
                {activeTab === 'balances' && (
                  <div className="p-4 sm:p-6">
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-white font-semibold text-lg mb-4">Account Balances</h3>
                        <div className="space-y-3">
                          <div className="bg-[#2a2a2a] border border-[#374151] rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[#9ca3af] text-sm">Trading Balance</span>
                              <span className="text-white font-semibold">${avantisBalance.toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[#9ca3af] text-sm">Available</span>
                              <span className="text-white">${avantisBalance.toFixed(2)}</span>
                            </div>
                          </div>
                          {ethBalanceFormatted && parseFloat(ethBalanceFormatted.replace(/[^0-9.]/g, '')) > 0 && (
                            <div className="bg-[#2a2a2a] border border-[#374151] rounded-lg p-4">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[#9ca3af] text-sm">ETH Balance</span>
                                <span className="text-white font-semibold">{ethBalanceFormatted}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[#9ca3af] text-sm">Wallet</span>
                                <span className="text-white text-xs font-mono">
                                  {tradingWalletAddress ? `${tradingWalletAddress.slice(0, 6)}...${tradingWalletAddress.slice(-4)}` : 'N/A'}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Trade History Tab */}
                {activeTab === 'tradeHistory' && (
                  <TradeHistoryTab 
                    tradingSession={tradingSession}
                    positionData={positionData}
                    getTradingSessions={getTradingSessions}
                    token={authToken || ''}
                  />
                )}
              </div>
            </Card>
          )}

          {/* Wallet Info Section - Show backend trading wallet */}
          {/* Always show when connected, even if wallet is still being fetched */}
          {isConnected && (
            <WalletInfoCard
              tradingWallet={tradingWallet || (tradingWalletAddress ? {
                address: tradingWalletAddress,
                chain: 'ethereum',
                privateKey: undefined
              } : null)}
              ethBalanceFormatted={ethBalanceFormatted}
              avantisBalance={avantisBalance}
              tradingWalletAddress={tradingWalletAddress || tradingWallet?.address || null}
              baseAccountAddress={baseAccountAddress}
              token={authToken}
              isLoading={isLoading}
              onDeposit={handleDeposit}
              isDepositing={isDepositing}
              depositError={depositError}
              recentDepositHash={recentDepositHash}
              holdings={baseHoldings} // Use Farcaster/Base wallet holdings for deposit source
            />
          )}

          {/* Your Holdings - Only show when connected and has holdings */}
          <HoldingsSection holdings={realHoldings} />
        </div>
        
        {/* Withdraw Modal */}
        <WithdrawModal
          isOpen={isWithdrawModalOpen}
          onClose={() => setIsWithdrawModalOpen(false)}
          onWithdraw={handleWithdraw}
          isWithdrawing={isWithdrawing}
          withdrawError={withdrawError}
          recentWithdrawHash={recentWithdrawHash}
          tradingWalletAddress={tradingWalletAddress || tradingWallet?.address || null}
          avantisBalance={avantisBalance}
        />
      </div>

      {/* Floating Live Trading Card */}
      <FloatingLiveCard />
      
      {/* Session Start Modal - Opens from bottom */}
      {isSessionStartModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end animate-fade-in">
          <div className="w-full bg-[#1a1a1a] border-t border-[#262626] rounded-t-3xl animate-slide-up max-h-[60vh] flex flex-col">
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-[#262626] flex-shrink-0">
              <div className="flex items-center space-x-3">
                <div className="w-3 h-3 bg-[#27c47d] rounded-full animate-pulse"></div>
                <h2 className="text-white font-semibold text-lg sm:text-xl">Trading Session Started</h2>
              </div>
              <button
                onClick={() => {
                  setIsSessionStartModalOpen(false)
                  setNewSessionData(null)
                }}
                className="p-2 rounded-lg hover:bg-[#262626] text-[#9ca3af] hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="space-y-4">
                <div className="bg-[#2a2a2a] border border-[#374151] rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#9ca3af] text-sm">Session ID</span>
                    <span className="text-white font-mono text-xs">
                      {newSessionData?.sessionId || 'N/A'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#9ca3af] text-sm">Investment Amount</span>
                    <span className="text-white font-semibold">
                      ${newSessionData?.investmentAmount.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#9ca3af] text-sm">Target Profit</span>
                    <span className="text-[#27c47d] font-semibold">
                      ${newSessionData?.profitGoal.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#9ca3af] text-sm">Status</span>
                    <span className="text-[#27c47d] font-semibold">Running</span>
                  </div>
                </div>
                
                <div className="bg-[#1f2937] border border-[#374151] rounded-lg p-4">
                  <p className="text-[#9ca3af] text-sm">
                    Your trading session is now active! The AI bot will monitor market conditions and open positions when opportunities arise.
                  </p>
                </div>
                
                <div className="flex gap-3">
                  <Button
                    onClick={() => {
                      setIsSessionStartModalOpen(false)
                      setNewSessionData(null)
                    }}
                    className="flex-1 bg-[#8759ff] hover:bg-[#7c4dff] text-white"
                  >
                    Got it
                  </Button>
                  <Button
                    onClick={() => {
                      setIsSessionStartModalOpen(false)
                      setNewSessionData(null)
                      setActiveTab('tradeHistory')
                    }}
                    className="flex-1 bg-[#2a2a2a] hover:bg-[#374151] text-white border border-[#374151]"
                  >
                    View History
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Positions Modal */}
      <Modal
        isOpen={isPositionsModalOpen}
        onClose={() => setIsPositionsModalOpen(false)}
        className="border border-[#262626]"
      >
        <div className="flex flex-col h-full max-h-[90vh]">
          {/* Modal Header */}
          <div className="flex items-center justify-between p-4 sm:p-6 border-b border-[#262626] flex-shrink-0">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-[#27c47d] rounded-full animate-pulse"></div>
              <h2 className="text-white font-semibold text-lg sm:text-xl">Active Positions</h2>
            </div>
            <button
              onClick={() => setIsPositionsModalOpen(false)}
              className="p-2 rounded-lg hover:bg-[#262626] text-[#9ca3af] hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Modal Body - Scrollable */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {tradingSession && tradingSession.status === 'running' && (
              <div className="mb-4 p-4 bg-[#2a2a2a] border border-[#374151] rounded-lg">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-[#9ca3af]">Session ID:</span>
                    <p className="text-white font-mono text-xs mt-1">
                      {tradingSession.sessionId?.slice(0, 16) || 'N/A'}...
                    </p>
                  </div>
                  <div>
                    <span className="text-[#9ca3af]">Status:</span>
                    <p className="text-[#27c47d] font-medium mt-1">Running</p>
                  </div>
                  <div>
                    <span className="text-[#9ca3af]">Total PnL:</span>
                    <p className={`font-semibold mt-1 ${
                      (positionData?.totalPnL || tradingSession?.totalPnL || 0) >= 0 
                        ? 'text-[#27c47d]' 
                        : 'text-[#ef4444]'
                    }`}>
                      ${(positionData?.totalPnL || tradingSession?.totalPnL || 0).toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[#9ca3af]">Target Profit:</span>
                    <p className="text-white font-semibold mt-1">
                      ${tradingSession.config?.profitGoal || '0'}
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            <PositionsTable
              positions={positionData?.positions || []}
              isLoading={positionsLoading}
              hasStaleData={hasStaleData}
              onClosePosition={handleClosePosition}
            />
          </div>
        </div>
      </Modal>
    </ProtectedRoute>
  )
}