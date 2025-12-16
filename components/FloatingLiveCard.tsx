"use client"

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { usePositions } from '@/lib/hooks/usePositions'
import { useTradingSession } from '@/lib/hooks/useTradingSession'
import { useTradingActivityLogs } from '@/lib/hooks/useTradingActivityLogs'
import { useIntegratedWallet } from '@/lib/wallet/IntegratedWalletContext'
import { useTrading } from '@/lib/hooks/useTrading'
import { useAuth } from '@/lib/auth/AuthContext'
import { LiveTradingLogModal } from './LiveTradingLogModal'

interface FloatingLiveCardProps {
  position?: {
    right: number
    bottom: number
  }
}

export function FloatingLiveCard({ position = { right: 16, bottom: 80 } }: FloatingLiveCardProps) {
  const { positionData, isLoading: positionsLoading } = usePositions()
  const { tradingSession } = useTradingSession()
  const { avantisBalance } = useIntegratedWallet()
  const { logs } = useTradingActivityLogs()
  const { getTradingSessions } = useTrading()
  const { token } = useAuth()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isVisible, setIsVisible] = useState(true)
  const [hasActiveSession, setHasActiveSession] = useState(false)
  const [activeSessionFromAPI, setActiveSessionFromAPI] = useState<any>(null)
  
  // Check for active sessions from API as well
  useEffect(() => {
    const checkActiveSessions = async () => {
      if (!token) return
      
      try {
        const sessions = await getTradingSessions()
        const active = sessions.find(s => s.status === 'running')
        setHasActiveSession(!!active)
        setActiveSessionFromAPI(active || null)
      } catch (err) {
        // Silently fail
      }
    }
    
    checkActiveSessions()
    const interval = setInterval(checkActiveSessions, 10000) // Check every 10 seconds
    
    return () => clearInterval(interval)
  }, [token, getTradingSessions])
  
  // Only show if there are actually open positions
  // This prevents showing the card when all positions are closed (even if session status is stale)
  const hasOpenPositions = (positionData?.openPositions || 0) > 0
  
  // Also check session positions as fallback (only if positionData is still loading)
  // Prefer positionData over session data since positionData is more up-to-date
  const sessionOpenPositions = (tradingSession?.openPositions || activeSessionFromAPI?.openPositions || activeSessionFromAPI?.positions || 0)
  const hasSessionPositions = sessionOpenPositions > 0
  
  // Show only if there are open positions
  // Prefer positionData (most accurate), only use session data if positionData is still loading
  const shouldShow = hasOpenPositions || (hasSessionPositions && positionsLoading && positionData === null)
  
  if (!shouldShow || !isVisible) {
    return null
  }
  
  // Use session from state if available, otherwise use API session
  const sessionToDisplay = tradingSession || activeSessionFromAPI

  // Get recent activity logs (last 3)
  const recentLogs = logs.slice(-3)
  const latestLog = logs[logs.length - 1]
  
  // Get session ID from either source
  const sessionId = sessionToDisplay?.sessionId || sessionToDisplay?.id || 'Active'
  
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
                {typeof sessionId === 'string' ? sessionId.slice(-6) : 'Active'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#9ca3af]">Balance:</span>
              <span className="text-white font-semibold">
                ${avantisBalance.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#9ca3af]">Positions:</span>
              <span className="text-white font-semibold">
                {positionData?.openPositions || sessionToDisplay?.openPositions || sessionToDisplay?.positions || 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#9ca3af]">PnL:</span>
              <span className={`font-semibold ${
                ((positionData?.totalPnL ?? sessionToDisplay?.totalPnL ?? 0) >= 0) ? 'text-[#27c47d]' : 'text-[#ef4444]'
              }`}>
                ${(positionData?.totalPnL ?? sessionToDisplay?.totalPnL ?? 0).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Trading Status & Activity */}
          <div className="mt-2 pt-2 border-t border-[#262626]">
            <div className="space-y-1.5 text-[10px]">
              {/* Show important status messages */}
              {positionData && positionData.openPositions === 0 && tradingSession && (
                <div className="space-y-1">
                  <div className="flex items-start space-x-1.5">
                    <span className="text-[#facc15]">🔍</span>
                    <span className="text-[#facc15] flex-1">
                      Scanning markets...
                    </span>
                  </div>
                  <div className="flex items-start space-x-1.5">
                    <span className="text-[#8759ff]">📊</span>
                    <span className="text-[#9ca3af] flex-1">
                      Analyzing BTC, ETH signals
                    </span>
                  </div>
                  <div className="flex items-start space-x-1.5 mt-2">
                    <span className="text-[#9ca3af]">ℹ️</span>
                    <span className="text-[#9ca3af] flex-1 text-[9px]">
                      Waiting for entry signal...
                    </span>
                  </div>
                </div>
              )}
              
              {positionData && positionData.openPositions > 0 && (
                <div className="space-y-1">
                  <div className="flex items-start space-x-1.5">
                    <span className="text-[#27c47d]">✅</span>
                    <span className="text-[#27c47d] flex-1">
                      {positionData.openPositions} position{positionData.openPositions > 1 ? 's' : ''} active
                    </span>
                  </div>
                  <div className="flex items-start space-x-1.5">
                    <span className="text-[#8759ff]">📈</span>
                    <span className="text-[#9ca3af] flex-1">
                      Monitoring for TP/SL
                    </span>
                  </div>
                </div>
              )}

              {!tradingSession && hasActiveSession && (
                <div className="flex items-center space-x-1">
                  <div className="w-1 h-1 bg-[#8759ff] rounded-full animate-pulse"></div>
                  <div className="w-1 h-1 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-1 h-1 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                  <span className="text-[#9ca3af] text-[10px] ml-1">Initializing...</span>
                </div>
              )}
            </div>
            
            {/* Click to view details hint */}
            <div className="mt-2 pt-1.5 border-t border-[#262626]">
              <div className="text-[9px] text-[#6b7280] text-center">
                Click for full trading logs →
              </div>
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
