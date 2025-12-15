import { NextRequest, NextResponse } from 'next/server'
import { verifyTokenAndGetContext } from '@/lib/utils/authHelper'

export async function GET(request: NextRequest) {
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
      console.log(`[API] Verified Farcaster user, FID: ${authContext.fid}`)
    } catch (authError) {
      console.error('[API] Token verification failed:', authError)
      return NextResponse.json(
        { success: false, error: authError instanceof Error ? authError.message : 'Authentication failed' },
        { status: 401 }
      )
    }
    
    // Call the trading engine to get sessions filtered by user FID
    const tradingEngineUrl = process.env.TRADING_ENGINE_URL || 'http://localhost:3001'
    
    try {
      // Filter sessions by userFid to ensure multi-user isolation
      const userFid = authContext.fid
      const response = await fetch(`${tradingEngineUrl}/api/trading/sessions?userFid=${userFid}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorData;
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}: ${response.statusText}` }
        }
        
        // If trading engine returns 404, return empty array
        if (response.status === 404) {
          return NextResponse.json({
            success: true,
            sessions: [],
            userFid
          })
        }
        
        console.error(`[API] Trading engine error (${response.status}):`, errorData)
        return NextResponse.json({ 
          success: true, 
          sessions: [],
          userFid
        })
      }

      const result = await response.json()
      console.log(`[API] Trading engine returned ${result.sessions?.length || 0} sessions for FID ${userFid}`)
      
      return NextResponse.json({
        success: true,
        sessions: result.sessions || [],
        userFid,
        activeCount: result.activeCount || 0
      })
    } catch (fetchError) {
      console.error('[API] Error calling trading engine:', fetchError)
      return NextResponse.json({
        success: true,
        sessions: []
      })
    }
  } catch (error) {
    console.error('[API] Unexpected error fetching trading sessions:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch trading sessions',
        sessions: []
      },
      { status: 500 }
    )
  }
}
