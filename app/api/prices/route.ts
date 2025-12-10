import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const symbols = searchParams.get('symbols')
    
    if (!symbols) {
      return NextResponse.json({ 
        error: 'symbols parameter is required (comma-separated list)',
        prices: {}
      }, { status: 400 })
    }
    
    // Get trading engine URL from environment
    const tradingEngineUrl = process.env.TRADING_ENGINE_URL || 'http://localhost:3001'
    
    // Clean up URL (remove trailing slash)
    const cleanUrl = tradingEngineUrl.replace(/\/$/, '')
    
    // Determine the correct endpoint path
    let tradingEngineEndpoint: string
    if (cleanUrl.includes('/api/trading-engine')) {
      // Trading engine is behind nginx proxy at /api/trading-engine
      tradingEngineEndpoint = `${cleanUrl}/api/prices?symbols=${encodeURIComponent(symbols)}`
    } else {
      // Direct trading engine service (no proxy)
      tradingEngineEndpoint = `${cleanUrl}/api/prices?symbols=${encodeURIComponent(symbols)}`
    }
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout
      
      const response = await fetch(tradingEngineEndpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      })
      
      clearTimeout(timeoutId)
      
      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(data)
      } else {
        console.warn(`[API] Trading engine returned status ${response.status} for prices`)
        return NextResponse.json({ prices: {} })
      }
    } catch (fetchError) {
      console.error('[API] Error fetching prices from trading engine:', fetchError)
      // Return empty prices on error (graceful degradation)
      return NextResponse.json({ prices: {} })
    }
  } catch (error) {
    console.error('[API] Error in /api/prices:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      prices: {}
    }, { status: 500 })
  }
}
