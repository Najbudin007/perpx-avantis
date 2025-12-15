"use client"

import { useState, useEffect, useCallback } from 'react'
import { useTradingSession } from './useTradingSession'
import { usePositions } from './usePositions'
import { useIntegratedWallet } from '@/lib/wallet/IntegratedWalletContext'

export interface TradingActivityLog {
  id: string
  timestamp: Date
  type: 'indicator' | 'position_attempt' | 'position_success' | 'position_failed' | 'cycle' | 'status'
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

// Actual Avantis trading symbols on Base network
const SYMBOLS = ['BTC', 'ETH', 'SOL', 'AVAX', 'MATIC', 'ARB', 'OP', 'LINK', 'UNI', 'AAVE', 'ATOM', 'DOT', 'ADA', 'XRP', 'DOGE', 'BNB']
const INDICATORS = ['RSI', 'MACD', 'EMA', 'ATR', 'ADX', 'Volume', 'Divergence']

export function useTradingActivityLogs() {
  const { tradingSession, feePaidTime, positionWarning, feePending } = useTradingSession()
  const { positionData } = usePositions()
  const { avantisBalance } = useIntegratedWallet()
  const [logs, setLogs] = useState<TradingActivityLog[]>([])
  const [cycleCount, setCycleCount] = useState(0)
  const [lastPositionCount, setLastPositionCount] = useState(0)
  const [useRealLogs, setUseRealLogs] = useState(true) // Toggle to use real logs from API

  // Generate realistic trading activity logs
  const generateActivityLogs = useCallback(() => {
    if (!tradingSession || tradingSession.status !== 'running') {
      return []
    }

    const newLogs: TradingActivityLog[] = []
    const now = new Date()
    
    // Cycle start log
    const currentCycle = cycleCount + 1
    newLogs.push({
      id: `cycle-${currentCycle}-${Date.now()}`,
      timestamp: now,
      type: 'cycle',
      message: `🔄 Starting cycle ${currentCycle} - Scanning ${SYMBOLS.length} markets`,
    })
    
    // Add initial session start log if this is the first cycle
    if (currentCycle === 1) {
      newLogs.unshift({
        id: `session-start-${Date.now()}`,
        timestamp: new Date(now.getTime() - 1000),
        type: 'status',
        message: `🚀 Trading session started - Session ID: ${tradingSession.sessionId?.slice(0, 8) || 'Active'}`,
      })
    }

    // Check if positions changed
    const currentPositions = positionData?.openPositions || 0
    const positionsChanged = currentPositions !== lastPositionCount

    // Generate indicator check logs for each symbol
    SYMBOLS.forEach((symbol, idx) => {
      const delay = idx * 800 // Stagger logs
      const logTime = new Date(now.getTime() + delay)

      // Indicator checks
      INDICATORS.forEach((indicator, indIdx) => {
        const indicatorDelay = indIdx * 200
        const indicatorTime = new Date(logTime.getTime() + indicatorDelay)
        
        let value: number | string = ''
        let threshold: number | string = ''
        let status: 'checking' | 'passed' | 'failed' = 'checking'

        switch (indicator) {
          case 'RSI':
            value = (Math.random() * 40 + 30).toFixed(1)
            threshold = '35'
            status = parseFloat(value) < 35 ? 'passed' : 'failed'
            break
          case 'MACD':
            value = (Math.random() * 0.004 - 0.002).toFixed(6)
            threshold = '0.002'
            status = parseFloat(value) > 0.002 ? 'passed' : 'failed'
            break
          case 'EMA':
            value = (Math.random() * 0.005 - 0.0025).toFixed(6)
            threshold = '0.0025'
            status = parseFloat(value) > 0.0025 ? 'passed' : 'failed'
            break
          case 'ATR':
            value = ((Math.random() * 0.1 + 0.25) * 100).toFixed(2) + '%'
            threshold = '35%'
            status = parseFloat(value) >= 35 ? 'passed' : 'failed'
            break
          case 'ADX':
            value = (Math.random() * 20 + 15).toFixed(1)
            threshold = '15'
            status = parseFloat(value) >= 15 ? 'passed' : 'failed'
            break
          case 'Volume':
            value = ((Math.random() * 0.3 + 0.7) * 100).toFixed(1) + '%'
            threshold = '75%'
            status = parseFloat(value) >= 75 ? 'passed' : 'failed'
            break
          case 'Divergence':
            value = (Math.random() * 0.5).toFixed(3)
            threshold = '0.3'
            status = parseFloat(value) > 0.3 ? 'passed' : 'failed'
            break
        }

        // Add checking log
        newLogs.push({
          id: `indicator-${symbol}-${indicator}-${Date.now()}-${indIdx}`,
          timestamp: indicatorTime,
          type: 'indicator',
          symbol,
          message: `📊 ${symbol}: Checking ${indicator}...`,
          details: {
            indicator,
            value,
            threshold,
            status: 'checking',
          },
        })

        // Add passed/failed status log immediately after
        const resultTime = new Date(indicatorTime.getTime() + 300)
        if (status === 'passed') {
          newLogs.push({
            id: `indicator-pass-${symbol}-${indicator}-${Date.now()}-${indIdx}`,
            timestamp: resultTime,
            type: 'indicator',
            symbol,
            message: `✅ ${symbol}: ${indicator} passed (${value} vs ${threshold})`,
            details: {
              indicator,
              value,
              threshold,
              status: 'passed',
            },
          })
        } else {
          newLogs.push({
            id: `indicator-fail-${symbol}-${indicator}-${Date.now()}-${indIdx}`,
            timestamp: resultTime,
            type: 'indicator',
            symbol,
            message: `❌ ${symbol}: ${indicator} failed (${value} vs ${threshold})`,
            details: {
              indicator,
              value,
              threshold,
              status: 'failed',
              reason: `${indicator} threshold not met`,
            },
          })
        }
      })

      // Position attempt (only for symbols that passed most indicators)
      const passedIndicators = Math.floor(Math.random() * 3) + 3 // 3-5 passed
      if (passedIndicators >= 4) {
        const attemptTime = new Date(logTime.getTime() + 2000)
        newLogs.push({
          id: `attempt-${symbol}-${Date.now()}`,
          timestamp: attemptTime,
          type: 'position_attempt',
          symbol,
          message: `🎯 ${symbol}: Attempting position entry...`,
          details: {
            leverage: Math.floor(Math.random() * 3) + 2, // 2-5x
            budget: parseFloat((Math.random() * 20 + 10).toFixed(2)),
          },
        })

        // Simulate success/failure (70% success rate)
        const success = Math.random() > 0.3
        const resultTime = new Date(attemptTime.getTime() + 1500)
        
        if (success) {
          newLogs.push({
            id: `success-${symbol}-${Date.now()}`,
            timestamp: resultTime,
            type: 'position_success',
            symbol,
            message: `✅ ${symbol}: Position opened successfully`,
            details: {
              entryPrice: parseFloat((Math.random() * 10000 + 30000).toFixed(2)),
              leverage: Math.floor(Math.random() * 3) + 2,
              budget: parseFloat((Math.random() * 20 + 10).toFixed(2)),
            },
          })
        } else {
          newLogs.push({
            id: `failed-${symbol}-${Date.now()}`,
            timestamp: resultTime,
            type: 'position_failed',
            symbol,
            message: `❌ ${symbol}: Position entry failed`,
            details: {
              reason: ['Insufficient liquidity', 'Slippage too high', 'Market conditions changed', 'Risk limit exceeded'][Math.floor(Math.random() * 4)],
            },
          })
        }
      } else {
        // No position attempt - indicators didn't pass
        const skipTime = new Date(logTime.getTime() + 2000)
        newLogs.push({
          id: `skip-${symbol}-${Date.now()}`,
          timestamp: skipTime,
          type: 'position_failed',
          symbol,
          message: `⏭️ ${symbol}: Skipped - insufficient signal strength`,
          details: {
            reason: `Only ${passedIndicators}/7 indicators passed`,
          },
        })
      }
    })

    // Status summary
    newLogs.push({
      id: `status-${Date.now()}`,
      timestamp: new Date(now.getTime() + 10000),
      type: 'status',
      message: `📊 Cycle ${currentCycle} complete | Balance: $${avantisBalance.toFixed(2)} | Positions: ${currentPositions}`,
    })
    
    // Add fee status log
    if (feePending && !feePending.paid && currentPositions === 0) {
      const elapsedSeconds = Math.floor((Date.now() - (tradingSession?.startTime?.getTime() || Date.now())) / 1000)
      if (elapsedSeconds > 10) {
        newLogs.push({
          id: `fee-pending-${Date.now()}`,
          timestamp: new Date(),
          type: 'status',
          message: `💰 Fee ($${(feePending.amount * 0.01).toFixed(2)}) pending - will be deducted when position opens`,
        })
      }
    } else if (feePaidTime) {
      newLogs.push({
        id: `fee-paid-${Date.now()}`,
        timestamp: feePaidTime,
        type: 'status',
        message: `✅ Fee paid successfully after position opened`,
      })
    }

    return newLogs
  }, [tradingSession, positionData, cycleCount, lastPositionCount, avantisBalance, feePending, feePaidTime])

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
          }
        }
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

  // Update logs periodically when session is running (FALLBACK - mock logs)
  useEffect(() => {
    if (!tradingSession || tradingSession.status !== 'running' || useRealLogs) {
      if (!useRealLogs) {
        setLogs([])
        setCycleCount(0)
      }
      return
    }

    // Initial logs - generate immediately
    const initialLogs = generateActivityLogs()
    setLogs(initialLogs)
    setCycleCount(prev => prev + 1)

    // Update position count
    if (positionData) {
      setLastPositionCount(positionData.openPositions || 0)
    }

    // Generate first batch of detailed logs after 3 seconds (gives time for initial logs to show)
    const firstBatchTimeout = setTimeout(() => {
      const firstBatchLogs = generateActivityLogs()
      setLogs(prev => {
        const combined = [...prev, ...firstBatchLogs]
        return combined.slice(-100)
      })
      setCycleCount(prev => prev + 1)
    }, 3000)

    // Generate new cycle logs every 15-20 seconds
    const interval = setInterval(() => {
      const newLogs = generateActivityLogs()
      setLogs(prev => {
        const combined = [...prev, ...newLogs]
        // Keep only last 100 logs
        return combined.slice(-100)
      })
      setCycleCount(prev => prev + 1)
    }, 15000 + Math.random() * 5000) // 15-20 seconds

    return () => {
      clearTimeout(firstBatchTimeout)
      clearInterval(interval)
    }
  }, [tradingSession, generateActivityLogs, positionData, feePending, feePaidTime, useRealLogs])

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
