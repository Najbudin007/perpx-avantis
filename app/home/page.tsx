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
import { FloatingLiveCard } from "@/components/FloatingLiveCard"
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
  // Total trading value = free USDC + collateral in positions + unrealized PnL
  const totalTradingValue = avantisBalance + positionCollateral + positionPnL
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
}) => {
  const [isTrading, setIsTrading] = useState(false)
  const { positionData, isLoading: positionsLoading } = usePositions()
  const [depositAsset, setDepositAsset] = useState<'USDC' | 'ETH'>('USDC')
  const [depositAmount, setDepositAmount] = useState('')
  const [hasSuccessfulDeposit, setHasSuccessfulDeposit] = useState(false)
  const [lossThreshold, setLossThreshold] = useState('10')
  const [maxPositions, setMaxPositions] = useState('1')
  
  // Min/Max validation constants
  const MIN_INVESTMENT = 10 // Minimum $10 to trade
  const FEE_PERCENTAGE = 0.01 // 1% commission fee
  
  // Parse investment amount for validation
  const investmentNum = parseFloat(investmentAmount) || 0
  const targetProfitPercentNum = parseFloat(targetProfitPercent) || 0
  // Calculate target profit USD from percent for validation and trading
  const targetProfitNum = investmentNum > 0 && targetProfitPercentNum > 0 
    ? (targetProfitPercentNum / 100) * investmentNum 
    : 0

  // Sync targetProfit USD value when percent or investment changes
  useEffect(() => {
    if (targetProfitPercent && investmentNum > 0) {
      const pct = parseFloat(targetProfitPercent)
      if (!isNaN(pct) && pct >= 0) {
        const amount = (pct / 100) * investmentNum
        setTargetProfit(amount.toFixed(2))
      }
    } else if (!targetProfitPercent) {
      setTargetProfit("")
    }
  }, [targetProfitPercent, investmentAmount, investmentNum, setTargetProfit])
  
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
  
  // Validation checks
  const isInvestmentBelowMin = investmentNum > 0 && investmentNum < MIN_INVESTMENT
  const isInvestmentAboveMax = investmentNum > MAX_INVESTMENT && MAX_INVESTMENT > 0
  const hasEnoughForFee = avantisBalance >= totalRequired
  const isInvestmentValid = investmentNum >= MIN_INVESTMENT && investmentNum <= MAX_INVESTMENT && hasEnoughForFee
  const isBalanceTooLow = avantisBalance < MIN_BALANCE_REQUIRED
  // Check if percent exceeds 100% (shouldn't happen due to clamping, but safety check)
  const isTargetProfitTooHigh = targetProfitPercentNum > 100

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

  const handleStartTrading = async () => {
    // Validate that both fields are filled
    if (!targetProfitPercent || !investmentAmount) {
      // You could show an error message here if needed
      return;
    }
    
    const profitPercentNum = parseFloat(targetProfitPercent);
    const investmentNum = parseFloat(investmentAmount);
    
    // Validate numeric values
    if (isNaN(profitPercentNum) || profitPercentNum <= 0 || profitPercentNum > 100) {
      return;
    }
    
    if (isNaN(investmentNum) || investmentNum <= 0) {
      return;
    }

    // Calculate target profit USD from percent (already validated to be <= 100%)
    const profitNum = (profitPercentNum / 100) * investmentNum;
    
    // Redirect to chat page with trading parameters
    const params = new URLSearchParams({
      profit: profitNum.toString(),
      investment: investmentAmount,
      mode: 'real', // Use real trading mode
      lossThreshold: lossThreshold,
      maxPositions: maxPositions
    })
    
    router.push(`/chat?${params.toString()}`)
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
                    // Allow empty input
                    if (value === "") {
                      setTargetProfitPercent("")
                      setTargetProfit("")
                      return
                    }

                    let pct = parseFloat(value)
                    if (isNaN(pct) || pct < 0) {
                      setTargetProfitPercent(value)
                      return
                    }

                    // Clamp to 0-100%
                    if (pct > 100) pct = 100
                    setTargetProfitPercent(pct.toString())

                    const investmentVal = parseFloat(investmentAmount)
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
                  onChange={(e) => setInvestmentAmount(e.target.value)}
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
          disabled={
            isTrading || 
            positionsLoading || 
            (!hasActivePositions && (
              isTargetProfitTooHigh ||
              !targetProfitPercent || 
              !investmentAmount || 
              parseFloat(targetProfitPercent) <= 0 || 
              parseFloat(targetProfitPercent) > 100 ||
              !isInvestmentValid
            ))
          }
          className="w-full bg-[#8759ff] hover:bg-[#7C3AED] text-white font-semibold py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
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
  token,
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
    if ((tradingWalletWithKey?.privateKey) || !token || hasAttemptedFetch) return
    
    // Only fetch once
    let isMounted = true
    
    const fetchTradingWallet = async () => {
      setIsFetching(true)
      setFetchError(null)
      
      try {
        // Fetch wallet with private key for MetaMask connection
        const response = await fetch('/api/wallet/primary-with-key', {
          headers: {
            'Authorization': `Bearer ${token}`
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
  }, [token, tradingWalletWithKey?.privateKey, hasAttemptedFetch]) // Depend on privateKey to refetch if missing

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
  const { user, token } = useAuth()
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
  const { tradingSession, refreshSessionStatus } = useTradingSession()
  const router = useRouter()
  
  // State for active sessions list
  const [activeSessions, setActiveSessions] = useState<Array<{
    id: string;
    status: string;
    startTime: string | Date;
    totalPnL: number;
    positions: number;
    config?: any;
  }>>([])
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)

  const { signAndSendTransaction, waitForTransaction, isAvailable: isBaseTxAvailable, estimateGas } = useBaseAccountTransactions()
  const { sdk: baseSdk } = useBaseMiniApp()
  
  // Handle viewing trades - check for active session
  const handleViewTrades = useCallback(async () => {
    // Check if there's an active session first
    if (tradingSession && tradingSession.status === 'running') {
      const params = new URLSearchParams({
        mode: 'real',
        view: 'positions',
        sessionId: tradingSession.sessionId
      });
      router.push(`/chat?${params.toString()}`);
    } else {
      // Redirect to chat page to view ongoing trades
      const params = new URLSearchParams({
        mode: 'real',
        view: 'positions' // Add a parameter to indicate we're viewing positions
      });
      router.push(`/chat?${params.toString()}`);
    }
  }, [tradingSession, router]);
  
  // Refresh session status when component mounts or when positions change
  const { positionData, isLoading: positionsLoading, closePosition } = usePositions()
  
  useEffect(() => {
    if (isConnected) {
      if (tradingSession && tradingSession.status === 'running') {
        refreshSessionStatus(false);
      }
      
      const interval = setInterval(() => {
        if (tradingSession && tradingSession.status === 'running') {
          refreshSessionStatus(false); // Just refresh existing session
        }
      }, 10000); // Refresh every 10 seconds
      
      return () => clearInterval(interval);
    }
  }, [isConnected, tradingSession?.status, refreshSessionStatus]);
  
  useEffect(() => {
    if (isConnected && positionData && positionData.openPositions > 0 && !tradingSession && avantisBalance > 0) {

      refreshSessionStatus(true).catch(err => {
      });
    } else if (isConnected && !positionData?.openPositions && tradingSession && tradingSession.status !== 'running') {
    }
  }, [isConnected, positionData?.openPositions, tradingSession, avantisBalance, refreshSessionStatus]);
  
  // Handle closing a position
  const handleClosePosition = useCallback(async (positionId: string) => {
    try {
      addToast({
        type: 'info',
        title: 'Closing Position',
        message: `Closing ${positionId}...`
      });
      
      const success = await closePosition(positionId);
      
      if (success) {
        addToast({
          type: 'success',
          title: 'Position Closed',
          message: `Successfully closed ${positionId}`
        });
      } else {
        addToast({
          type: 'error',
          title: 'Close Failed',
          message: `Failed to close ${positionId}`
        });
      }
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Close Failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    }
  }, [closePosition, addToast]);
  
  // Fetch active sessions on mount and periodically
  useEffect(() => {
    const fetchActiveSessions = async () => {
      if (!isConnected) return;
      
      setIsLoadingSessions(true);
      try {
        const sessions = await getTradingSessions();
        // Filter for running sessions only
        const running = sessions.filter(s => s.status === 'running');
        setActiveSessions(running);
      } catch (error) {
        setActiveSessions([]);
      } finally {
        setIsLoadingSessions(false);
      }
    };
    
    fetchActiveSessions();
    // Refresh every 10 seconds
    const interval = setInterval(fetchActiveSessions, 10000);
    return () => clearInterval(interval);
  }, [isConnected, getTradingSessions]);

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
      if (!token) {
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

      setIsDepositing(true)
      setDepositError(null)
      setRecentDepositHash(null)

      try {
        const response = await fetch('/api/wallet/deposit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
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

        // Wait for transaction confirmation before refreshing balances
        try {
          await waitForTransaction(txHash, 2) // Wait up to 2 confirmations
          
          // Ensure we only refresh once per transaction hash
          if (hasRefreshedForTxRef.current.has(txHash)) {
            return
          }
          
          // Mark this transaction as refreshed
          hasRefreshedForTxRef.current.add(txHash)
          
          // Auto-refresh balance after successful deposit confirmation (ONCE ONLY)
          // Add a small delay to allow blockchain state to propagate
          setIsRefreshingBalance(true)
          await new Promise(resolve => setTimeout(resolve, 2000))
          
          // Refresh balances to show updated balance immediately (only once)
          try {
            await refreshBalances(true) // Force refresh
          } catch (refreshError) {
            // Don't throw - deposit was successful, just balance refresh failed
          } finally {
            setIsRefreshingBalance(false)
          }
        } catch (waitError) {
          // Ensure we only refresh once per transaction hash (even on timeout)
          if (hasRefreshedForTxRef.current.has(txHash)) {
            return
          }
          
          // Mark this transaction as refreshed
          hasRefreshedForTxRef.current.add(txHash)
          
          // Still try to refresh even if wait timed out (only once)
          try {
            setIsRefreshingBalance(true)
            await new Promise(resolve => setTimeout(resolve, 3000)) // Longer delay if confirmation wait failed
            await refreshBalances(true)
          } catch (refreshError) {
            // Balance refresh failed, but deposit was successful
          } finally {
            setIsRefreshingBalance(false)
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Deposit failed'
        setDepositError(message)
        setRecentDepositHash(null)
        throw error
      } finally {
        setIsDepositing(false)
      }
    },
    [
      token,
      primaryWallet?.address,
      baseAccountAddress,
      signAndSendTransaction,
      waitForTransaction,
      isBaseTxAvailable,
      refreshBalances,
      refreshWallets,
      estimateGas,
      baseSdk
    ]
  )

  // Handle withdraw from trading wallet
  const handleWithdraw = useCallback(
    async ({ amount, recipientAddress }: { amount: string; recipientAddress: string }) => {
      setWithdrawError(null)
      setRecentWithdrawHash(null)
      setIsWithdrawing(true)

      try {
        if (!token) {
          throw new Error('Authentication required')
        }

        // Call backend API to execute withdrawal
        const response = await fetch('/api/wallet/withdraw', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
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

        setRecentWithdrawHash(data.txHash)
        
        // Refresh balance after successful withdrawal
        setIsRefreshingBalance(true)
        try {
          await new Promise(resolve => setTimeout(resolve, 3000))
          await refreshBalances(true)
        } finally {
          setIsRefreshingBalance(false)
        }
        
        addToast({
          title: 'Withdrawal Successful',
          message: `Successfully withdrew $${amount} USDC`,
          type: 'success'
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Withdrawal failed'
        setWithdrawError(message)
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
    [token, refreshBalances, addToast]
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

          {/* Active Trading Sessions Section - Shows all running sessions */}
          {isConnected && (activeSessions.length > 0 || (tradingSession && tradingSession.status === 'running')) && (
            <Card className="bg-[#1a1a1a] border-[#262626] rounded-2xl p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold text-lg">Active Trading Sessions</h2>
                <span className="text-[#b4b4b4] text-sm">
                  {activeSessions.length > 0 ? `${activeSessions.length} active` : 
                   (tradingSession && tradingSession.status === 'running' ? '1 active' : '0 active')}
                </span>
              </div>
              
              {isLoadingSessions ? (
                <div className="text-center py-4 text-[#b4b4b4] text-sm">Loading sessions...</div>
              ) : (
                <div className="space-y-3">
                  {/* Current session if exists */}
                  {tradingSession && tradingSession.status === 'running' && (
                    <div 
                      key={tradingSession.sessionId || tradingSession.id}
                      className="bg-[#2a2a2a] border border-[#262626] rounded-lg p-4 cursor-pointer hover:bg-[#333] transition-colors"
                      onClick={() => {
                        const params = new URLSearchParams({
                          mode: 'real',
                          view: 'positions',
                          sessionId: tradingSession.sessionId || tradingSession.id
                        });
                        router.push(`/chat?${params.toString()}`);
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <div className="w-2 h-2 bg-[#27c47d] rounded-full animate-pulse"></div>
                          <span className="text-white font-medium">Session {(tradingSession.sessionId || tradingSession.id)?.slice(-8)}</span>
                          <span className="text-[#27c47d] text-xs px-2 py-0.5 rounded bg-[#27c47d]/20">Running</span>
                        </div>
                        <span className={`text-sm font-medium ${(tradingSession.totalPnL || 0) >= 0 ? 'text-[#27c47d]' : 'text-[#dc3545]'}`}>
                          ${(tradingSession.totalPnL || 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-[#b4b4b4]">
                        <span>Positions: {tradingSession.openPositions || 0}</span>
                        <span>Started: {new Date(tradingSession.startTime).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  )}
                  
                  {/* Other active sessions */}
                  {activeSessions
                    .filter(s => s.id !== tradingSession?.sessionId && s.id !== tradingSession?.id)
                    .map((session) => (
                      <div
                        key={session.id}
                        className="bg-[#2a2a2a] border border-[#262626] rounded-lg p-4 cursor-pointer hover:bg-[#333] transition-colors"
                        onClick={() => {
                          const params = new URLSearchParams({
                            mode: 'real',
                            view: 'positions',
                            sessionId: session.id
                          });
                          router.push(`/chat?${params.toString()}`);
                        }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-[#27c47d] rounded-full animate-pulse"></div>
                            <span className="text-white font-medium">Session {session.id.slice(-8)}</span>
                            <span className="text-[#27c47d] text-xs px-2 py-0.5 rounded bg-[#27c47d]/20">Running</span>
                          </div>
                          <span className={`text-sm font-medium ${(session.totalPnL || 0) >= 0 ? 'text-[#27c47d]' : 'text-[#dc3545]'}`}>
                            ${(session.totalPnL || 0).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-[#b4b4b4]">
                          <span>Positions: {session.positions || 0}</span>
                          <span>Started: {new Date(session.startTime).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    ))}
                  
                  {activeSessions.length === 0 && (!tradingSession || tradingSession.status !== 'running') && (
                    <div className="text-center py-4 text-[#b4b4b4] text-sm">No active sessions</div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* Active Trading Session Card - Shows real on-chain positions from Avantis */}
          {/* Show card ONLY if session is actually running AND status is 'running' */}
          {isConnected && tradingSession && tradingSession.status === 'running' && (
            <Card className="bg-[#1a1a1a] border-[#262626] rounded-2xl p-4 sm:p-6 sticky top-4 z-10 shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-[#27c47d] rounded-full animate-pulse"></div>
                  <span className="text-[#27c47d] text-sm font-medium">Trading Active on Avantis</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-[#b4b4b4] text-xs">
                    Session: {tradingSession?.sessionId?.slice(-8) || (positionData?.openPositions ? 'Restoring...' : 'N/A')}
                  </span>
                  <Button
                    onClick={() => {
                      const sessionId = tradingSession?.sessionId || 'active';
                      const params = new URLSearchParams({
                        mode: 'real',
                        view: 'positions',
                        ...(tradingSession?.sessionId ? { sessionId } : {})
                      });
                      router.push(`/chat?${params.toString()}`);
                    }}
                    className="bg-[#8759ff] hover:bg-[#7c4dff] text-white text-xs px-3 py-1.5 ml-2"
                  >
                    View Details
                  </Button>
                </div>
              </div>
              
              {/* Positions Table - Shows all positions in a responsive table/card layout */}
              {positionData && positionData.positions && positionData.positions.length > 0 && (
                <div className="mb-4">
                  <PositionsTable
                    positions={positionData.positions}
                    isLoading={positionsLoading}
                    onClosePosition={handleClosePosition}
                  />
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <p className="text-[#b4b4b4] text-xs sm:text-sm">Total PnL</p>
                  <p className={`font-semibold text-base sm:text-lg ${(positionData?.totalPnL || tradingSession?.totalPnL || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${(positionData?.totalPnL || tradingSession?.totalPnL || 0).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-[#b4b4b4] text-xs sm:text-sm">Target Profit</p>
                  <p className="text-white font-semibold text-base sm:text-lg">${tradingSession?.config?.profitGoal || '0'}</p>
                </div>
                <div>
                  <p className="text-[#b4b4b4] text-xs sm:text-sm">Open Positions</p>
                  <p className="text-white font-semibold text-base sm:text-lg">{positionData?.openPositions || tradingSession?.openPositions || 0}</p>
                </div>
                <div>
                  <p className="text-[#b4b4b4] text-xs sm:text-sm">Cycle</p>
                  <p className="text-white font-semibold text-base sm:text-lg">{tradingSession?.cycle || 0}</p>
                </div>
              </div>
              
              <div className="w-full bg-[#262626] rounded-full h-2 mb-2">
                <div 
                  className="bg-[#27c47d] h-2 rounded-full transition-all duration-300" 
                  style={{ 
                    width: `${Math.min(100, (() => {
                      const pnl = positionData?.totalPnL || tradingSession?.totalPnL || 0;
                      const goal = tradingSession?.config?.profitGoal || 1;
                      const positions = positionData?.openPositions || tradingSession?.openPositions || 0;
                      
                      // If PnL is 0 but we have positions, show some progress based on position count
                      if (pnl === 0 && positions > 0) {
                        return Math.min(20, positions * 2); // 2% per position, max 20%
                      }
                      
                      return (pnl / goal) * 100;
                    })())}%` 
                  }}
                ></div>
              </div>
              <p className="text-[#b4b4b4] text-xs">
                Progress: {(() => {
                  const pnl = positionData?.totalPnL || tradingSession?.totalPnL || 0;
                  const goal = tradingSession?.config?.profitGoal || 1;
                  const positions = positionData?.openPositions || tradingSession?.openPositions || 0;
                  
                  if (pnl === 0 && positions > 0) {
                    return `${Math.min(20, positions * 2).toFixed(1)}% (${positions} positions)`;
                  }
                  
                  return `${((pnl / goal) * 100).toFixed(1)}%`;
                })()}
              </p>
              
              {/* Link to view on AvantisFi */}
              <div className="mt-3 pt-3 border-t border-[#262626]">
                <a
                  href="https://www.avantisfi.com/trade?asset=BTC-USD"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#8759ff] text-xs hover:text-[#7c4dff] flex items-center space-x-1"
                >
                  <span>View positions on AvantisFi Dashboard</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="inline">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </a>
              </div>
            </Card>
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
                    <PositionsTable
                      positions={positionData?.positions || []}
                      isLoading={positionsLoading}
                      onClosePosition={handleClosePosition}
                    />
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
                  <div className="p-4 sm:p-6">
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-white font-semibold text-lg mb-4">Trade History</h3>
                        {tradingSession && tradingSession.status === 'running' ? (
                          <div className="space-y-3">
                            <div className="bg-[#2a2a2a] border border-[#374151] rounded-lg p-4">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[#9ca3af] text-sm">Session ID</span>
                                <span className="text-white font-mono text-xs">
                                  {tradingSession.sessionId?.slice(-8) || 'N/A'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[#9ca3af] text-sm">Status</span>
                                <span className="text-[#27c47d] font-semibold">Running</span>
                              </div>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[#9ca3af] text-sm">Total PnL</span>
                                <span className={`font-semibold ${(positionData?.totalPnL || tradingSession?.totalPnL || 0) >= 0 ? 'text-[#27c47d]' : 'text-[#ef4444]'}`}>
                                  ${(positionData?.totalPnL || tradingSession?.totalPnL || 0).toFixed(2)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[#9ca3af] text-sm">Open Positions</span>
                                <span className="text-white font-semibold">
                                  {positionData?.openPositions || tradingSession?.openPositions || 0}
                                </span>
                              </div>
                            </div>
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
              token={token}
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
    </ProtectedRoute>
  )
}