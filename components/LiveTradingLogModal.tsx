"use client"

import { Modal } from '@/components/ui/modal'
import { Card } from '@/components/ui/card'
import { usePositions } from '@/lib/hooks/usePositions'
import { useTradingSession } from '@/lib/hooks/useTradingSession'
import { useTradingActivityLogs } from '@/lib/hooks/useTradingActivityLogs'
import { useIntegratedWallet } from '@/lib/wallet/IntegratedWalletContext'
import { useEffect, useRef } from 'react'

interface LiveTradingLogModalProps {
  isOpen: boolean
  onClose: () => void
}

export function LiveTradingLogModal({ isOpen, onClose }: LiveTradingLogModalProps) {
  const { positionData, isLoading, fetchPositions } = usePositions()
  const { tradingSession, refreshSessionStatus, feePaidTime, positionWarning, feePending } = useTradingSession()
  const { avantisBalance } = useIntegratedWallet()
  const { logs } = useTradingActivityLogs()
  const logEndRef = useRef<HTMLDivElement>(null)
  
  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])
  
  // Auto-refresh every 5 seconds when modal is open
  useEffect(() => {
    if (!isOpen) return
    
    const interval = setInterval(() => {
      fetchPositions()
      refreshSessionStatus(false)
    }, 5000)
    
    return () => clearInterval(interval)
  }, [isOpen, fetchPositions, refreshSessionStatus])
  
  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    })
  }

  const getLogIcon = (type: string) => {
    switch (type) {
      case 'position_success':
        return '✅'
      case 'position_failed':
        return '❌'
      case 'position_attempt':
        return '🎯'
      case 'indicator':
        return '📊'
      case 'cycle':
        return '🔄'
      case 'status':
        return '📊'
      default:
        return '●'
    }
  }

  const getLogColor = (type: string, status?: string) => {
    if (type === 'position_success') return 'text-[#27c47d]'
    if (type === 'position_failed') return 'text-[#ef4444]'
    if (type === 'position_attempt') return 'text-[#facc15]'
    if (type === 'indicator') {
      if (status === 'passed') return 'text-[#27c47d]'
      if (status === 'failed') return 'text-[#ef4444]'
      return 'text-[#8759ff]'
    }
    if (type === 'cycle') return 'text-[#facc15]'
    if (type === 'status') return 'text-[#9ca3af]'
    return 'text-[#9ca3af]'
  }
  
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      {/* Modal Header */}
      <div className="flex items-center justify-between p-4 sm:p-6 border-b border-[#262626] flex-shrink-0">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-[#27c47d] rounded-full animate-pulse"></div>
          <h3 className="text-white font-semibold text-lg">Live Trading Activity</h3>
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
      
      {/* Session Summary */}
      {tradingSession && (
        <div className="p-4 sm:p-6 border-b border-[#262626] bg-[#1a1a1a]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-[#9ca3af] text-xs mb-1">Session ID</p>
              <p className="text-white font-mono text-xs">
                {tradingSession.sessionId?.slice(0, 8) || 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-[#9ca3af] text-xs mb-1">Balance</p>
              <p className="text-white font-semibold">
                ${avantisBalance.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-[#9ca3af] text-xs mb-1">Open Positions</p>
              <p className="text-white font-semibold">
                {positionData?.openPositions || 0}
              </p>
            </div>
            <div>
              <p className="text-[#9ca3af] text-xs mb-1">Total PnL</p>
              <p className={`font-semibold ${
                (positionData?.totalPnL || 0) >= 0 ? 'text-[#27c47d]' : 'text-[#ef4444]'
              }`}>
                ${(positionData?.totalPnL || 0).toFixed(2)}
              </p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-[#262626]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#9ca3af]">Status:</span>
              <span className={`font-medium ${
                tradingSession.status === 'running' ? 'text-[#27c47d]' : 'text-[#9ca3af]'
              }`}>
                {tradingSession.status === 'running' ? '🟢 Active' : tradingSession.status}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-[#9ca3af]">Target Profit:</span>
              <span className="text-white font-semibold">
                ${tradingSession.config?.profitGoal || '0'}
              </span>
            </div>
            {feePending && !feePending.paid && (
              <div className="mt-2 p-2 bg-[#facc15]/10 border border-[#facc15]/30 rounded-lg">
                <div className="text-[11px] text-[#facc15] font-medium">
                  💰 Fee (${(feePending.amount * 0.01).toFixed(2)}) will be deducted when first position opens
                </div>
                {positionWarning && (
                  <div className="text-[10px] text-[#9ca3af] mt-1">
                    {positionWarning}
                  </div>
                )}
              </div>
            )}
            {feePaidTime && (
              <div className="mt-2 p-2 bg-[#27c47d]/10 border border-[#27c47d]/30 rounded-lg">
                <div className="text-[11px] text-[#27c47d] font-medium">
                  ✅ Fee paid successfully after position opened
                </div>
                <div className="text-[10px] text-[#9ca3af] mt-1">
                  Paid at: {feePaidTime.toLocaleTimeString()}
                </div>
              </div>
            )}
            {!feePending && !feePaidTime && (
              <div className="mt-2 text-[10px] text-[#6b7280]">
                ⚠️ Trading is active. Fee will be deducted when position opens.
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Real-time Activity Logs */}
      <div className="flex-1 overflow-y-auto bg-[#0d0d0d]">
        <div className="p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-white font-medium text-sm">Trading Activity Log</h4>
            <span className="text-[#6b7280] text-xs">
              {logs.length} events
            </span>
          </div>
          
          {logs.length === 0 ? (
            <div className="text-center py-8">
              <div className="flex items-center justify-center space-x-2 mb-2">
                <div className="w-1 h-1 bg-[#8759ff] rounded-full animate-pulse"></div>
                <div className="w-1 h-1 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-1 h-1 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
              </div>
              <p className="text-[#6b7280] text-sm">Initializing trading activity logs...</p>
            </div>
          ) : (
            <div className="space-y-2 font-mono text-xs">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`flex items-start space-x-2 p-2 rounded-lg bg-[#1a1a1a] border border-[#262626] hover:bg-[#262626] transition-colors ${
                    log.type === 'position_success' ? 'border-[#27c47d]/30' :
                    log.type === 'position_failed' ? 'border-[#ef4444]/30' :
                    log.type === 'cycle' ? 'border-[#facc15]/30' :
                    ''
                  }`}
                >
                  <span className={`${getLogColor(log.type, log.details?.status)} text-sm flex-shrink-0 mt-0.5`}>
                    {getLogIcon(log.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className={`${getLogColor(log.type, log.details?.status)} flex-1`}>
                        {log.message}
                      </span>
                      <span className="text-[#6b7280] text-[10px] flex-shrink-0">
                        {formatTime(log.timestamp)}
                      </span>
                    </div>
                    {log.details && (
                      <div className="mt-1.5 space-y-1 text-[10px] text-[#9ca3af] pl-4 border-l border-[#262626]">
                        {log.details.indicator && (
                          <div>
                            <span className="text-[#8759ff]">{log.details.indicator}:</span>
                            {' '}
                            <span className={log.details.status === 'passed' ? 'text-[#27c47d]' : log.details.status === 'failed' ? 'text-[#ef4444]' : 'text-white'}>
                              {log.details.value}
                            </span>
                            {' '}
                            <span className="text-[#6b7280]">
                              (threshold: {log.details.threshold})
                            </span>
                            {log.details.status && (
                              <span className={`ml-2 ${
                                log.details.status === 'passed' ? 'text-[#27c47d]' : 'text-[#ef4444]'
                              }`}>
                                [{log.details.status}]
                              </span>
                            )}
                          </div>
                        )}
                        {log.details.entryPrice && (
                          <div>
                            Entry: <span className="text-white">${log.details.entryPrice.toFixed(2)}</span>
                            {log.details.leverage && (
                              <> | Leverage: <span className="text-white">{log.details.leverage}x</span></>
                            )}
                            {log.details.budget && (
                              <> | Budget: <span className="text-white">${log.details.budget}</span></>
                            )}
                          </div>
                        )}
                        {log.details.leverage && !log.details.entryPrice && (
                          <div>
                            Leverage: <span className="text-white">{log.details.leverage}x</span>
                            {log.details.budget && (
                              <> | Budget: <span className="text-white">${log.details.budget}</span></>
                            )}
                          </div>
                        )}
                        {log.details.reason && (
                          <div className="text-[#ef4444]">
                            Reason: {log.details.reason}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      </div>
      
      {/* Footer with BaseScan link */}
      <div className="p-4 sm:p-6 border-t border-[#262626] bg-[#1a1a1a]">
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
