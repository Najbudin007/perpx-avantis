"use client"

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { usePositions } from '@/lib/hooks/usePositions'
import { useTradingSession } from '@/lib/hooks/useTradingSession'
import { useTradingActivityLogs } from '@/lib/hooks/useTradingActivityLogs'
import { useIntegratedWallet } from '@/lib/wallet/IntegratedWalletContext'
import { LiveTradingLogModal } from './LiveTradingLogModal'

interface FloatingLiveCardProps {
  position?: {
    right: number
    bottom: number
  }
}

export function FloatingLiveCard({ position = { right: 16, bottom: 80 } }: FloatingLiveCardProps) {
  const { positionData } = usePositions()
  const { tradingSession, feePending, feePaidTime } = useTradingSession()
  const { avantisBalance } = useIntegratedWallet()
  const { logs } = useTradingActivityLogs()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isVisible, setIsVisible] = useState(true)
  
  // Hide if no active session
  if (!tradingSession || tradingSession.status !== 'running') {
    return null
  }
  
  if (!isVisible) return null

  // Get recent activity logs (last 3)
  const recentLogs = logs.slice(-3)
  const latestLog = logs[logs.length - 1]
  
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
        <Card className="bg-[#1a1a1a] border-[#262626] p-3 shadow-2xl hover:shadow-[#8759ff]/20 min-w-[240px] max-w-[280px]">
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
          <div className="space-y-1.5 text-xs mb-2">
            <div className="flex items-center justify-between">
              <span className="text-[#9ca3af]">Session:</span>
              <span className="text-white font-mono">
                {tradingSession.sessionId?.slice(-6) || 'Active'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#9ca3af]">Balance:</span>
              <span className="text-white font-semibold">
                ${avantisBalance.toFixed(2)}
              </span>
            </div>
            {feePending && !feePending.paid && (
              <div className="flex items-center justify-between">
                <span className="text-[#facc15] text-[10px]">Fee:</span>
                <span className="text-[#facc15] text-[10px] font-semibold">
                  ${(feePending.amount * 0.01).toFixed(2)} pending
                </span>
              </div>
            )}
            {feePaidTime && (
              <div className="flex items-center justify-between">
                <span className="text-[#27c47d] text-[10px]">Fee:</span>
                <span className="text-[#27c47d] text-[10px] font-semibold">
                  Paid ✓
                </span>
              </div>
            )}
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

          {/* Recent Activity Logs */}
          <div className="mt-2 pt-2 border-t border-[#262626]">
            <div className="space-y-1.5 max-h-[80px] overflow-y-auto">
              {recentLogs.length > 0 ? (
                recentLogs.map((log) => (
                  <div key={log.id} className="flex items-start space-x-1.5 text-[10px]">
                    <span className={`mt-0.5 ${
                      log.type === 'position_success' ? 'text-[#27c47d]' :
                      log.type === 'position_failed' ? 'text-[#ef4444]' :
                      log.type === 'indicator' ? 'text-[#8759ff]' :
                      log.type === 'cycle' ? 'text-[#facc15]' :
                      'text-[#9ca3af]'
                    }`}>
                      {log.type === 'position_success' ? '✅' :
                       log.type === 'position_failed' ? '❌' :
                       log.type === 'indicator' ? '📊' :
                       log.type === 'cycle' ? '🔄' :
                       '●'}
                    </span>
                    <span className="text-[#9ca3af] flex-1 truncate">
                      {log.message.length > 35 ? log.message.substring(0, 35) + '...' : log.message}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex items-center space-x-1">
                  <div className="w-1 h-1 bg-[#8759ff] rounded-full animate-pulse"></div>
                  <div className="w-1 h-1 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-1 h-1 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                  <span className="text-[#9ca3af] text-[10px] ml-1">Initializing...</span>
                </div>
              )}
            </div>
            {latestLog && (
              <div className="mt-1.5 pt-1.5 border-t border-[#262626]">
                <div className="text-[9px] text-[#6b7280] truncate">
                  {latestLog.message}
                </div>
              </div>
            )}
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
