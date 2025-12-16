# Leverage, Take Profit (TP), and Stop Loss (SL) Calculations

This document explains how leverage, Take Profit (TP), and Stop Loss (SL) are calculated in the Perpx Avantis trading system.

## Table of Contents
1. [Leverage Calculation](#leverage-calculation)
2. [Take Profit (TP) Calculation](#take-profit-tp-calculation)
3. [Stop Loss (SL) Calculation](#stop-loss-sl-calculation)
4. [Liquidation Price Calculation](#liquidation-price-calculation)
5. [Position Size and Collateral](#position-size-and-collateral)
6. [Signal Thresholds](#signal-thresholds)
7. [Related Formulas](#related-formulas)

---

## Leverage Calculation

### System-Controlled Leverage (Production Mode)

**⚠️ IMPORTANT**: Leverage is **fully system-controlled** and cannot be overridden by users.

The system automatically calculates leverage based on balance with safety constraints:

**Location**: `lib/utils/leverageCalculator.ts`

```typescript
export function calculateLeverageFromBalance(balance: number): number
```

### Safety Model

The leverage system ensures a **3x safety buffer** between SL and liquidation:

```
liquidation distance ≥ 3 × SL distance

SL_PCT = 2.5% (fixed)
LIQ_BUFFER = 3 (safety multiplier)
MAX_SAFE_LEVERAGE = floor(100 / (2.5 × 3)) = 13x
```

**Why 13x max?**
- At 13x leverage: Liquidation distance = 100/13 = **7.69%**
- SL distance × 3 = 2.5% × 3 = **7.5%**
- 7.69% ≥ 7.5% ✓ (liquidation has buffer above SL)

### Balance-Scaled Leverage Tiers

| Balance Range | Leverage |
|---------------|----------|
| < $10         | 2x       |
| $10 - $24     | 3x       |
| $25 - $49     | 5x       |
| $50 - $99     | 7x       |
| $100 - $249   | 10x      |
| ≥ $250        | 13x (max)|

**Default leverage**: 2x (minimum safe leverage when no balance available)

### Key Features

✅ **No user override** - Leverage is calculated automatically
✅ **Balance-scaled** - Higher balances can use higher leverage
✅ **Safety-capped** - Never exceeds 13x (liquidation buffer maintained)
✅ **Deterministic** - Same balance always produces same leverage

---

### Smart Contract Leverage Calculation

The smart contract calculates leverage when collateral is deposited or withdrawn:

**Location**: `Trading/src/Trading.sol` - `_calculateNewLeverage()`

**Formula**:
```solidity
newLeverage = (openInterestUSDC * PRECISION) / newCollateralAmount
```

Where:
- `openInterestUSDC` = Total position size in USDC (leveraged position value)
- `newCollateralAmount` = Updated collateral after deposit/withdraw (accounting for fees)
- `PRECISION` = 1e10 (10^10)

**For Deposit**:
```solidity
newAmount = currentCollateral + newAmount - fees
newLeverage = (openInterestUSDC * PRECISION) / newAmount
```

**For Withdraw**:
```solidity
newAmount = currentCollateral - newAmount - fees
newLeverage = (openInterestUSDC * PRECISION) / newAmount
```

**Key Relationships**:
- `Leverage = Position Size / Collateral`
- `Position Size (openInterestUSDC) = Collateral × Leverage`
- `Collateral = Position Size / Leverage`

---

## Take Profit (TP) Calculation

### Primary TP/SL Calculation (Web Trading Bot)

**Location**: `trading-engine/hyperliquid/web-trading-bot.ts` (lines 275-284)

The main implementation calculates TP and SL as **absolute price levels** based on leverage:

**Stop Loss Percentage Calculation**:
```typescript
slPercentage = Math.min(2.5, 50 / leverage)
```

**Take Profit Percentage Calculation**:
```typescript
tpPercentage = slPercentage * 2  // 2:1 Risk-Reward Ratio
```

**Price Level Calculation**:

**For LONG positions**:
```typescript
sl = currentPrice * (1 - slPercentage / 100)  // Below entry price
tp = currentPrice * (1 + tpPercentage / 100)  // Above entry price
```

**For SHORT positions**:
```typescript
sl = currentPrice * (1 + slPercentage / 100)  // Above entry price
tp = currentPrice * (1 - tpPercentage / 100)  // Below entry price
```

**Examples**:

**LONG position with 5x leverage at $100**:
- `slPercentage = Math.min(2.5, 50/5) = Math.min(2.5, 10) = 2.5%`
- `tpPercentage = 2.5% * 2 = 5%`
- `sl = 100 * (1 - 0.025) = $97.50` (2.5% below entry)
- `tp = 100 * (1 + 0.05) = $105.00` (5% above entry)
- **Risk-Reward Ratio**: 2.5% risk for 5% reward = **2:1**

**LONG position with 20x leverage at $100**:
- `slPercentage = Math.min(2.5, 50/20) = Math.min(2.5, 2.5) = 2.5%` (capped)
- `tpPercentage = 2.5% * 2 = 5%`
- `sl = $97.50` (2.5% below entry)
- `tp = $105.00` (5% above entry)

**LONG position with 2x leverage at $100**:
- `slPercentage = Math.min(2.5, 50/2) = Math.min(2.5, 25) = 2.5%` (capped)
- `tpPercentage = 2.5% * 2 = 5%`
- `sl = $97.50` (2.5% below entry)
- `tp = $105.00` (5% above entry)

**Key Insights**:
1. Stop loss percentage is **inversely proportional to leverage** (higher leverage = tighter SL)
2. Maximum SL is **capped at 2.5%** (even for low leverage)
3. Risk-Reward Ratio is **2:1** (2% risk for 4% reward, etc.)
4. SL percentage = `50 / leverage`, but never exceeds 2.5%

### Alternative TP/SL Calculation (Legacy/Reference)

**Location**: `trading-engine/hyperliquid/tpsl.ts` - `getDynamicTP_SL()`

⚠️ **Note**: This function exists but may not be actively used in the main trading flow.

```typescript
export function getDynamicTP_SL({
  symbol: string,
  regime: Regime,
  atr: number,           // Average True Range
  entryPrice: number,
  leverage: number
}): TP_SL
```

**Formulas** (for reference):
```typescript
slPct = 60 / leverage / 100
sl = entryPrice * slPct
rrr = 10.0  // Risk-Reward Ratio (10:1)
tp = sl * rrr
```

**Additional TP Metrics**:
- `halfATRThreshold = atr * 0.5`
- `trailOffset = atr * 0.4`
- `finalTP = atr * 6.0`

These are used for trailing stop and ATR-based position management.

---

## Stop Loss (SL) Calculation

### Primary SL Calculation (Web Trading Bot)

**Location**: `trading-engine/hyperliquid/web-trading-bot.ts`

The stop loss is calculated as an absolute price level:

**SL Percentage Formula**:
```typescript
slPercentage = Math.min(2.5, 50 / leverage)
```

**Price Level**:
- **LONG**: `sl = entryPrice * (1 - slPercentage / 100)` (below entry)
- **SHORT**: `sl = entryPrice * (1 + slPercentage / 100)` (above entry)

**Examples**:
- **5x leverage**: `slPercentage = 50/5 = 10%` → capped at **2.5%**
- **10x leverage**: `slPercentage = 50/10 = 5%` → capped at **2.5%`
- **20x leverage**: `slPercentage = 50/20 = 2.5%` → **2.5%**
- **25x leverage**: `slPercentage = 50/25 = 2%` → **2%**

**Note**: The SL percentage is capped at 2.5% maximum to protect capital, even with low leverage positions.

### Smart Contract SL Validation

**Location**: `Trading/src/Trading.sol` - `_updateSl()`

The smart contract enforces maximum SL distance based on leverage:

**Maximum SL Distance Formula**:
```solidity
maxSlDist = (openPrice * _MAX_SL_P) / 100 / leverage
```

Where:
- `_MAX_SL_P = 80` (80% maximum loss allowed)
- This is divided by leverage to ensure tighter SL with higher leverage

**Validation Rules**:
- **For LONG positions**: `newSL >= openPrice - maxSlDist`
- **For SHORT positions**: `newSL <= openPrice + maxSlDist`

**Example**:
- Entry price: $100
- Leverage: 5x
- Max SL distance: `(100 * 80) / 100 / 5 = 16` (16% or $16)
- For LONG: SL must be >= $84 ($100 - $16)
- For SHORT: SL must be <= $116 ($100 + $16)

This prevents setting stop losses that would cause excessive losses relative to leverage.

---

## Liquidation Price Calculation

**Location**: `avantis-service/position_queries.py`

**Formula**:

**For LONG positions**:
```python
liquidation_price = open_price * (1 - (1.0 / leverage))
```

**For SHORT positions**:
```python
liquidation_price = open_price * (1 + (1.0 / leverage))
```

**Examples**:

**LONG position with 5x leverage at $100**:
```
liquidation_price = 100 * (1 - (1/5))
                  = 100 * (1 - 0.2)
                  = 100 * 0.8
                  = $80 (20% drop from entry)
```

**SHORT position with 5x leverage at $100**:
```
liquidation_price = 100 * (1 + (1/5))
                  = 100 * (1 + 0.2)
                  = 100 * 1.2
                  = $120 (20% rise from entry)
```

**Key Insight**: The liquidation price represents the point where the position loses 100% of the collateral (1/leverage fraction of the entry price).

---

## Position Size and Collateral

### Relationships

**From Smart Contract** (`position_queries.py`):
```python
# openInterestUSDC is the leveraged position size (collateral * leverage)
collateral = open_interest_usdc / leverage if leverage > 0 else 0
```

**Key Formulas**:
1. `Position Size (openInterestUSDC) = Collateral × Leverage`
2. `Collateral = Position Size / Leverage`
3. `Leverage = Position Size / Collateral`

**Example**:
- Collateral: $100
- Leverage: 5x
- Position Size: $100 × 5 = **$500**

---

## Related Formulas

### PnL (Profit and Loss) Calculation

**Location**: `components/PositionsTable.tsx` - `calculatePnL()`

```typescript
// Price difference percentage
priceDiffPct = (currentPrice - entryPrice) / entryPrice

// Adjust for position direction
adjustedPriceDiff = isLong ? priceDiffPct : -priceDiffPct

// PnL = price_diff_pct * position_size
pnl = adjustedPriceDiff * positionSize

// ROE (Return on Equity) = (PnL / Collateral) * 100
roe = (pnl / collateral) * 100
```

### Position Math Utilities

**Location**: `Trading/src/library/PositionMath.sol`

The contract uses precision math with `LEVERAGE_PRECISION = 1e10`:

```solidity
// Multiply with leverage
function mul(uint a, uint _leverage) internal pure returns (uint) {
    return (a * _leverage) / LEVERAGE_PRECISION;
}

// Divide by leverage
function div(uint a, uint _leverage) internal pure returns (uint) {
    return (a * LEVERAGE_PRECISION) / _leverage;
}
```

---

## Signal Thresholds (Production)

The trading bot uses strict signal filters to ensure quality entries:

| Filter | Threshold | Description |
|--------|-----------|-------------|
| MOS (Market Outlook Score) | > 0.1 or < -0.1 | Directional bias required |
| MOS Strong Signal | ≥ 0.3 or ≤ -0.3 | High confidence signal |
| ADX | ≥ 15 (neutral), ≥ 20 (choppy) | Trend strength |
| ATR% | 0.15% - 6.0% | Volatility range |
| Volume | ≥ 50% of average | Liquidity requirement |
| Signal Score | ≥ 0.25 | Combined indicator score |
| RSI | 20 - 80 | Not overbought/oversold |

**All filters must pass** for a trade signal to be valid.

---

## Summary

### Leverage
- **System-Controlled**: Fully automatic, no user override
- **Balance-Scaled**: 2x ($0-10) → 13x ($250+)
- **Max Safe Leverage**: 13x (liquidation buffer maintained)
- **Smart Contract**: `Leverage = Position Size / Collateral`

### Stop Loss (SL)
- **Primary Method**: `slPercentage = Math.min(2.5%, 50 / leverage)` → Price level calculated from entry
  - **LONG**: `sl = entryPrice * (1 - slPercentage/100)` (below entry)
  - **SHORT**: `sl = entryPrice * (1 + slPercentage/100)` (above entry)
- **Smart Contract Max**: `maxSlDist = (openPrice * 80%) / leverage`
- **Validation**: Must be within max distance from entry price (enforced by contract)
- **Maximum SL**: Capped at 2.5% to protect capital

### Take Profit (TP)
- **Primary Method**: `tpPercentage = slPercentage * 2` (2:1 risk-reward ratio)
  - **LONG**: `tp = entryPrice * (1 + tpPercentage/100)` (above entry)
  - **SHORT**: `tp = entryPrice * (1 - tpPercentage/100)` (below entry)
- **Risk-Reward Ratio**: 2:1 (2% risk targets 4% profit, etc.)

### Liquidation Price
- **LONG**: `entryPrice × (1 - 1/leverage)`
- **SHORT**: `entryPrice × (1 + 1/leverage)`

---

## Notes

1. **Leverage is system-controlled** - No user input accepted
   - Balance-scaled from 2x to 13x
   - Max 13x ensures liquidation distance ≥ 3 × SL distance
2. **Higher leverage** = **Tighter stop loss** (to protect capital)
   - SL percentage = `50 / leverage`, but capped at **2.5% maximum**
   - This ensures even low-leverage positions don't risk more than 2.5%
3. **Risk-Reward Ratio** is **2:1** (2% risk targets 4% profit)
4. Smart contract enforces **maximum 80% loss** per position (before leverage adjustment)
   - Max SL distance = `(entryPrice * 80%) / leverage`
5. Liquidation occurs when price moves by `1/leverage` fraction from entry
   - LONG: `liquidationPrice = entryPrice × (1 - 1/leverage)`
   - SHORT: `liquidationPrice = entryPrice × (1 + 1/leverage)`
6. All calculations use high precision (1e10) to avoid rounding errors
7. TP/SL are calculated as **absolute price levels**, not price differences
8. **Signal thresholds are strict** - All 6 filters must pass for trade entry

---

## Code References

- System Leverage Calculator: `lib/utils/leverageCalculator.ts`
- Primary TP/SL Calculation: `trading-engine/hyperliquid/web-trading-bot.ts` (lines 275-284)
- Alternative TP/SL (Legacy): `trading-engine/hyperliquid/tpsl.ts` - `getDynamicTP_SL()`
- Signal Thresholds: `trading-engine/hyperliquid/strategyEngine.ts` (lines 130-256)
- Smart Contract Leverage: `Trading/src/Trading.sol` (line 637-651)
- Smart Contract SL Validation: `Trading/src/Trading.sol` (line 595-627)
- Liquidation Price: `avantis-service/position_queries.py` (line 223-228)
- PnL Calculation: `components/PositionsTable.tsx` (line 21-45)
- Live Trading Logs: `lib/hooks/useTradingActivityLogs.ts`
