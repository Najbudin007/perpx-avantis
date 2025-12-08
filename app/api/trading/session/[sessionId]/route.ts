import { NextRequest, NextResponse } from 'next/server'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const params = await context.params
    const sessionId = params.sessionId
    console.log(`[API] Getting session status for: ${sessionId}`)
    
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const authContext = await verifyTokenAndGetContext(token)
    
    // Call the trading engine to get session status
    const tradingEngineUrl = process.env.TRADING_ENGINE_URL || 'http://localhost:3001'
    
    // Clean up URL (remove trailing /api/trading-engine if present)
    const cleanUrl = tradingEngineUrl.replace(/\/api\/trading-engine\/?$/, '');
    
    try {
      // Trading engine uses /api/trading/status/:sessionId endpoint
      const response = await fetch(`${cleanUrl}/api/trading/status/${sessionId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        // If trading engine doesn't have this session, return a default status
        console.log(`[API] Session ${sessionId} not found in trading engine`)
        return NextResponse.json({
          session: {
            id: sessionId,
            status: 'not_found',
            startTime: new Date().toISOString(),
            totalPnL: 0,
            positions: [],
            config: {
              maxBudget: 50,
              profitGoal: 10,
              maxPerSession: 1
            },
            error: 'Session not found in trading engine'
          }
        })
      }

      const sessionData = await response.json()
      // Wrap the session data in a session object for consistency
      // Add startTime if it doesn't exist
      const wrappedSession = {
        ...sessionData,
        startTime: sessionData.startTime || sessionData.lastUpdate || new Date().toISOString(),
        endTime: sessionData.endTime || undefined,
        positions: sessionData.positions || [],
        totalPnL: sessionData.totalPnL || sessionData.pnl || 0
      }
      console.log('[API] Returning wrapped session:', wrappedSession)
      return NextResponse.json({ session: wrappedSession })
      
    } catch (engineError) {
      console.error('[API] Error fetching from trading engine:', engineError)
      
      // Return a default completed session if trading engine is unavailable
      return NextResponse.json({
        session: {
          id: sessionId,
          status: 'completed',
          startTime: new Date().toISOString(),
          totalPnL: 0,
          positions: [],
          config: {
            maxBudget: 50,
            profitGoal: 10,
            maxPerSession: 1
          }
        }
      })
    }
    
  } catch (error) {
    console.error('Error getting trading session:', error)
    const params = await context.params
    return NextResponse.json({
      session: {
        id: params.sessionId,
        status: 'error',
        startTime: new Date().toISOString(),
        totalPnL: 0,
        positions: [],
        config: {
          maxBudget: 50,
          profitGoal: 10,
          maxPerSession: 1
        },
        error: error instanceof Error ? error.message : 'Failed to get trading session'
      }
    }, { status: 500 })
  }
}