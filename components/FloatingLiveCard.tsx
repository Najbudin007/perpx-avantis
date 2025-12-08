"use client"

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { usePositions } from '@/lib/hooks/usePositions'
import { useTradingSession } from '@/lib/hooks/useTradingSession'
import { LiveTradingLogModal } from './LiveTradingLogModal'

interface FloatingLiveCardProps {
  position?: {
    right: number
    bottom: number
  }
}

export function FloatingLiveCard({ position = { right: 16, bottom: 80 } }: FloatingLiveCardProps) {
  const { positionData } = usePositions()
  const { tradingSession } = useTradingSession()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isVisible, setIsVisible] = useState(true)
  
  // Hide if no active session
  if (!tradingSession || tradingSession.status !== 'running') {
    return null
  }
  
  if (!isVisible) return null
  
  return (
    <>
      {/* Floating Card */}
      <div
        className="fixed z-40 transition-all duration-200 hover:scale-105 cursor-pointer"
        style={{
          right: `${position.right}px`,
          bottom: `${position.bottom}px`,
        }}
        onClick={() => setIsModalOpen(true)}
      >
        <Card className="bg-[#1a1a1a] border-[#262626] p-3 shadow-2xl hover:shadow-[#8759ff]/20 min-w-[200px]">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-[#27c47d] rounded-full animate-pulse"></div>
              <span className="text-white text-sm font-semibold">Live Trading</span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsVisible(false)
              }}
              className="text-[#6b7280] hover:text-white transition-colors p-1"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          
          {/* Bot Status */}
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#9ca3af]">Session:</span>
              <span className="text-white font-mono">
                {tradingSession.sessionId?.slice(-6) || 'Active'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#9ca3af]">Positions:</span>
              <span className="text-white font-semibold">
                {positionData?.openPositions || 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#9ca3af]">PnL:</span>
              <span className={`font-semibold ${
                (positionData?.totalPnL || 0) >= 0 ? 'text-[#27c47d]' : 'text-[#ef4444]'
              }`}>
                ${(positionData?.totalPnL || 0).toFixed(2)}
              </span>
            </div>
          </div>
          
          {/* Recent Activity Indicator */}
          <div className="mt-2 pt-2 border-t border-[#262626]">
            <div className="flex items-center space-x-1">
              <div className="w-1 h-1 bg-[#8759ff] rounded-full animate-pulse"></div>
              <div className="w-1 h-1 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
              <div className="w-1 h-1 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
              <span className="text-[#9ca3af] text-[10px] ml-1">Monitoring markets</span>
            </div>
          </div>
        </Card>
      </div>
      
      {/* Live Trading Log Modal */}
      <LiveTradingLogModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  )
}
