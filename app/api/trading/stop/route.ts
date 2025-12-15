import { NextRequest, NextResponse } from 'next/server'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    
    // Verify Farcaster token
    let authContext;
    try {
      authContext = await verifyTokenAndGetContext(token)
      console.log(`[API] Verified Farcaster user for stop trading, FID: ${authContext.fid}`)
    } catch (authError) {
      console.error('[API] Token verification failed:', authError)
      return NextResponse.json(
        { success: false, error: authError instanceof Error ? authError.message : 'Authentication failed' },
        { status: 401 }
      )
    }
    
    // Parse request body
    const { sessionId } = await request.json()
    
    if (!sessionId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Session ID is required' 
      }, { status: 400 })
    }
    
    // Call the trading engine to stop trading
    const tradingEngineUrl = process.env.TRADING_ENGINE_URL || 'http://localhost:3001'
    
    try {
      const response = await fetch(`${tradingEngineUrl}/api/trading/stop/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          userFid: authContext.fid,
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorData;
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}: ${response.statusText}` }
        }
        
        console.error(`[API] Trading engine error (${response.status}):`, errorData)
        return NextResponse.json({ 
          success: false, 
          error: errorData.error || 'Failed to stop trading' 
        }, { status: response.status })
      }

      const result = await response.json()
      return NextResponse.json({
        success: true,
        ...result
      })
    } catch (fetchError) {
      console.error('[API] Error calling trading engine:', fetchError)
      return NextResponse.json({
        success: false,
        error: fetchError instanceof Error ? fetchError.message : 'Failed to connect to trading engine'
      }, { status: 502 })
    }
  } catch (error) {
    console.error('[API] Unexpected error stopping trading:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to stop trading' },
      { status: 500 }
    )
  }
}
