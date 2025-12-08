"use client"

import { Modal } from '@/components/ui/modal'
import { Card } from '@/components/ui/card'
import { usePositions } from '@/lib/hooks/usePositions'
import { useTradingSession } from '@/lib/hooks/useTradingSession'
import { useEffect } from 'react'

interface LiveTradingLogModalProps {
  isOpen: boolean
  onClose: () => void
}

export function LiveTradingLogModal({ isOpen, onClose }: LiveTradingLogModalProps) {
  const { positionData, isLoading, fetchPositions } = usePositions()
  const { tradingSession, refreshSessionStatus } = useTradingSession()
  
  // Auto-refresh every 5 seconds when modal is open
  useEffect(() => {
    if (!isOpen) return
    
    const interval = setInterval(() => {
      fetchPositions()
      refreshSessionStatus(false)
    }, 5000)
    
    return () => clearInterval(interval)
  }, [isOpen, fetchPositions, refreshSessionStatus])
  
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      {/* Modal Header */}
      <div className="flex items-center justify-between p-4 sm:p-6 pb-0 border-b border-[#262626]">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-[#27c47d] rounded-full animate-pulse"></div>
          <h3 className="text-white font-semibold text-lg">Live Trading Log</h3>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-[#262626] text-[#9ca3af] hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      {/* Modal Body - Scrollable */}
      <div className="p-4 sm:p-6 overflow-y-auto max-h-[70vh] space-y-4">
        {/* Session Status */}
        {tradingSession && (
          <Card className="bg-[#2a2a2a] border-[#374151] p-4">
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[#9ca3af]">Session ID:</span>
                <span className="text-white font-mono text-xs">
                  {tradingSession.sessionId?.slice(0, 8) || 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#9ca3af]">Status:</span>
                <span className={`font-medium ${
                  tradingSession.status === 'running' ? 'text-[#27c47d]' : 'text-[#9ca3af]'
                }`}>
                  {tradingSession.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#9ca3af]">Current PnL:</span>
                <span className={`font-semibold ${
                  (positionData?.totalPnL || 0) >= 0 ? 'text-[#27c47d]' : 'text-[#ef4444]'
                }`}>
                  ${(positionData?.totalPnL || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#9ca3af]">Target Profit:</span>
                <span className="text-white font-semibold">
                  ${tradingSession.config?.profitGoal || '0'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#9ca3af]">Open Positions:</span>
                <span className="text-white font-semibold">
                  {positionData?.openPositions || 0}
                </span>
              </div>
            </div>
          </Card>
        )}
        
        {/* Real-time Bot Logs */}
        <Card className="bg-[#2a2a2a] border-[#374151] p-4">
          <h4 className="text-white font-medium text-sm mb-3">Bot Activity</h4>
          <div className="space-y-2 font-mono text-xs">
            {/* Monitoring Status */}
            <div className="flex items-start space-x-2">
              <span className="text-[#27c47d]">●</span>
              <span className="text-[#9ca3af]">
                Monitoring markets for entry opportunities...
              </span>
            </div>
            
            {/* Position Status */}
            {positionData && positionData.positions && positionData.positions.length > 0 ? (
              positionData.positions.map((pos, idx) => (
                <div key={idx} className="flex items-start space-x-2">
                  <span className="text-[#facc15]">◆</span>
                  <span className="text-white">
                    {pos.symbol || pos.coin} | {pos.side?.toUpperCase()} | 
                    Entry: ${pos.entryPrice?.toFixed(2)} | 
                    PnL: <span className={pos.pnl >= 0 ? 'text-[#27c47d]' : 'text-[#ef4444]'}>
                      ${pos.pnl?.toFixed(2)}
                    </span>
                  </span>
                </div>
              ))
            ) : (
              <div className="flex items-start space-x-2">
                <span className="text-[#9ca3af]">○</span>
                <span className="text-[#6b7280]">
                  No positions open. Waiting for optimal entry signals...
                </span>
              </div>
            )}
            
            {/* Indicator Analysis */}
            <div className="flex items-start space-x-2">
              <span className="text-[#8759ff]">►</span>
              <span className="text-[#9ca3af]">
                Analyzing: RSI, MACD, Volume, Market Regime...
              </span>
            </div>
          </div>
        </Card>
        
        {/* Link to Avantis Dashboard */}
        <div className="text-center">
          <a
            href="https://www.avantisfi.com/trade?asset=BTC-USD"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#8759ff] text-sm hover:text-[#7c4dff] flex items-center justify-center space-x-1"
          >
            <span>View on Avantis Dashboard</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
        </div>
      </div>
    </Modal>
  )
}
