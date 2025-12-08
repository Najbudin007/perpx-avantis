"use client"

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { Position } from '@/types/trading'

interface PositionsTableProps {
  positions: Position[]
  isLoading?: boolean
  onClosePosition?: (positionId: string) => Promise<void>
}

export function PositionsTable({ positions, isLoading = false, onClosePosition }: PositionsTableProps) {
  if (isLoading) {
    return (
      <Card className="bg-[#1a1a1a] border-[#262626] p-4">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-[#2a2a2a] rounded-lg"></div>
          ))}
        </div>
      </Card>
    )
  }
  
  if (positions.length === 0) {
    return (
      <Card className="bg-[#1a1a1a] border-[#262626] p-8 text-center">
        <div className="w-16 h-16 bg-[#2a2a2a] rounded-full flex items-center justify-center mx-auto mb-4">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[#9ca3af]">
            <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h3 className="text-white font-semibold text-lg mb-2">No Open Positions</h3>
        <p className="text-[#9ca3af] text-sm">
          Your active positions will appear here once opened
        </p>
      </Card>
    )
  }
  
  return (
    <Card className="bg-[#1a1a1a] border-[#262626] rounded-2xl overflow-hidden">
      {/* Table Header */}
      <div className="p-4 border-b border-[#262626]">
        <h3 className="text-white font-semibold text-lg">Open Positions ({positions.length})</h3>
      </div>
      
      {/* Scrollable Table Body - Responsive and scrollable */}
      <div className="overflow-x-auto" style={{ maxHeight: '500px', overflowY: 'auto' }}>
        {/* Mobile View: Card-based */}
        <div className="block lg:hidden">
          <div className="p-4 space-y-4">
            {positions.map((position, index) => (
              <Card key={`${position.coin}-${index}`} className="bg-[#2a2a2a] border-[#374151] p-4">
                {/* Position Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-[#8759ff] rounded-lg flex items-center justify-center">
                      <span className="text-white font-bold text-sm">
                        {position.coin.charAt(0)}
                      </span>
                    </div>
                    <div>
                      <h4 className="text-white font-semibold">{position.coin}</h4>
                      <div className="flex items-center space-x-2 mt-1">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          position.side === 'long' 
                            ? 'bg-[#27c47d] text-white' 
                            : 'bg-[#ef4444] text-white'
                        }`}>
                          {position.side.toUpperCase()}
                        </span>
                        <span className="text-[#9ca3af] text-xs">{position.leverage}x</span>
                      </div>
                    </div>
                  </div>
                  {onClosePosition && (
                    <Button
                      onClick={() => onClosePosition(position.coin)}
                      size="sm"
                      className="bg-[#ef4444] hover:bg-[#dc2626] text-white"
                    >
                      Close
                    </Button>
                  )}
                </div>
                
                {/* Position Details Grid */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[#9ca3af] text-xs mb-1">Entry Price</p>
                    <p className="text-white font-semibold">${position.entryPrice.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[#9ca3af] text-xs mb-1">Mark Price</p>
                    <p className="text-white font-semibold">${position.markPrice.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[#9ca3af] text-xs mb-1">Position Value</p>
                    <p className="text-white font-semibold">${position.positionValue.toFixed(2)}</p>
                  </div>
                  {position.collateral !== undefined && (
                    <div>
                      <p className="text-[#9ca3af] text-xs mb-1">Collateral</p>
                      <p className="text-white font-semibold">${position.collateral.toFixed(2)}</p>
                    </div>
                  )}
                  {position.liquidationPrice && position.liquidationPrice > 0 && (
                    <div>
                      <p className="text-[#9ca3af] text-xs mb-1">Liq. Price</p>
                      <p className="text-[#ef4444] font-semibold">${position.liquidationPrice.toFixed(2)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[#9ca3af] text-xs mb-1">PnL (ROE)</p>
                    <p className={`font-semibold ${
                      position.pnl >= 0 ? 'text-[#27c47d]' : 'text-[#ef4444]'
                    }`}>
                      ${position.pnl.toFixed(2)} ({position.roe.toFixed(2)}%)
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
        
        {/* Desktop View: Table */}
        <div className="hidden lg:block">
          <table className="w-full">
            <thead className="bg-[#2a2a2a] border-b border-[#374151]">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-[#9ca3af] uppercase tracking-wider">
                  Position
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[#9ca3af] uppercase tracking-wider">
                  Side
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-[#9ca3af] uppercase tracking-wider">
                  Entry Price
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-[#9ca3af] uppercase tracking-wider">
                  Mark Price
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-[#9ca3af] uppercase tracking-wider">
                  Size
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-[#9ca3af] uppercase tracking-wider">
                  Collateral
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-[#9ca3af] uppercase tracking-wider">
                  Liq. Price
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-[#9ca3af] uppercase tracking-wider">
                  PnL (ROE)
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-[#9ca3af] uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#262626]">
              {positions.map((position, index) => (
                <tr key={`${position.coin}-${index}`} className="hover:bg-[#2a2a2a] transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-[#8759ff] rounded-lg flex items-center justify-center">
                        <span className="text-white font-bold text-xs">
                          {position.coin.charAt(0)}
                        </span>
                      </div>
                      <div>
                        <p className="text-white font-medium text-sm">{position.coin}</p>
                        <p className="text-[#9ca3af] text-xs">{position.leverage}x</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      position.side === 'long' 
                        ? 'bg-[#27c47d]/20 text-[#27c47d] border border-[#27c47d]/30' 
                        : 'bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/30'
                    }`}>
                      {position.side.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-white text-sm">
                    ${position.entryPrice.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-white text-sm">
                    ${position.markPrice.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-white text-sm">
                    {position.size}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-white text-sm">
                    ${position.collateral !== undefined ? position.collateral.toFixed(2) : 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-[#ef4444] text-sm">
                    {position.liquidationPrice && position.liquidationPrice > 0 
                      ? `$${position.liquidationPrice.toFixed(2)}`
                      : 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className={`font-semibold text-sm ${
                      position.pnl >= 0 ? 'text-[#27c47d]' : 'text-[#ef4444]'
                    }`}>
                      ${position.pnl.toFixed(2)}
                      <span className="text-xs ml-1">({position.roe.toFixed(2)}%)</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    {onClosePosition && (
                      <Button
                        onClick={() => onClosePosition(position.coin)}
                        size="sm"
                        className="bg-[#ef4444] hover:bg-[#dc2626] text-white"
                      >
                        Close
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  )
}
