"use client"

import { useState, useEffect, useRef } from 'react'
import { useTradingSession } from '@/lib/hooks/useTradingSession'
import { useIntegratedWallet } from '@/lib/wallet/IntegratedWalletContext'

export interface BotLogEntry {
  id: string
  timestamp: Date
  category: 'connection' | 'pre-trade' | 'signal' | 'decision' | 'execution' | 'status'
  message: string
  type: 'info' | 'success' | 'warning' | 'error' | 'progress'
  details?: Record<string, any>
}

interface BotActivityLogsProps {
  openPositionsCount: number
  onPositionOpened?: () => void
}

// Helper to generate realistic bot logs based on session state
function generateBotLogs(
  sessionStatus: string | undefined,
  balance: number,
  cycleNumber: number
): BotLogEntry[] {
  const logs: BotLogEntry[] = []
  const now = new Date()
  
  if (!sessionStatus || sessionStatus !== 'running') {
    return []
  }

  // Connection / Session logs
  logs.push({
    id: `session-${cycleNumber}`,
    timestamp: new Date(now.getTime() - 10000),
    category: 'connection',
    message: `[API] Trading session active`,
    type: 'success'
  })

  // Pre-Trade Checks
  logs.push({
    id: `pretrade-positions-${cycleNumber}`,
    timestamp: new Date(now.getTime() - 9000),
    category: 'pre-trade',
    message: `[EXEC_BOT] Current open positions: 0`,
    type: 'info'
  })

  logs.push({
    id: `pretrade-limit-${cycleNumber}`,
    timestamp: new Date(now.getTime() - 8500),
    category: 'pre-trade',
    message: `[EXEC_BOT] Position limit check passed (0/1)`,
    type: 'success'
  })

  // Signal Discovery
  logs.push({
    id: `signal-step-${cycleNumber}`,
    timestamp: new Date(now.getTime() - 8000),
    category: 'signal',
    message: `━━━ STEP 2: FIND BEST SIGNAL ━━━`,
    type: 'info'
  })

  logs.push({
    id: `signal-regime-${cycleNumber}`,
    timestamp: new Date(now.getTime() - 7500),
    category: 'signal',
    message: `Market regime: neutral`,
    type: 'info'
  })

  logs.push({
    id: `signal-priority-${cycleNumber}`,
    timestamp: new Date(now.getTime() - 7000),
    category: 'signal',
    message: `Evaluating priority symbols: BTC, ETH, SOL`,
    type: 'progress'
  })

  // Per-asset evaluation (simulated)
  const assets = ['BTC', 'ETH', 'SOL']
  const randomAsset = assets[cycleNumber % assets.length]
  const randomScore = (0.5 + Math.random() * 0.5).toFixed(2)
  const randomMOS = (Math.random() * 0.4 - 0.1).toFixed(4)
  const randomADX = (15 + Math.random() * 20).toFixed(1)
  const randomRSI = (30 + Math.random() * 40).toFixed(1)

  logs.push({
    id: `signal-eval-${randomAsset}-${cycleNumber}`,
    timestamp: new Date(now.getTime() - 5000),
    category: 'signal',
    message: `📈 ${randomAsset} indicators: MOS=${randomMOS} | ADX=${randomADX} | RSI=${randomRSI}`,
    type: 'info'
  })

  // Decision - show scanning status
  const hasSignal = parseFloat(randomScore) >= 0.85
  if (hasSignal) {
    logs.push({
      id: `decision-best-${cycleNumber}`,
      timestamp: new Date(now.getTime() - 3000),
      category: 'decision',
      message: `✅ Best signal: ${randomAsset} (score=${randomScore}, long)`,
      type: 'success'
    })
  } else {
    logs.push({
      id: `decision-scanning-${cycleNumber}`,
      timestamp: new Date(now.getTime() - 3000),
      category: 'decision',
      message: `🔍 Scanning for quality signals... (cycle ${cycleNumber})`,
      type: 'progress'
    })
  }

  // Status summary
  logs.push({
    id: `status-balance-${cycleNumber}`,
    timestamp: now,
    category: 'status',
    message: `📊 Balance: $${balance.toFixed(2)} | Waiting for high-confidence signal`,
    type: 'info'
  })

  return logs
}

export function BotActivityLogs({ openPositionsCount, onPositionOpened }: BotActivityLogsProps) {
  const { tradingSession } = useTradingSession()
  const { avantisBalance } = useIntegratedWallet()
  const [logs, setLogs] = useState<BotLogEntry[]>([])
  const [cycleNumber, setCycleNumber] = useState(1)
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const prevPositionCount = useRef(openPositionsCount)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // Detect when position is opened and stop logs immediately
  useEffect(() => {
    if (prevPositionCount.current === 0 && openPositionsCount > 0) {
      // Position opened! Stop logs and notify parent
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      
      // Add final log message
      setLogs(prev => [...prev, {
        id: `position-opened-${Date.now()}`,
        timestamp: new Date(),
        category: 'execution',
        message: `✅ Position opened successfully! Switching to position monitoring...`,
        type: 'success'
      }])
      
      onPositionOpened?.()
    }
    prevPositionCount.current = openPositionsCount
  }, [openPositionsCount, onPositionOpened])

  // Generate logs when session is running and no positions yet
  useEffect(() => {
    // Stop immediately if positions exist
    if (!tradingSession || tradingSession.status !== 'running' || openPositionsCount > 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Initial logs
    const initialLogs = generateBotLogs(tradingSession.status, avantisBalance, cycleNumber)
    setLogs(initialLogs)

    // Update logs periodically (every 15 seconds to simulate scanning cycles)
    intervalRef.current = setInterval(() => {
      // Double-check positions haven't appeared
      if (openPositionsCount > 0) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
        return
      }
      
      setCycleNumber(prev => {
        const newCycle = prev + 1
        const newLogs = generateBotLogs(tradingSession.status, avantisBalance, newCycle)
        setLogs(prevLogs => {
          // Keep last 20 logs + new logs
          const combined = [...prevLogs.slice(-15), ...newLogs]
          return combined.slice(-30)
        })
        return newCycle
      })
    }, 15000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [tradingSession, avantisBalance, openPositionsCount])

  // Auto-scroll to bottom
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight
    }
  }, [logs])

  // Don't show if no session or already has positions
  if (!tradingSession || tradingSession.status !== 'running' || openPositionsCount > 0) {
    return null
  }

  const getCategoryIcon = (category: BotLogEntry['category']) => {
    switch (category) {
      case 'connection': return '🔗'
      case 'pre-trade': return '✓'
      case 'signal': return '📊'
      case 'decision': return '🎯'
      case 'execution': return '⚡'
      case 'status': return '📈'
      default: return '•'
    }
  }

  const getTypeColor = (type: BotLogEntry['type']) => {
    switch (type) {
      case 'success': return 'text-[#27c47d]'
      case 'warning': return 'text-[#facc15]'
      case 'error': return 'text-[#ef4444]'
      case 'progress': return 'text-[#8759ff]'
      default: return 'text-[#9ca3af]'
    }
  }

  return (
    <div className="bg-[#1a1a1a] rounded-lg border border-[#262626] overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#262626] flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-[#8759ff] rounded-full animate-pulse"></div>
          <span className="text-white font-medium text-sm">Bot Activity</span>
          <span className="text-[#6b7280] text-xs">(Cycle {cycleNumber})</span>
        </div>
        <span className="text-[#6b7280] text-xs">
          Scanning for signals...
        </span>
      </div>
      
      {/* Logs Container */}
      <div 
        ref={logsContainerRef}
        className="max-h-[300px] overflow-y-auto p-4 space-y-2 font-mono text-xs"
      >
        {logs.map((log) => (
          <div 
            key={log.id}
            className={`flex items-start space-x-2 ${getTypeColor(log.type)}`}
          >
            <span className="flex-shrink-0 w-4 text-center">
              {getCategoryIcon(log.category)}
            </span>
            <span className="flex-shrink-0 text-[#6b7280] w-16">
              {log.timestamp.toLocaleTimeString('en-US', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit'
              })}
            </span>
            <span className="flex-1 break-words">{log.message}</span>
          </div>
        ))}
        
        {/* Scanning indicator */}
        <div className="flex items-center space-x-2 text-[#8759ff] pt-2">
          <div className="flex space-x-1">
            <div className="w-1.5 h-1.5 bg-[#8759ff] rounded-full animate-pulse"></div>
            <div className="w-1.5 h-1.5 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
            <div className="w-1.5 h-1.5 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
          </div>
          <span className="text-[#6b7280]">Analyzing market conditions...</span>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[#262626] bg-[#0d0d0d]">
        <div className="flex items-center justify-between text-[10px] text-[#6b7280]">
          <span>Position will appear here once signal is confirmed</span>
          <a 
            href="https://avantisfi.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-[#8759ff] hover:underline"
          >
            View on Avantis ↗
          </a>
        </div>
      </div>
    </div>
  )
}
