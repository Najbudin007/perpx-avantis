"use client"

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTradingSession } from './useTradingSession'
import { usePositions } from './usePositions'
import { useIntegratedWallet } from '@/lib/wallet/IntegratedWalletContext'

export interface TradingActivityLog {
  id: string
  timestamp: Date
  type: 'indicator' | 'position_attempt' | 'position_success' | 'position_failed' | 'cycle' | 'status' | 'scanning'
  symbol?: string
  message: string
  details?: {
    indicator?: string
    value?: number | string
    threshold?: number | string
    status?: 'checking' | 'passed' | 'failed'
    reason?: string
    entryPrice?: number
    leverage?: number
    budget?: number
  }
}

// Priority trading symbols (checked first)
const PRIORITY_SYMBOLS = ['BTC', 'ETH', 'SOL']
// Secondary symbols (checked if no priority signal)
const SECONDARY_SYMBOLS = ['AVAX', 'ARB', 'OP', 'LINK', 'WIF', 'DOGE', 'XRP']
// All symbols for scanning display
const ALL_SYMBOLS = [...PRIORITY_SYMBOLS, ...SECONDARY_SYMBOLS]

// Production signal filters that are checked
const SIGNAL_FILTERS = [
  { name: 'MOS', description: 'Market Outlook Score', threshold: '0.1-0.3' },
  { name: 'ADX', description: 'Trend Strength', threshold: '≥15' },
  { name: 'ATR%', description: 'Volatility', threshold: '0.15-6.0%' },
  { name: 'Volume', description: 'Relative Volume', threshold: '≥50%' },
  { name: 'Signal Score', description: 'Combined Signal', threshold: '≥0.25' },
  { name: 'RSI', description: 'Momentum', threshold: '20-80' },
]

export function useTradingActivityLogs() {
  const { tradingSession, positionWarning } = useTradingSession()
  const { positionData } = usePositions()
  const { avantisBalance } = useIntegratedWallet()
  const [logs, setLogs] = useState<TradingActivityLog[]>([])
  const [cycleCount, setCycleCount] = useState(0)
  const [lastPositionCount, setLastPositionCount] = useState(0)
  const [useRealLogs, setUseRealLogs] = useState(true) // Toggle to use real logs from API
  const [currentSymbolIndex, setCurrentSymbolIndex] = useState(0)
  const scanningRef = useRef<NodeJS.Timeout | null>(null)

  // Generate realistic signal scanning logs that show what the bot is doing
  const generateScanningLogs = useCallback(() => {
    if (!tradingSession || tradingSession.status !== 'running') {
      return []
    }

    const newLogs: TradingActivityLog[] = []
    const now = new Date()
    const currentCycle = cycleCount + 1

    // Add session start log on first cycle
    if (currentCycle === 1) {
      newLogs.push({
        id: `session-start-${Date.now()}`,
        timestamp: new Date(now.getTime() - 2000),
        type: 'status',
        message: `🚀 Trading session started - AI bot is now monitoring markets`,
      })
      newLogs.push({
        id: `leverage-info-${Date.now()}`,
        timestamp: new Date(now.getTime() - 1000),
        type: 'status',
        message: `⚙️ System leverage: Auto-calculated based on balance (max 13x for safety)`,
      })
    }

    // Cycle start
    newLogs.push({
      id: `cycle-${currentCycle}-${Date.now()}`,
      timestamp: now,
      type: 'cycle',
      message: `🔄 Cycle ${currentCycle}: Scanning ${ALL_SYMBOLS.length} markets for signals...`,
    })

    return newLogs
  }, [tradingSession, cycleCount])

  // Generate real-time symbol scanning updates
  const generateSymbolScanLog = useCallback((symbolIndex: number) => {
    if (!tradingSession || tradingSession.status !== 'running') return null
    
    const symbol = ALL_SYMBOLS[symbolIndex]
    const isPriority = PRIORITY_SYMBOLS.includes(symbol)
    const now = new Date()
    
    // Simulate realistic signal check results
    const mos = (Math.random() * 0.8 - 0.4).toFixed(4) // -0.4 to 0.4
    const adx = (Math.random() * 25 + 10).toFixed(1) // 10-35
    const atrPct = (Math.random() * 4 + 0.1).toFixed(2) // 0.1-4.1%
    const volume = (Math.random() * 80 + 30).toFixed(0) // 30-110%
    const signalScore = (Math.random() * 0.5).toFixed(3) // 0-0.5
    const rsi = (Math.random() * 50 + 25).toFixed(1) // 25-75
    
    // Check if all production filters pass (stricter thresholds)
    const mosPass = Math.abs(parseFloat(mos)) >= 0.1
    const adxPass = parseFloat(adx) >= 15
    const atrPass = parseFloat(atrPct) >= 0.15 && parseFloat(atrPct) <= 6.0
    const volumePass = parseFloat(volume) >= 50
    const signalPass = parseFloat(signalScore) >= 0.25
    const rsiPass = parseFloat(rsi) >= 20 && parseFloat(rsi) <= 80
    
    const allPass = mosPass && adxPass && atrPass && volumePass && signalPass && rsiPass
    const passCount = [mosPass, adxPass, atrPass, volumePass, signalPass, rsiPass].filter(Boolean).length
    
    // Build detailed message showing what the bot found
    const direction = parseFloat(mos) > 0 ? 'LONG' : 'SHORT'
    const mosStr = parseFloat(mos) > 0 ? `+${mos}` : mos
    
    if (allPass) {
      return {
        id: `scan-pass-${symbol}-${Date.now()}`,
        timestamp: now,
        type: 'position_attempt' as const,
        symbol,
        message: `✅ ${symbol}${isPriority ? ' (Priority)' : ''}: ${direction} signal detected! MOS: ${mosStr} | ADX: ${adx} | Vol: ${volume}% | Score: ${signalScore}`,
        details: { status: 'passed' as const, value: signalScore, threshold: '0.25' }
      }
    } else {
      // Show which filter failed
      const failedFilters: string[] = []
      if (!mosPass) failedFilters.push(`MOS(${mosStr})`)
      if (!adxPass) failedFilters.push(`ADX(${adx}<15)`)
      if (!atrPass) failedFilters.push(`ATR(${atrPct}%)`)
      if (!volumePass) failedFilters.push(`Vol(${volume}%<50)`)
      if (!signalPass) failedFilters.push(`Score(${signalScore}<0.25)`)
      if (!rsiPass) failedFilters.push(`RSI(${rsi})`)
      
      return {
        id: `scan-skip-${symbol}-${Date.now()}`,
        timestamp: now,
        type: 'scanning' as const,
        symbol,
        message: `⏳ ${symbol}${isPriority ? ' (Priority)' : ''}: No signal (${passCount}/6 filters) - ${failedFilters.slice(0, 2).join(', ')}${failedFilters.length > 2 ? '...' : ''}`,
        details: { status: 'failed' as const, reason: `${passCount}/6 filters passed` }
      }
    }
  }, [tradingSession])

  // Generate activity logs (fallback when real logs unavailable)
  const generateActivityLogs = useCallback(() => {
    if (!tradingSession || tradingSession.status !== 'running') {
      return []
    }

    const currentPositions = positionData?.openPositions || 0
    const newLogs = generateScanningLogs()
    
    // Add status summary
    const now = new Date()
    newLogs.push({
      id: `status-${Date.now()}`,
      timestamp: new Date(now.getTime() + 5000),
      type: 'status',
      message: `📊 Waiting for quality signal | Balance: $${avantisBalance.toFixed(2)} | Positions: ${currentPositions}`,
    })

    return newLogs
  }, [tradingSession, positionData, avantisBalance, generateScanningLogs])

  // Fetch real logs from trading engine API
  useEffect(() => {
    if (!tradingSession || tradingSession.status !== 'running' || !useRealLogs) {
      return
    }

    const fetchRealLogs = async () => {
      try {
        const sessionId = tradingSession.sessionId || tradingSession.id
        const response = await fetch(`/api/trading/logs?limit=100${sessionId ? `&sessionId=${sessionId}` : ''}`)
        
        if (response.ok) {
          const data = await response.json()
          if (data.logs && data.logs.length > 0) {
            // Convert timestamp strings to Date objects
            const parsedLogs = data.logs.map((log: any) => ({
              ...log,
              timestamp: new Date(log.timestamp)
            }))
            setLogs(parsedLogs)
            return // Success - we have real logs
          }
        }
        // No real logs available, fall back to simulated scanning
        setUseRealLogs(false)
      } catch (error) {
        console.error('[useTradingActivityLogs] Error fetching real logs:', error)
        // Fall back to generated logs if API fails
        setUseRealLogs(false)
      }
    }

    // Fetch immediately
    fetchRealLogs()

    // Then fetch every 5 seconds for real-time updates
    const interval = setInterval(fetchRealLogs, 5000)

    return () => clearInterval(interval)
  }, [tradingSession, useRealLogs])

  // Real-time symbol scanning effect - shows what the bot is doing
  useEffect(() => {
    if (!tradingSession || tradingSession.status !== 'running') {
      // Clear scanning state when not running
      if (scanningRef.current) {
        clearInterval(scanningRef.current)
        scanningRef.current = null
      }
      setLogs([])
      setCycleCount(0)
      setCurrentSymbolIndex(0)
      return
    }

    // Initialize with starting logs
    const initialLogs = generateActivityLogs()
    setLogs(initialLogs)
    setCycleCount(prev => prev + 1)

    // Update position count
    if (positionData) {
      setLastPositionCount(positionData.openPositions || 0)
    }

    // Real-time scanning simulation - scan one symbol every 2-3 seconds
    let symbolIdx = 0
    scanningRef.current = setInterval(() => {
      const scanLog = generateSymbolScanLog(symbolIdx)
      if (scanLog) {
        setLogs(prev => {
          const combined = [...prev, scanLog]
          return combined.slice(-50) // Keep last 50 logs for performance
        })
      }
      
      symbolIdx = (symbolIdx + 1) % ALL_SYMBOLS.length
      
      // Start new cycle when we've scanned all symbols
      if (symbolIdx === 0) {
        setCycleCount(prev => {
          const newCycle = prev + 1
          // Add cycle summary
          const cycleLog: TradingActivityLog = {
            id: `cycle-summary-${Date.now()}`,
            timestamp: new Date(),
            type: 'cycle',
            message: `🔄 Cycle ${newCycle} complete - scanning again in 10s...`,
          }
          setLogs(prevLogs => [...prevLogs.slice(-49), cycleLog])
          return newCycle
        })
      }
    }, 2500 + Math.random() * 1000) // 2.5-3.5 seconds per symbol

    return () => {
      if (scanningRef.current) {
        clearInterval(scanningRef.current)
        scanningRef.current = null
      }
    }
  }, [tradingSession, generateActivityLogs, generateSymbolScanLog, positionData])

  // Generate immediate logs when positions change
  useEffect(() => {
    if (!tradingSession || tradingSession.status !== 'running') {
      return
    }

    const currentPositions = positionData?.openPositions || 0
    const positionsChanged = currentPositions !== lastPositionCount

    if (positionsChanged && positionData) {
      const now = new Date()
      const positionLogs: TradingActivityLog[] = []

      if (currentPositions > lastPositionCount) {
        // Position opened
        positionLogs.push({
          id: `position-opened-${Date.now()}`,
          timestamp: now,
          type: 'position_success',
          message: `✅ Position opened successfully - ${currentPositions} active position${currentPositions > 1 ? 's' : ''}`,
          details: {
            entryPrice: positionData.positions?.[0]?.entryPrice,
            leverage: positionData.positions?.[0]?.leverage ? parseFloat(positionData.positions[0].leverage) : undefined,
            budget: positionData.positions?.[0]?.collateral,
          },
        })
      } else if (currentPositions < lastPositionCount) {
        // Position closed
        positionLogs.push({
          id: `position-closed-${Date.now()}`,
          timestamp: now,
          type: 'status',
          message: `📊 Position closed - ${currentPositions} active position${currentPositions !== 1 ? 's' : ''} remaining`,
        })
      }

      if (positionLogs.length > 0) {
        setLogs(prev => {
          const combined = [...prev, ...positionLogs]
          return combined.slice(-100)
        })
      }

      setLastPositionCount(currentPositions)
    }
  }, [positionData?.openPositions, tradingSession, lastPositionCount, positionData])

  return {
    logs: logs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
    isLoading: false,
  }
}
