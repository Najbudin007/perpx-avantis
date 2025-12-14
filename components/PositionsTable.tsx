"use client"

import { useState, useEffect, useMemo } from 'react'
import type { Position } from '@/types/trading'
import { useLivePrices } from '@/lib/hooks/useLivePrices'
import { useAuth } from '@/lib/auth/AuthContext'
import { useToast } from '@/components/ui/toast'

interface PositionsTableProps {
  positions: Position[]
  isLoading?: boolean
  onClosePosition?: (position: Position) => Promise<void>
  onEditPosition?: (position: Position) => void
  hasStaleData?: boolean // Indicates we have stale data (background refresh in progress)
}

// Helper function to calculate PnL from price update (matches backend logic)
function calculatePnL(
  entryPrice: number,
  currentPrice: number,
  positionSize: number,
  collateral: number,
  leverage: number,
  isLong: boolean
): { pnl: number; roe: number } {
  if (entryPrice <= 0 || positionSize <= 0 || collateral <= 0) {
    return { pnl: 0, roe: 0 };
  }

  // Calculate price difference percentage
  const priceDiffPct = (currentPrice - entryPrice) / entryPrice;
  // Reverse for shorts
  const adjustedPriceDiff = isLong ? priceDiffPct : -priceDiffPct;
  
  // PnL calculation: price_diff_pct * position_size (matches backend)
  const pnl = adjustedPriceDiff * positionSize;
  
  // ROE = (PnL / Collateral) * 100 (matches backend)
  const roe = (pnl / collateral) * 100;

  return { pnl, roe };
}

// Edit TP/SL Modal Component
function EditTPSLModal({ 
  position, 
  isOpen, 
  onClose,
  onSave 
}: { 
  position: Position | null
  isOpen: boolean
  onClose: () => void
  onSave?: (tp: number | null, sl: number | null) => void
}) {
  const [activeTab, setActiveTab] = useState<'tpsl' | 'collateral'>('tpsl')
  const [slPrice, setSlPrice] = useState('')
  const [tpPrice, setTpPrice] = useState('')
  const [slPercent, setSlPercent] = useState('14.19')
  const [tpPercent, setTpPercent] = useState('23.18')
  
  // Get live prices for real-time updates
  const symbols = position ? [position.coin] : []
  const { prices } = useLivePrices(symbols, isOpen)
  const currentPrice = position && prices[position.coin] ? prices[position.coin] : position?.markPrice || 0
  
  // Initialize state when position changes
  useEffect(() => {
    if (position) {
      setSlPrice(position.stopLoss ? position.stopLoss.toString() : '')
      setTpPrice(position.takeProfit ? position.takeProfit.toString() : '')
    }
  }, [position])
  
  if (!isOpen || !position) return null
  
  const leverageNum = typeof position.leverage === 'string' ? parseFloat(position.leverage) : position.leverage
  
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#1a1a1a] rounded-xl w-full max-w-md border border-[#374151] max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 pb-0">
          <h2 className="text-white text-xl font-semibold mb-4">Adjust Position</h2>
          
          {/* Tabs */}
          <div className="flex border-b border-[#374151]">
            <button 
              onClick={() => setActiveTab('tpsl')}
              className={`px-6 py-3 text-sm font-medium ${
                activeTab === 'tpsl' 
                  ? 'text-white bg-[#2a2a2a] border-b-2 border-white' 
                  : 'text-[#9ca3af]'
              }`}
            >
              TP/SL
            </button>
            <button 
              onClick={() => setActiveTab('collateral')}
              className={`px-6 py-3 text-sm font-medium ${
                activeTab === 'collateral' 
                  ? 'text-white bg-[#2a2a2a] border-b-2 border-white' 
                  : 'text-[#9ca3af]'
              }`}
            >
              Collateral
            </button>
          </div>
        </div>
        
        {/* Position Info */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          <div className="bg-[#2a2a2a] rounded-lg p-4 mb-6 min-w-0">
            <div className="flex justify-between items-start gap-4">
              <div className="min-w-0 flex-1">
                <span className={`text-sm font-medium ${
                  position.side === 'long' ? 'text-[#27c47d]' : 'text-[#ef4444]'
                }`}>
                  {position.side.toUpperCase()} {leverageNum}x
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-white font-medium truncate">{position.coin}</span>
                  <span className="text-[#f7931a] flex-shrink-0">₿</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[#9ca3af] text-sm">Open price</div>
                <div className="text-white text-sm whitespace-nowrap">{position.entryPrice.toLocaleString()}</div>
                <div className="text-[#9ca3af] text-sm mt-2">Current price</div>
                <div className="text-white text-sm whitespace-nowrap">{position.markPrice.toLocaleString()}</div>
              </div>
            </div>
          </div>
          
          {activeTab === 'tpsl' && (
            <>
              {/* Stop Loss */}
              <div className="mb-6">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[#ef4444] text-sm font-medium">
                    Stop Loss <span className="text-[#ef4444]">-1.42 USDC</span>
                  </span>
                  <button className="text-[#60a5fa] text-sm hover:underline">Cancel</button>
                </div>
                <div className="flex gap-2 min-w-0">
                  <input
                    type="number"
                    value={slPrice}
                    onChange={(e) => setSlPrice(e.target.value)}
                    placeholder="SL Price"
                    className="flex-1 bg-[#2a2a2a] border border-[#374151] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#60a5fa] min-w-0"
                    style={{ maxWidth: '100%' }}
                  />
                  <div className="flex items-center bg-[#2a2a2a] border border-[#374151] rounded-lg px-4 py-3 gap-2 flex-shrink-0">
                    <input
                      type="number"
                      value={slPercent}
                      onChange={(e) => setSlPercent(e.target.value)}
                      className="w-16 bg-transparent text-white text-right focus:outline-none"
                    />
                    <span className="text-[#9ca3af]">%</span>
                    <div className="flex flex-col">
                      <button className="text-[#9ca3af] hover:text-white text-xs">▲</button>
                      <button className="text-[#9ca3af] hover:text-white text-xs">▼</button>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Take Profit */}
              <div className="mb-6">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[#27c47d] text-sm font-medium">
                    Take Profit <span className="text-[#27c47d]">2.31 USDC</span>
                  </span>
                  <button className="text-[#60a5fa] text-sm hover:underline">Cancel</button>
                </div>
                <div className="flex gap-2 min-w-0">
                  <input
                    type="number"
                    value={tpPrice}
                    onChange={(e) => setTpPrice(e.target.value)}
                    placeholder="TP Price"
                    className="flex-1 bg-[#2a2a2a] border border-[#374151] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#60a5fa] min-w-0"
                    style={{ maxWidth: '100%' }}
                  />
                  <div className="flex items-center bg-[#2a2a2a] border border-[#374151] rounded-lg px-4 py-3 gap-2 flex-shrink-0">
                    <input
                      type="number"
                      value={tpPercent}
                      onChange={(e) => setTpPercent(e.target.value)}
                      className="w-16 bg-transparent text-white text-right focus:outline-none"
                    />
                    <span className="text-[#9ca3af]">%</span>
                    <div className="flex flex-col">
                      <button className="text-[#9ca3af] hover:text-white text-xs">▲</button>
                      <button className="text-[#9ca3af] hover:text-white text-xs">▼</button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
          
          {activeTab === 'collateral' && (
            <div className="text-[#9ca3af] text-center py-8">
              Collateral adjustment coming soon
            </div>
          )}
        </div>
        
        {/* Actions */}
        <div className="p-6 pt-0 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-[#374151] hover:bg-[#4b5563] text-white font-medium py-3 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave?.(
                tpPrice ? parseFloat(tpPrice) : null,
                slPrice ? parseFloat(slPrice) : null
              )
              onClose()
            }}
            className="flex-1 bg-[#c8ff00] hover:bg-[#b3e600] text-black font-medium py-3 rounded-lg transition-colors"
          >
            Edit TP/SL
          </button>
        </div>
      </div>
    </div>
  )
}

// Close Position Confirmation Modal
function ClosePositionModal({
  position,
  isOpen,
  onClose,
  onConfirm,
  isClosing
}: {
  position: Position | null
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  isClosing: boolean
}) {
  if (!isOpen || !position) return null
  
  const leverageNum = typeof position.leverage === 'string' ? parseFloat(position.leverage) : position.leverage
  const positionSize = position.positionValue || (position.collateral ? position.collateral * leverageNum : 0)
  const pnlValue = position.pnl || 0
  const isProfit = pnlValue >= 0
  
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] rounded-xl w-full max-w-md border border-[#374151] p-6">
        <h2 className="text-white text-xl font-semibold mb-4">Close Position</h2>
        
        <div className="bg-[#2a2a2a] rounded-lg p-4 mb-6">
          <div className="flex justify-between mb-2">
            <span className="text-[#9ca3af]">Position</span>
            <span className="text-white">{position.coin} {position.side.toUpperCase()} {leverageNum}x</span>
          </div>
          <div className="flex justify-between mb-2">
            <span className="text-[#9ca3af]">Size</span>
            <span className="text-white">{positionSize.toFixed(2)} USDC</span>
          </div>
          <div className="flex justify-between mb-2">
            <span className="text-[#9ca3af]">Entry Price</span>
            <span className="text-white">${position.entryPrice.toLocaleString()}</span>
          </div>
          <div className="flex justify-between mb-2">
            <span className="text-[#9ca3af]">Current Price</span>
            <span className="text-white">${position.markPrice.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#9ca3af]">Est. PnL</span>
            <span className={isProfit ? 'text-[#27c47d]' : 'text-[#ef4444]'}>
              {isProfit ? '+' : ''}{pnlValue.toFixed(2)} USDC
            </span>
          </div>
        </div>
        
        <p className="text-[#9ca3af] text-sm mb-6">
          Are you sure you want to close this position at market price?
        </p>
        
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isClosing}
            className="flex-1 bg-[#374151] hover:bg-[#4b5563] text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isClosing}
            className="flex-1 bg-[#ef4444] hover:bg-[#dc2626] text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50"
          >
            {isClosing ? 'Closing...' : 'Close Position'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function PositionsTable({ positions, isLoading = false, onClosePosition, onEditPosition, hasStaleData = false }: PositionsTableProps) {
  const [editingPosition, setEditingPosition] = useState<Position | null>(null)
  const [closingPosition, setClosingPosition] = useState<Position | null>(null)
  const [isClosing, setIsClosing] = useState(false)
  const [isUpdatingTPSL, setIsUpdatingTPSL] = useState(false)
  const { token } = useAuth()
  const { addToast } = useToast()
  
  // Extract unique symbols from positions for price polling
  const symbols = useMemo(() => {
    return positions.map(p => p.coin || p.symbol || '').filter(Boolean);
  }, [positions]);
  
  // Fetch live prices separately (lightweight, doesn't refresh entire table)
  const { prices: livePrices } = useLivePrices(symbols, positions.length > 0, 5000); // Poll every 5 seconds
  
  // Merge live prices into positions for display (only update price/PnL, not whole row)
  const positionsWithLivePrices = useMemo(() => {
    return positions.map(position => {
      const symbol = (position.coin || position.symbol || '').toUpperCase();
      const livePrice = livePrices[symbol];
      
      // If we have a live price AND it's different from current markPrice, update it
      if (livePrice && livePrice > 0 && Math.abs(livePrice - position.markPrice) > 0.01) {
        const leverageNum = typeof position.leverage === 'string' 
          ? parseFloat(position.leverage) 
          : position.leverage;
        const positionSize = position.positionValue || 
          (position.collateral ? position.collateral * leverageNum : 0);
        const collateral = position.collateral || (positionSize / leverageNum);
        const isLong = position.side === 'long';
        
        const { pnl, roe } = calculatePnL(
          position.entryPrice,
          livePrice,
          positionSize,
          collateral,
          leverageNum,
          isLong
        );
        
        return {
          ...position,
          markPrice: livePrice, // Update current price
          pnl: pnl, // Update PnL
          roe: roe, // Update ROE
        };
      }
      
      // Return original if no live price available or price hasn't changed
      return position;
    });
  }, [positions, livePrices]);
  
  const handleClosePosition = async () => {
    if (!closingPosition || !onClosePosition) return
    
    setIsClosing(true)
    try {
      await onClosePosition(closingPosition)
      setClosingPosition(null)
      addToast({
        type: 'success',
        title: 'Position Closed',
        message: `Successfully closed ${closingPosition.coin || closingPosition.symbol} position`,
      })
    } catch (error) {
      console.error('Failed to close position:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to close position'
      addToast({
        type: 'error',
        title: 'Close Failed',
        message: errorMessage,
      })
    } finally {
      setIsClosing(false)
    }
  }
  
  const handleUpdateTPSL = async (tp: number | null, sl: number | null) => {
    if (!editingPosition || !token) return
    
    console.log('[PositionsTable] Updating TP/SL:', {
      position: editingPosition.coin,
      pair_index: editingPosition.pair_index,
      tp,
      sl
    })
    
    setIsUpdatingTPSL(true)
    try {
      const response = await fetch('/api/update-tpsl', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pair_index: editingPosition.pair_index,
          new_tp: tp,
          new_sl: sl
        })
      })
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to update TP/SL' }))
        throw new Error(error.error || 'Failed to update TP/SL')
      }
      
      console.log('[PositionsTable] TP/SL updated successfully')
      setEditingPosition(null)
      
      addToast({
        type: 'success',
        title: 'TP/SL Updated',
        message: 'Take Profit and Stop Loss updated successfully',
      })
      
      // Refresh positions after update by dispatching event
      // This works in both web and Farcaster app
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('position-updated'))
        // Also call parent callback if provided
        if (onEditPosition) {
          onEditPosition(editingPosition)
        }
      }, 500)
    } catch (error) {
      console.error('[PositionsTable] Failed to update TP/SL:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to update TP/SL'
      addToast({
        type: 'error',
        title: 'Update Failed',
        message: errorMessage,
      })
    } finally {
      setIsUpdatingTPSL(false)
    }
  }
  
  if (isLoading) {
    return (
      <div className="bg-[#1a1a1a] rounded-lg overflow-hidden">
        <div className="animate-pulse">
          <div className="h-10 bg-[#2a2a2a] border-b border-[#374151]"></div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-[#1a1a1a] border-b border-[#262626]"></div>
          ))}
        </div>
      </div>
    )
  }
  
  // 🛑 STALE-WHILE-REVALIDATE: Only show empty state if we truly have no positions
  // AND we're not in a background refresh (hasStaleData means keep showing last known data)
  // If hasStaleData is true, we should never show empty state - the hook should preserve positions
  if (positions.length === 0 && !hasStaleData && !isLoading) {
    return (
      <div className="bg-[#1a1a1a] rounded-lg p-8 text-center">
        <div className="w-16 h-16 bg-[#2a2a2a] rounded-full flex items-center justify-center mx-auto mb-4">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[#9ca3af]">
            <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h3 className="text-white font-semibold text-lg mb-2">No Open Positions</h3>
        <p className="text-[#9ca3af] text-sm">
          Your active positions will appear here once opened
        </p>
      </div>
    )
  }
  
  // 🛑 STALE-WHILE-REVALIDATE: If we have stale data flag but empty positions array,
  // this should never happen (hook should preserve positions), but as a safety net,
  // show a stable placeholder instead of empty state to prevent flicker
  if (positions.length === 0 && hasStaleData) {
    // This is a safety net - the hook should never let this happen
    // But if it does, show stable placeholder instead of empty state
    console.warn('[PositionsTable] hasStaleData=true but positions array is empty - this should not happen');
    return (
      <div className="bg-[#1a1a1a] rounded-lg overflow-hidden">
        <div className="h-10 bg-[#2a2a2a] border-b border-[#374151]"></div>
        {/* Stable placeholder - prevents flicker during background refresh */}
      </div>
    )
  }
  
  return (
    <>
      <div className="bg-[#1a1a1a] rounded-lg overflow-hidden">
        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            {/* Header - matching Avantis design */}
            <thead>
              <tr className="border-b border-[#374151] bg-[#1a1a1a]">
                <th className="px-4 py-3 text-left text-xs font-medium text-[#9ca3af] uppercase">Pair</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#9ca3af] uppercase">Pos Size</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#9ca3af] uppercase">Collateral</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#9ca3af] uppercase">Open Price</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#9ca3af] uppercase">Current/Liq Price</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#9ca3af] uppercase">TP/SL</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#9ca3af] uppercase">Gross PNL</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#9ca3af] uppercase">Action</th>
              </tr>
            </thead>
            
            {/* Body */}
            <tbody>
              {positionsWithLivePrices.map((position, index) => {
                const leverageNum = typeof position.leverage === 'string' ? parseFloat(position.leverage) : position.leverage
                const positionSize = position.positionValue || (position.collateral ? position.collateral * leverageNum : 0)
                const pnlValue = position.pnl || 0
                const pnlPercentage = position.roe || 0
                const isProfit = pnlValue >= 0
                const slPrice = position.stopLoss || null
                const tpPrice = position.takeProfit || null
                
                // Calculate BTC amount if BTC position
                const btcAmount = position.coin === 'BTC' && position.entryPrice > 0 
                  ? (positionSize / position.entryPrice).toFixed(8)
                  : null
                
                return (
                  <tr key={`${position.coin}-${index}`} className="border-b border-[#262626] hover:bg-[#2a2a2a]/50 transition-colors">
                    {/* Pair */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#f7931a] flex items-center justify-center">
                          <span className="text-white font-bold text-xs">₿</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-white font-medium">{position.coin}USD</span>
                            <span className="text-[#f7931a]">₿</span>
                            <span className="text-[#9ca3af] text-xs">Perp</span>
                          </div>
                          <span className={`text-xs font-medium ${
                            position.side === 'long' ? 'text-[#27c47d]' : 'text-[#ef4444]'
                          }`}>
                            {position.side.charAt(0).toUpperCase() + position.side.slice(1)} {leverageNum}x
                          </span>
                        </div>
                      </div>
                    </td>
                    
                    {/* Pos Size */}
                    <td className="px-4 py-4">
                      <div className="text-white">{positionSize.toFixed(2)} USDC</div>
                      {btcAmount && (
                        <div className="text-[#9ca3af] text-xs">{btcAmount} BTC</div>
                      )}
                    </td>
                    
                    {/* Collateral */}
                    <td className="px-4 py-4">
                      <span className="text-white">
                        {position.collateral !== undefined ? `${position.collateral.toFixed(2)} USDC` : 'N/A'}
                      </span>
                    </td>
                    
                    {/* Open Price */}
                    <td className="px-4 py-4">
                      <span className="text-white">{position.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 1 })}</span>
                    </td>
                    
                    {/* Current/Liq Price */}
                    <td className="px-4 py-4">
                      <div className="text-white">{position.markPrice.toLocaleString(undefined, { minimumFractionDigits: 1 })}</div>
                      <div className="text-[#9ca3af] text-xs">
                        {position.liquidationPrice && position.liquidationPrice > 0 
                          ? position.liquidationPrice.toLocaleString(undefined, { minimumFractionDigits: 1 })
                          : 'N/A'}
                      </div>
                    </td>
                    
                    {/* TP/SL */}
                    <td className="px-4 py-4">
                      <div className="text-[#27c47d] text-sm">
                        TP: {tpPrice ? tpPrice.toLocaleString(undefined, { minimumFractionDigits: 1 }) : '-'}
                      </div>
                      <div className="text-[#ef4444] text-sm">
                        SL: {slPrice ? slPrice.toLocaleString(undefined, { minimumFractionDigits: 1 }) : '-'}
                      </div>
                    </td>
                    
                    {/* Gross PNL */}
                    <td className="px-4 py-4">
                      <div className={isProfit ? 'text-[#27c47d]' : 'text-[#ef4444]'}>
                        {isProfit ? '+' : ''}{pnlValue.toFixed(2)}
                      </div>
                      <div className={`text-xs ${isProfit ? 'text-[#27c47d]' : 'text-[#ef4444]'}`}>
                        {isProfit ? '+' : ''}{pnlPercentage.toFixed(2)}%
                      </div>
                    </td>
                    
                    {/* Action Buttons */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        {/* Edit TP/SL Button */}
                        <button
                          onClick={() => setEditingPosition(position)}
                          className="w-8 h-8 bg-[#2a2a2a] hover:bg-[#374151] rounded-lg flex items-center justify-center transition-colors group"
                          title="Edit TP/SL"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-[#9ca3af] group-hover:text-white">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        
                        {/* Close Position Button */}
                        <button
                          onClick={() => setClosingPosition(position)}
                          className="w-8 h-8 bg-[#2a2a2a] hover:bg-[#ef4444] rounded-lg flex items-center justify-center transition-colors group"
                          title="Close Position"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-[#9ca3af] group-hover:text-white">
                            <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Modals */}
      <EditTPSLModal
        position={editingPosition}
        isOpen={!!editingPosition}
        onClose={() => setEditingPosition(null)}
        onSave={handleUpdateTPSL}
      />
      
      <ClosePositionModal
        position={closingPosition}
        isOpen={!!closingPosition}
        onClose={() => setClosingPosition(null)}
        onConfirm={handleClosePosition}
        isClosing={isClosing}
      />
    </>
  )
}
