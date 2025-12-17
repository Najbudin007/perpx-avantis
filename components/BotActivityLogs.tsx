"use client"

import { useState, useEffect, useRef } from 'react'
import { useTradingSession } from '@/lib/hooks/useTradingSession'
import { useAuth } from '@/lib/auth/AuthContext'

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

/**
 * Map API log types to UI categories
 */
function mapLogTypeToCategory(type: string): BotLogEntry['category'] {
  switch (type) {
    case 'position_success':
    case 'position_attempt':
      return 'execution'
    case 'position_failed':
      return 'execution'
    case 'indicator':
      return 'signal'
    case 'cycle':
      return 'connection'
    case 'scanning':
      return 'signal'
    default:
      return 'status'
  }
}

/**
 * Map API log types to UI types
 */
function mapLogTypeToUIType(type: string): BotLogEntry['type'] {
  switch (type) {
    case 'position_success':
      return 'success'
    case 'position_failed':
      return 'error'
    case 'position_attempt':
      return 'progress'
    case 'indicator':
      return 'info'
    case 'scanning':
      return 'progress'
    default:
      return 'info'
  }
}

export function BotActivityLogs({ openPositionsCount, onPositionOpened }: BotActivityLogsProps) {
  const { tradingSession } = useTradingSession()
  const { token } = useAuth()
  const [logs, setLogs] = useState<BotLogEntry[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(true)
  const [noLogsYet, setNoLogsYet] = useState(false)
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

  // Fetch REAL logs from backend
  useEffect(() => {
    // Stop immediately if positions exist
    if (!tradingSession || tradingSession.status !== 'running' || openPositionsCount > 0 || !token) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    const fetchRealLogs = async () => {
      try {
        const sessionId = tradingSession.sessionId || tradingSession.id
        const response = await fetch(
          `/api/trading/logs?limit=50${sessionId ? `&sessionId=${sessionId}` : ''}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          }
        )
        
        if (!response.ok) {
          console.warn('[BotActivityLogs] Failed to fetch logs:', response.statusText)
          setNoLogsYet(true)
          setIsLoadingLogs(false)
          return
        }

        const data = await response.json()
        
        if (data.logs && data.logs.length > 0) {
          // Transform backend logs to UI format
          const transformedLogs: BotLogEntry[] = data.logs.map((log: any) => ({
            id: log.id,
            timestamp: new Date(log.timestamp),
            category: mapLogTypeToCategory(log.type),
            message: log.message,
            type: mapLogTypeToUIType(log.type),
            details: log.details
          }))
          
          setLogs(transformedLogs)
          setNoLogsYet(false)
        } else {
          // No logs yet, but session is running
          setNoLogsYet(true)
        }
        
        setIsLoadingLogs(false)
      } catch (error) {
        console.error('[BotActivityLogs] Error fetching logs:', error)
        setNoLogsYet(true)
        setIsLoadingLogs(false)
      }
    }

    // Initial fetch
    fetchRealLogs()

    // Poll for updates every 3 seconds (aggressive during scanning)
    intervalRef.current = setInterval(() => {
      // Double-check positions haven't appeared
      if (openPositionsCount > 0) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
        return
      }
      
      fetchRealLogs()
    }, 3000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [tradingSession, token, openPositionsCount])

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
          <span className="text-[#6b7280] text-xs">(Real-time logs)</span>
        </div>
        <span className="text-[#6b7280] text-xs">
          {isLoadingLogs ? 'Loading...' : 'Live'}
        </span>
      </div>
      
      {/* Logs Container */}
      <div 
        ref={logsContainerRef}
        className="max-h-[300px] overflow-y-auto p-4 space-y-2 font-mono text-xs"
      >
        {isLoadingLogs && (
          <div className="flex items-center justify-center py-8 text-[#6b7280]">
            <div className="w-4 h-4 border-2 border-[#8759ff] border-t-transparent rounded-full animate-spin mr-2"></div>
            <span>Loading bot activity...</span>
          </div>
        )}
        
        {!isLoadingLogs && noLogsYet && (
          <div className="py-8 text-center space-y-3">
            <div className="flex items-center justify-center space-x-1 text-[#8759ff]">
              <div className="w-1.5 h-1.5 bg-[#8759ff] rounded-full animate-pulse"></div>
              <div className="w-1.5 h-1.5 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
              <div className="w-1.5 h-1.5 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
            </div>
            <p className="text-[#9ca3af] text-sm">
              Bot is initializing...
            </p>
            <p className="text-[#6b7280] text-xs">
              Logs will appear here as the bot evaluates signals
            </p>
          </div>
        )}
        
        {!isLoadingLogs && !noLogsYet && logs.map((log) => (
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
        
        {!isLoadingLogs && !noLogsYet && logs.length > 0 && (
          <div className="flex items-center space-x-2 text-[#8759ff] pt-2 border-t border-[#262626] mt-2">
            <div className="flex space-x-1">
              <div className="w-1.5 h-1.5 bg-[#8759ff] rounded-full animate-pulse"></div>
              <div className="w-1.5 h-1.5 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
              <div className="w-1.5 h-1.5 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
            </div>
            <span className="text-[#6b7280]">Monitoring markets...</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[#262626] bg-[#0d0d0d]">
        <div className="flex items-center justify-between text-[10px] text-[#6b7280]">
          <span>
            {logs.length > 0 
              ? `Showing ${logs.length} real-time log${logs.length !== 1 ? 's' : ''}`
              : 'Position will appear once signal is confirmed'
            }
          </span>
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
