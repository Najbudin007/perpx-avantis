'use client'

import React, { useState, useCallback } from 'react'
import { Button } from './button'
import { useToast } from './toast'
import { useAuth } from '@/lib/auth/AuthContext'

interface QuickActionsProps {
  position: {
    coin?: string
    symbol?: string
    pair_index?: number
    index?: number
    takeProfit?: number | null
    stopLoss?: number | null
  }
  onClose?: () => void
  onUpdate?: () => void
  className?: string
}

export function QuickActions({ position, onClose, onUpdate, className = '' }: QuickActionsProps) {
  const { addToast } = useToast()
  const { token } = useAuth()
  const [isClosing, setIsClosing] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [showTpSlForm, setShowTpSlForm] = useState(false)
  const [newTp, setNewTp] = useState('')
  const [newSl, setNewSl] = useState('')

  const handleClose = useCallback(async () => {
    if (!position.pair_index && position.pair_index !== 0) {
      addToast({
        type: 'error',
        title: 'Cannot close position',
        message: 'Position pair_index is missing. Cannot close position.',
      })
      return
    }

    if (!token) {
      addToast({
        type: 'error',
        title: 'Authentication required',
        message: 'Please log in to close positions',
      })
      return
    }

    setIsClosing(true)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      const response = await fetch('/api/close-position', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          pair_index: position.pair_index,
          symbol: position.symbol || position.coin,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const result = await response.json()
      
      if (result.success) {
        addToast({
          type: 'success',
          title: 'Position closed',
          message: `Position ${position.symbol || position.coin} closed successfully`,
        })
        onClose?.()
      } else {
        throw new Error(result.error || 'Failed to close position')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to close position'
      addToast({
        type: 'error',
        title: 'Close failed',
        message: errorMessage,
      })
    } finally {
      setIsClosing(false)
    }
  }, [position, onClose, addToast])

  const handleUpdateTpSl = useCallback(async () => {
    if (!position.pair_index && position.pair_index !== 0) {
      addToast({
        type: 'error',
        title: 'Cannot update TP/SL',
        message: 'Position pair_index is missing. Cannot update TP/SL.',
      })
      return
    }

    if (!newTp && !newSl) {
      addToast({
        type: 'warning',
        title: 'No values provided',
        message: 'Please provide at least one of Take Profit or Stop Loss',
      })
      return
    }

    if (!token) {
      addToast({
        type: 'error',
        title: 'Authentication required',
        message: 'Please log in to update TP/SL',
      })
      return
    }

    setIsUpdating(true)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      const response = await fetch('/api/update-tpsl', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pair_index: position.pair_index,
          new_tp: newTp ? parseFloat(newTp) : null,
          new_sl: newSl ? parseFloat(newSl) : null,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const result = await response.json()
      
      if (result.success) {
        addToast({
          type: 'success',
          title: 'TP/SL updated',
          message: `Take Profit and Stop Loss updated successfully`,
        })
        setShowTpSlForm(false)
        setNewTp('')
        setNewSl('')
        onUpdate?.()
      } else {
        throw new Error(result.error || 'Failed to update TP/SL')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update TP/SL'
      addToast({
        type: 'error',
        title: 'Update failed',
        message: errorMessage,
      })
    } finally {
      setIsUpdating(false)
    }
  }, [position, newTp, newSl, onUpdate, addToast, token])

  return (
    <div className={`flex flex-col gap-2 max-w-full overflow-hidden ${className}`}>
      {!showTpSlForm ? (
        <>
          <Button
            onClick={handleClose}
            disabled={isClosing || isUpdating}
            className="bg-red-600 hover:bg-red-700 text-white text-sm py-1.5 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isClosing ? (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Closing...
              </span>
            ) : (
              'Close'
            )}
          </Button>
          <Button
            onClick={() => setShowTpSlForm(true)}
            disabled={isClosing || isUpdating}
            className="bg-[#8759ff] hover:bg-[#7C3AED] text-white text-sm py-1.5 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Update TP/SL
          </Button>
        </>
      ) : (
        <div className="space-y-2 p-3 bg-[#1f2937] border border-[#374151] rounded-lg max-w-full overflow-hidden">
          <div className="space-y-2 min-w-0">
            <div className="min-w-0">
              <label className="block text-xs text-[#9ca3af] mb-1 truncate">Take Profit</label>
              <input
                type="number"
                value={newTp}
                onChange={(e) => setNewTp(e.target.value)}
                placeholder={position.takeProfit?.toString() || 'Enter TP'}
                className="w-full bg-[#2a2a2a] border border-[#444] text-white text-sm rounded px-2 py-1 min-w-0"
                style={{ maxWidth: '100%' }}
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-[#9ca3af] mb-1 truncate">Stop Loss</label>
              <input
                type="number"
                value={newSl}
                onChange={(e) => setNewSl(e.target.value)}
                placeholder={position.stopLoss?.toString() || 'Enter SL'}
                className="w-full bg-[#2a2a2a] border border-[#444] text-white text-sm rounded px-2 py-1 min-w-0"
                style={{ maxWidth: '100%' }}
              />
            </div>
          </div>
          <div className="flex gap-2 min-w-0">
            <Button
              onClick={handleUpdateTpSl}
              disabled={isUpdating || isClosing}
              className="flex-1 bg-[#8759ff] hover:bg-[#7C3AED] text-white text-sm py-1.5 disabled:opacity-50 min-w-0"
              style={{ maxWidth: '100%' }}
            >
              {isUpdating ? (
                <span className="flex items-center justify-center gap-2 truncate">
                  <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="truncate">Updating...</span>
                </span>
              ) : (
                <span className="truncate">Update</span>
              )}
            </Button>
            <Button
              onClick={() => {
                setShowTpSlForm(false)
                setNewTp('')
                setNewSl('')
              }}
              disabled={isUpdating || isClosing}
              className="bg-[#2a2a2a] hover:bg-[#374151] text-white text-sm py-1.5 px-3 disabled:opacity-50 flex-shrink-0"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
