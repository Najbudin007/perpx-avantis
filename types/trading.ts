// Position Interface - matches the usePositions hook structure
export interface Position {
  coin: string
  symbol?: string
  pair_index?: number
  index?: number
  side: 'long' | 'short'
  leverage: string | number
  entryPrice: number
  markPrice: number
  liquidationPrice?: number | null
  size: string
  positionValue: number
  collateral?: number
  margin: string
  pnl: number
  roe: number
  takeProfit?: number | null
  stopLoss?: number | null
}

// Trading Session Interface
export interface TradingSession {
  id: string
  sessionId: string
  status: 'running' | 'stopped' | 'completed' | 'error'
  startTime: Date
  endTime?: Date
  config: {
    profitGoal: number
    maxBudget: number
    maxPerSession: number
    lossThreshold: number
  }
  openPositions: number
  totalPnL: number
  pnl: number
  cycle: number
  positions?: Position[]
}

// Toast Interface
export interface Toast {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  title: string
  message: string
  duration?: number
}

// Modal Props Interface
export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
  closeOnBackdropClick?: boolean
  closeOnEscape?: boolean
}
