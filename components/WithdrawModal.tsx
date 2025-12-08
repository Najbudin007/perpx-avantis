"use client"

import { useState, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Modal } from "@/components/ui/modal"

interface WithdrawModalProps {
  isOpen: boolean
  onClose: () => void
  onWithdraw: (params: { amount: string; recipientAddress: string }) => Promise<void>
  isWithdrawing: boolean
  withdrawError: string | null
  recentWithdrawHash: string | null
  tradingWalletAddress: string | null
  avantisBalance: number
}

export function WithdrawModal({
  isOpen,
  onClose,
  onWithdraw,
  isWithdrawing,
  withdrawError,
  recentWithdrawHash,
  tradingWalletAddress,
  avantisBalance
}: WithdrawModalProps) {
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [recipientAddress, setRecipientAddress] = useState('')
  const [hasSuccessfulWithdraw, setHasSuccessfulWithdraw] = useState(false)
  const [addressError, setAddressError] = useState<string | null>(null)
  
  const explorerBaseUrl = process.env.NEXT_PUBLIC_AVANTIS_NETWORK === 'base-testnet'
    ? 'https://sepolia.basescan.org'
    : 'https://basescan.org'

  useEffect(() => {
    if (recentWithdrawHash) {
      setHasSuccessfulWithdraw(true)
    }
  }, [recentWithdrawHash])

  useEffect(() => {
    if (withdrawError) {
      setHasSuccessfulWithdraw(false)
    }
  }, [withdrawError])

  // Validate Ethereum address
  const validateAddress = (address: string): boolean => {
    if (!address) {
      setAddressError(null)
      return false
    }
    // Basic Ethereum address validation
    const isValid = /^0x[a-fA-F0-9]{40}$/.test(address)
    if (!isValid) {
      setAddressError('Invalid wallet address')
    } else {
      setAddressError(null)
    }
    return isValid
  }

  const handleWithdraw = async () => {
    if (!withdrawAmount || !recipientAddress) return
    
    const withdrawValue = parseFloat(withdrawAmount)
    if (isNaN(withdrawValue) || withdrawValue <= 0) {
      return
    }
    
    if (withdrawValue > avantisBalance) {
      return
    }
    
    if (!validateAddress(recipientAddress)) {
      return
    }
    
    await onWithdraw({ amount: withdrawAmount, recipientAddress })
  }

  const handleSetMax = () => {
    setWithdrawAmount(avantisBalance.toFixed(2))
  }

  const handleClose = () => {
    setWithdrawAmount('')
    setRecipientAddress('')
    setHasSuccessfulWithdraw(false)
    setAddressError(null)
    onClose()
  }

  const withdrawAmountNum = parseFloat(withdrawAmount) || 0
  const isAmountValid = withdrawAmountNum > 0 && withdrawAmountNum <= avantisBalance
  const isAddressValid = /^0x[a-fA-F0-9]{40}$/.test(recipientAddress)
  const canWithdraw = isAmountValid && isAddressValid && !isWithdrawing

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      {/* Fixed Header with Close button */}
      <div className="flex items-center justify-between p-4 sm:p-6 pb-0 sticky top-0 bg-[#1a1a1a] z-10">
        <div className="flex items-center space-x-2">
          <div className="w-10 h-10 bg-[#8759ff] rounded-xl flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white">
              <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h3 className="text-white font-semibold text-xl">Withdraw</h3>
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
          Withdraw from your available balance to any wallet address.
        </p>

        {/* Success State */}
        {hasSuccessfulWithdraw && recentWithdrawHash && (
          <div className="bg-green-900/20 border border-green-500/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-green-400">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-green-400 font-semibold">Withdrawal Successful!</span>
              </div>
              <a
                href={`${explorerBaseUrl}/tx/${recentWithdrawHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#8759ff] text-sm hover:underline flex items-center gap-1"
              >
                View on Explorer
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </a>
            </div>
          )}

        {/* Error State */}
        {withdrawError && (
          <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-3">
            <p className="text-red-400 text-sm">{withdrawError}</p>
          </div>
        )}

        {/* Available Balance */}
        <div className="bg-[#0d0d0d] rounded-xl p-4">
            <p className="text-[#9ca3af] text-xs mb-1">Available balance</p>
            <div className="flex items-center gap-2">
              <span className="text-white text-2xl sm:text-3xl font-bold">${avantisBalance.toFixed(2)}</span>
              <button
                onClick={() => {/* Toggle visibility if needed */}}
                className="text-[#9ca3af] hover:text-white transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                </svg>
              </button>
            </div>
            <p className="text-[#9ca3af] text-xs mt-1">This balance is withdrawable.</p>
          </div>

        {/* Recipient Address */}
        <div>
            <label className="block text-[#9ca3af] text-sm font-medium mb-2">
              Recipient wallet address
            </label>
            <div className="relative">
              <Input
                type="text"
                value={recipientAddress}
                onChange={(e) => {
                  setRecipientAddress(e.target.value)
                  validateAddress(e.target.value)
                }}
                className={`bg-[#0d0d0d] border-[#333] text-white pr-10 ${addressError ? 'border-red-500' : ''}`}
                placeholder="Paste wallet address here..."
              />
              <button 
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-white"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText()
                    setRecipientAddress(text)
                    validateAddress(text)
                  } catch (err) {
                    // Clipboard access denied
                  }
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="2"/>
                </svg>
              </button>
            </div>
            {addressError && (
              <p className="text-red-400 text-xs mt-1">{addressError}</p>
            )}
            <p className="text-[#666] text-xs mt-1">Ensure the address is correct. Withdrawals cannot be reversed.</p>
          </div>

        {/* Withdraw Amount */}
        <div>
            <label className="block text-[#9ca3af] text-sm font-medium mb-2">
              Withdraw amount
            </label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]">$</div>
              <Input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className={`bg-[#0d0d0d] border-[#333] text-white pl-7 pr-16 ${
                  withdrawAmountNum > avantisBalance ? 'border-red-500' : ''
                }`}
                placeholder="0.00"
                min="0"
                max={avantisBalance}
                step="0.01"
              />
              <button
                onClick={handleSetMax}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8759ff] hover:text-[#7C3AED] text-sm font-medium"
              >
                MAX
              </button>
            </div>
            {withdrawAmountNum > avantisBalance && (
              <p className="text-red-400 text-xs mt-1">Amount exceeds available balance</p>
            )}
          </div>

        {/* Quick Amount Buttons */}
        <div className="grid grid-cols-4 gap-2">
            {[25, 50, 75, 100].map((percent) => (
              <button
                key={percent}
                onClick={() => setWithdrawAmount(((avantisBalance * percent) / 100).toFixed(2))}
                className="py-2 px-3 rounded-lg bg-[#0d0d0d] border border-[#333] text-[#9ca3af] hover:border-[#8759ff] hover:text-white transition-colors text-sm"
              >
                {percent}%
              </button>
            ))}
          </div>

        {/* Withdraw Button */}
        <Button
          onClick={handleWithdraw}
          disabled={!canWithdraw}
          className="w-full bg-[#8759ff] hover:bg-[#7C3AED] text-white font-semibold py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isWithdrawing ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
              </svg>
              Processing...
            </span>
          ) : (
            `Withdraw $${withdrawAmountNum > 0 ? withdrawAmountNum.toFixed(2) : '0.00'}`
          )}
        </Button>

        {/* Trading Wallet Info */}
        {tradingWalletAddress && (
          <div className="pt-4 border-t border-[#262626]">
            <p className="text-[#666] text-xs text-center">
              Withdrawing from: {tradingWalletAddress.slice(0, 6)}...{tradingWalletAddress.slice(-4)}
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

