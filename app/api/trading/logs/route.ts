import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

/**
 * API endpoint to fetch real-time trading logs from the trading engine
 * Reads from logs/enhanced_trade_logs.jsonl
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const sessionId = searchParams.get('sessionId')
    
    // Path to the trading engine logs
    const logsDir = path.join(process.cwd(), 'logs')
    const logFile = path.join(logsDir, 'enhanced_trade_logs.jsonl')
    
    // Check if log file exists
    if (!fs.existsSync(logFile)) {
      return NextResponse.json({ 
        logs: [],
        message: 'No trading logs found yet. Logs will appear once trading starts.'
      })
    }
    
    // Read the log file
    const logContent = fs.readFileSync(logFile, 'utf-8')
    const logLines = logContent.trim().split('\n').filter(line => line.trim())
    
    // Parse JSON lines
    const logs = logLines
      .map(line => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(log => log !== null)
    
    // Filter by session ID if provided
    let filteredLogs = logs
    if (sessionId) {
      filteredLogs = logs.filter(log => log.sessionId === sessionId)
    }
    
    // Get the most recent logs (limit)
    const recentLogs = filteredLogs.slice(-limit)
    
    // Transform logs to match the UI format
    const transformedLogs = recentLogs.map((log, index) => ({
      id: `log-${index}-${Date.now()}`,
      timestamp: new Date(log.timestamp),
      type: mapEventToType(log.event),
      symbol: log.symbol,
      message: formatLogMessage(log),
      details: {
        ...log,
        entryPrice: log.entryPrice,
        leverage: log.leverage,
        budget: log.budget,
        rsi: log.rsi,
        mos: log.metadata?.mos,
        rvol: log.volumePct,
        atrPct: log.atrPct,
        signalScore: log.signalScore,
      }
    }))
    
    return NextResponse.json({
      logs: transformedLogs,
      count: transformedLogs.length,
      totalLogs: logs.length
    })
  } catch (error) {
    console.error('[Trading Logs API] Error:', error)
    return NextResponse.json(
      { 
        logs: [],
        error: 'Failed to fetch trading logs',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

/**
 * Map trading engine event types to UI log types
 */
function mapEventToType(event: string): string {
  switch (event) {
    case 'TRADE_OPEN':
      return 'position_success'
    case 'TRADE_CLOSE':
      return 'position_success'
    case 'SIGNAL_GENERATED':
      return 'indicator'
    case 'POSITION_UPDATE':
      return 'status'
    case 'SESSION_START':
      return 'cycle'
    case 'SESSION_END':
      return 'cycle'
    case 'ERROR':
      return 'position_failed'
    default:
      return 'status'
  }
}

/**
 * Format log message based on event type
 */
function formatLogMessage(log: any): string {
  const symbol = log.symbol || ''
  const event = log.event || ''
  
  switch (event) {
    case 'TRADE_OPEN':
      return `✅ ${symbol}: Position opened ${log.side || 'LONG'} | Entry: $${log.entryPrice?.toFixed(2) || '0'} | Leverage: ${log.leverage || 1}x`
    
    case 'TRADE_CLOSE':
      return `📊 ${symbol}: Position closed | PnL: $${log.pnl?.toFixed(2) || '0'} (${log.pnlPercent?.toFixed(2) || '0'}%)`
    
    case 'SIGNAL_GENERATED':
      if (log.reason && log.reason.includes('No signal')) {
        const mos = log.metadata?.mos?.toFixed(4) || '0'
        const rvol = log.volumePct?.toFixed(2) || '0'
        const rsi = log.rsi?.toFixed(2) || '0'
        const atrPct = (log.atrPct ? log.atrPct * 100 : 0).toFixed(2)
        return `❌ ${symbol}: No signal. ${log.reason || 'Conditions not met'}. 🕯️ Candle Positions - Entry: 30m, Signal: 2h, Trend: 6h | MOS: ${mos}, RVOL: ${rvol}, RSI: ${rsi}, ATR%: ${atrPct}%`
      } else {
        const mos = log.metadata?.mos?.toFixed(4) || '0'
        const rvol = log.volumePct?.toFixed(2) || '0'
        const rsi = log.rsi?.toFixed(2) || '0'
        const confidence = log.metadata?.confidence || 'medium'
        return `✅ ${symbol}: ${log.side || 'LONG'} signal detected! 🕯️ Candle Positions - Entry: 30m, Signal: 2h, Trend: 6h | MOS: ${mos}, RVOL: ${rvol}, RSI: ${rsi}, Confidence: ${confidence}`
      }
    
    case 'SESSION_START':
      return `🚀 Trading session started - Session ID: ${log.sessionId?.slice(0, 8) || 'Active'}`
    
    case 'SESSION_END':
      return `📊 Session ended: ${log.reason || 'Completed'} | Total PnL: $${log.totalPnL?.toFixed(2) || '0'}`
    
    case 'POSITION_UPDATE':
      return `📊 ${symbol}: Position update | PnL: $${log.pnl?.toFixed(2) || '0'}`
    
    case 'ERROR':
      return `❌ Error: ${log.errorMessage || log.reason || 'Unknown error'}`
    
    default:
      return log.reason || log.errorMessage || `${symbol || 'System'}: ${event}`
  }
}

