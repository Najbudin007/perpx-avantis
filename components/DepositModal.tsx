"use client"

import { useState, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Modal } from "@/components/ui/modal"

interface TokenHolding {
  token: {
    symbol: string
    name: string
    decimals: number
  }
  balance: string
  balanceFormatted: string
  valueUSD: number
}

interface DepositModalProps {
  isOpen: boolean
  onClose: () => void
  onDeposit: (params: { amount: string; asset: 'USDC' | 'ETH' }) => Promise<void>
  isDepositing: boolean
  depositError: string | null
  recentDepositHash: string | null
  baseAccountAddress: string | null
  tradingWalletAddress: string | null
  holdings?: TokenHolding[]
  ethBalance?: string
}

export function DepositModal({
  isOpen,
  onClose,
  onDeposit,
  isDepositing,
  depositError,
  recentDepositHash,
  baseAccountAddress,
  tradingWalletAddress,
  holdings = [],
  ethBalance = '0'
}: DepositModalProps) {
  const [depositAsset, setDepositAsset] = useState<'USDC' | 'ETH'>('USDC')
  const [depositAmount, setDepositAmount] = useState('')
  const [hasSuccessfulDeposit, setHasSuccessfulDeposit] = useState(false)
  const [showAvailableFunds, setShowAvailableFunds] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  
  // Find available balance for selected asset
  const rawBalance = depositAsset === 'ETH' 
    ? ethBalance 
    : holdings.find(h => h.token.symbol === 'USDC')?.balanceFormatted || '0'
  
  // For ETH, we need to reserve gas fees (approximately 0.0001 ETH for a simple transfer)
  // For USDC, we can use the full balance
  const GAS_RESERVE_ETH = 0.0001 // Reserve ~0.0001 ETH for gas fees
  const selectedAssetBalance = depositAsset === 'ETH'
    ? (() => {
        const balance = parseFloat(rawBalance) || 0
        const maxDepositable = Math.max(0, balance - GAS_RESERVE_ETH)
        return maxDepositable > 0 ? maxDepositable.toFixed(6) : '0'
      })()
    : rawBalance
  
  const selectedAssetUSD = depositAsset === 'ETH'
    ? holdings.find(h => h.token.symbol === 'ETH')?.valueUSD || 0
    : holdings.find(h => h.token.symbol === 'USDC')?.valueUSD || 0

  const explorerBaseUrl = process.env.NEXT_PUBLIC_AVANTIS_NETWORK === 'base-testnet'
    ? 'https://sepolia.basescan.org'
    : 'https://basescan.org'

  useEffect(() => {
    if (recentDepositHash) {
      setHasSuccessfulDeposit(true)
    }
  }, [recentDepositHash])

  useEffect(() => {
    if (depositError) {
      setHasSuccessfulDeposit(false)
    }
  }, [depositError])

  const handleDeposit = async () => {
    if (!depositAmount) return
    
    // Client-side validation: For ETH deposits, check if amount + gas exceeds balance
    if (depositAsset === 'ETH') {
      const depositValue = parseFloat(depositAmount)
      const balanceValue = parseFloat(rawBalance)
      const GAS_RESERVE_ETH = 0.0001 // Reserve for gas
      
      if (isNaN(depositValue) || depositValue <= 0) {
        return // Invalid amount
      }
      
      // Check if deposit amount + gas reserve exceeds available balance
      if (depositValue + GAS_RESERVE_ETH > balanceValue) {
        const maxAllowed = Math.max(0, balanceValue - GAS_RESERVE_ETH)
        // This will be caught by onDeposit and shown as error, but we can prevent the call
        console.warn(`[DepositModal] Deposit amount ${depositValue} ETH + gas reserve ${GAS_RESERVE_ETH} ETH exceeds balance ${balanceValue} ETH. Max allowed: ${maxAllowed} ETH`)
      }
    }
    
    try {
      await onDeposit({ amount: depositAmount, asset: depositAsset })
      setHasSuccessfulDeposit(true)
      setDepositAmount('')
    } catch (error) {
      setHasSuccessfulDeposit(false)
    }
  }

  const handleClose = () => {
    setDepositAmount('')
    setHasSuccessfulDeposit(false)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      {/* Fixed Header with Close button */}
      <div className="flex items-center justify-between p-4 sm:p-6 pb-0 sticky top-0 bg-[#1a1a1a] z-10">
        <div className="flex items-center space-x-2">
          <div className="w-10 h-10 bg-[#8759ff] rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <h3 className="text-white font-semibold text-xl">Deposit Funds</h3>
        </div>
        <button
          onClick={handleClose}
          className="p-2 rounded-lg hover:bg-[#262626] text-[#9ca3af] hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="p-4 sm:p-6 pt-4 overflow-y-auto flex-1 space-y-4">
        <p className="text-[#9ca3af] text-sm">
          Transfer {depositAsset} from your Base wallet to your trading vault to fund your automated trading.
        </p>

        {/* Available Funds Section - Collapsible */}
        {holdings.length > 0 && (
          <div className="bg-[#0d0d0d] border border-[#374151] rounded-lg overflow-hidden">
            <button
              onClick={() => setShowAvailableFunds(!showAvailableFunds)}
              className="w-full p-3 flex items-center justify-between hover:bg-[#1a1a1a] transition-colors"
            >
              <div className="flex items-center space-x-2">
                <span className="text-white text-sm font-medium">Your Available Funds</span>
                <span className="text-[#9ca3af] text-xs">Farcaster Wallet</span>
              </div>
              <svg 
                className={`w-4 h-4 text-[#9ca3af] transition-transform ${showAvailableFunds ? 'rotate-180' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {showAvailableFunds && (
              <div className="px-3 pb-3 space-y-2">
                {/* ETH Balance */}
                {ethBalance && parseFloat(ethBalance) > 0 && (
                  <div className="flex items-center justify-between p-2 bg-[#1a1a1a] rounded-lg">
                    <div className="flex items-center space-x-2">
                      <div className="w-7 h-7 rounded-full bg-[#627eea] flex items-center justify-center text-white font-bold text-[10px]">
                        Ξ
                      </div>
                      <div>
                        <p className="text-white text-xs font-medium">ETH</p>
                        <p className="text-[#9ca3af] text-[10px]">Ethereum</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-white text-xs font-semibold">{parseFloat(ethBalance).toFixed(4)}</p>
                      <p className="text-[#9ca3af] text-[10px]">
                        ${(holdings.find(h => h.token.symbol === 'ETH')?.valueUSD || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                )}
                
                {/* Other Token Holdings */}
                {holdings.filter(h => h.token.symbol !== 'ETH' && parseFloat(h.balance) > 0).map((holding, index) => (
                  <div key={index} className="flex items-center justify-between p-2 bg-[#1a1a1a] rounded-lg">
                    <div className="flex items-center space-x-2">
                      <div className="w-7 h-7 rounded-full bg-[#2775ca] flex items-center justify-center text-white font-bold text-[10px]">
                        {holding.token.symbol.charAt(0)}
                      </div>
                      <div>
                        <p className="text-white text-xs font-medium">{holding.token.symbol}</p>
                        <p className="text-[#9ca3af] text-[10px]">{holding.token.name}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-white text-xs font-semibold">{holding.balanceFormatted}</p>
                      <p className="text-[#9ca3af] text-[10px]">${holding.valueUSD.toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Asset Selection */}
        <div className="space-y-2">
          <label className="block text-sm text-white font-medium">Select Asset</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDepositAsset('USDC')}
              className={`flex-1 px-4 py-2.5 text-sm rounded-lg border-2 transition-all ${
                depositAsset === 'USDC' 
                  ? 'bg-[#8759ff] text-white border-[#8759ff] shadow-lg' 
                  : 'border-[#374151] text-[#9ca3af] hover:border-[#4b5563] hover:text-white'
              }`}
            >
              USDC
            </button>
            <button
              onClick={() => setDepositAsset('ETH')}
              className={`flex-1 px-4 py-2.5 text-sm rounded-lg border-2 transition-all ${
                depositAsset === 'ETH' 
                  ? 'bg-[#8759ff] text-white border-[#8759ff] shadow-lg' 
                  : 'border-[#374151] text-[#9ca3af] hover:border-[#4b5563] hover:text-white'
              }`}
            >
              ETH
            </button>
          </div>
        </div>

        {/* Amount Input - with scroll-into-view on focus */}
        <div className="space-y-2 scroll-mt-4">
          <div className="flex items-center justify-between">
            <label className="block text-sm text-white font-medium">
              Amount ({depositAsset})
            </label>
            <span className="text-xs text-[#9ca3af]">
              Available: <span className="text-white font-medium">{rawBalance} {depositAsset}</span>
              {depositAsset === 'ETH' && parseFloat(rawBalance) > GAS_RESERVE_ETH && (
                <span className="text-[#6b7280] ml-1">(max: {selectedAssetBalance} after gas)</span>
              )}
            </span>
          </div>
          <div className="relative">
            <Input
              ref={inputRef}
              type="number"
              min="0"
              step="0.0001"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              onFocus={(e) => {
                // Auto-collapse the Available Funds section when input is focused on mobile
                setShowAvailableFunds(false)
                // Scroll the input into view after a brief delay to account for keyboard
                setTimeout(() => {
                  e.target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 300)
              }}
              className="bg-[#2a2a2a] border-[#374151] text-white placeholder:text-[#6b7280] pr-16"
              placeholder={depositAsset === 'USDC' ? 'Enter USDC amount' : 'Enter ETH amount'}
            />
            <button
              type="button"
              onClick={() => {
                const maxAmount = selectedAssetBalance.trim()
                if (maxAmount && parseFloat(maxAmount) > 0) {
                  setDepositAmount(maxAmount)
                }
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#8759ff] hover:bg-[#7c4dff] text-white text-xs rounded transition-colors"
            >
              MAX
            </button>
          </div>
          {/* Show warning if ETH deposit amount + gas exceeds balance */}
          {depositAsset === 'ETH' && depositAmount && parseFloat(depositAmount) > 0 && (() => {
            const depositValue = parseFloat(depositAmount)
            const balanceValue = parseFloat(rawBalance)
            const GAS_RESERVE_ETH = 0.0001
            const exceedsBalance = depositValue + GAS_RESERVE_ETH > balanceValue
            const maxAllowed = Math.max(0, balanceValue - GAS_RESERVE_ETH)
            
            if (exceedsBalance) {
              return (
                <p className="text-xs text-red-400 mt-1">
                  Amount too high. You need {GAS_RESERVE_ETH.toFixed(4)} ETH for gas. Max: {maxAllowed.toFixed(6)} ETH
                </p>
              )
            }
            return null
          })()}
          {selectedAssetUSD > 0 && !(depositAsset === 'ETH' && depositAmount && parseFloat(depositAmount) > 0 && parseFloat(depositAmount) + 0.0001 > parseFloat(rawBalance)) && (
            <p className="text-xs text-[#9ca3af]">
              ≈ ${selectedAssetUSD.toFixed(2)} USD
            </p>
          )}
        </div>

        {/* Wallet Addresses */}
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-[#9ca3af]">From (Base wallet):</span>
            <span className="text-white font-mono">
              {baseAccountAddress ? `${baseAccountAddress.slice(0, 6)}...${baseAccountAddress.slice(-4)}` : '—'}
            </span>
          </div>
          {tradingWalletAddress && (
            <div className="flex justify-between">
              <span className="text-[#9ca3af]">To (Trading vault):</span>
              <span className="text-white font-mono">
                {tradingWalletAddress.slice(0, 6)}...{tradingWalletAddress.slice(-4)}
              </span>
            </div>
          )}
        </div>

        {/* Deposit Button */}
        <Button
          disabled={
            isDepositing || 
            !depositAmount || 
            Number(depositAmount) <= 0 ||
            (depositAsset === 'ETH' && parseFloat(depositAmount) + 0.0001 > parseFloat(rawBalance))
          }
          onClick={handleDeposit}
          className="w-full bg-[#8759ff] hover:bg-[#7c4dff] text-white font-semibold py-3 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDepositing ? (
            <span className="flex items-center justify-center space-x-2">
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Processing...</span>
            </span>
          ) : (
            `Deposit ${depositAmount || '—'} ${depositAsset}`
          )}
        </Button>

        {/* Success Message */}
        {hasSuccessfulDeposit && recentDepositHash && (
          <div className="bg-green-900/20 border border-green-500/50 rounded-lg p-3 space-y-2">
            <p className="text-green-400 text-sm font-semibold">Deposit Successful!</p>
            <p className="text-green-300 text-xs">
              Your deposit has been initiated. Funds will appear once the transaction confirms.
            </p>
            <a
              className="text-green-400 hover:text-green-300 text-xs underline block"
              target="_blank"
              rel="noopener noreferrer"
              href={`${explorerBaseUrl}/tx/${recentDepositHash}`}
            >
              View transaction on BaseScan →
            </a>
          </div>
        )}

        {/* Error Message */}
        {depositError && (
          <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-3">
            <p className="text-red-400 text-sm font-semibold">Deposit Failed</p>
            <p className="text-red-300 text-xs mt-1">{depositError}</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

