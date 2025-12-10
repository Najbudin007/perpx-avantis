import { Regime } from './regime';
import { calculateMOS, checkSignals, linearSlope, OHLCV, SignalResult } from './signals';
import { getMultiTimeframeOHLCV } from './binanceHistorical';

export interface EntryDecision {
  shouldOpen: boolean;
  reason: string;
  confidence: 'low' | 'medium' | 'high';
  direction?: 'long' | 'short';
  isAnticipation?: boolean;
  entryType?: 'long' | 'short' | 'sniper' | 'reversal' | 'counter-trend';
  leverage?: number;
  tp?: number;
  sl?: number;
  rrr?: number;
  triggeredBy?: string;
  logged?: boolean;
}

function candlePosition({
  open,
  close,
  high,
  low
}: {
  open: number;
  close: number;
  high: number;
  low: number;
}): 
  | 'top' | 'middle' | 'bottom' 
  | 'anticipation_top' | 'anticipation_bottom' 
  | 'doji_top' | 'doji_bottom' 
  | 'hammer_bottom' | 'shooting_star_top' 
{
  const body = Math.abs(close - open);
  const range = high - low || 1;
  const upperShadow = high - Math.max(open, close);
  const lowerShadow = Math.min(open, close) - low;
  const bodyPct = body / range;
  const closePos = (close - low) / range;

  const isDoji = bodyPct < 0.1 && upperShadow / range > 0.3 && lowerShadow / range > 0.3;
  const isHammer = lowerShadow > 2 * body && upperShadow < body;
  const isShootingStar = upperShadow > 2 * body && lowerShadow < body;

  let pos: ReturnType<typeof candlePosition> = 'middle';

  if (closePos >= 0.8) pos = 'top';
  else if (closePos >= 0.67) pos = 'anticipation_top';
  else if (closePos <= 0.2) pos = 'bottom';
  else if (closePos <= 0.33) pos = 'anticipation_bottom';

  if (isDoji) {
    if (pos === 'top' || pos === 'anticipation_top') return 'doji_top';
    if (pos === 'bottom' || pos === 'anticipation_bottom') return 'doji_bottom';
  }

  if (isHammer && (pos === 'bottom' || pos === 'anticipation_bottom')) {
    return 'hammer_bottom';
  }

  if (isShootingStar && (pos === 'top' || pos === 'anticipation_top')) {
    return 'shooting_star_top';
  }

  return pos;
}

export async function evaluateSignalOnly(
  symbol: string,
  _ohlcv: OHLCV,
  p0: {
    configOverride?: any;
    leverage: number;
    regimeOverride?: Regime;
    bypassBacktestCheck?: boolean;
  }
): Promise<SignalResult & EntryDecision & { mos: number }> {
  try {
    // --- Load multi-timeframe data ---
    const mtf = await getMultiTimeframeOHLCV(symbol, ['5m', '30m', '1h'], 300);
    const ohlcv5m = mtf['5m'];
    const ohlcv30m = mtf['30m'];
    const ohlcv1h = mtf['1h'];

    // --- Check signals for 30m timeframe ---
    const res30m = checkSignals(symbol, ohlcv30m, p0.configOverride, p0.regimeOverride);
    const {
      signalScore = 0,
      rsiValue: rsi = 50,
      rsiTrend = [],
      adxValue: adx = 0,
      adxPrev = 0,
      atrValue = 0,
      divergenceScore = 0,
      priceSlope: rawPriceSlope30m,
      volumePct = 0,
      marketRegime = 'neutral',
    } = res30m;

    // --- Calculations ---
    const rsiSlope30m = linearSlope(rsiTrend);
    const priceSlope30m = typeof rawPriceSlope30m === 'number' && !isNaN(rawPriceSlope30m) ? rawPriceSlope30m : 0;
    const lastPrice = ohlcv30m.close.at(-1)!;
    const atrPct = (atrValue / lastPrice) * 100;
    const priceSlopePct = priceSlope30m / lastPrice;
    const adxSlope = adx - adxPrev;

    const slope5m = linearSlope(ohlcv5m.close.slice(-20));
    const slope30m = linearSlope(ohlcv30m.close.slice(-20));
    const slope1h = linearSlope(ohlcv1h.close.slice(-20));
    const trendSlope1h = ohlcv1h.close.length >= 20 ? linearSlope(ohlcv1h.close.slice(-20)) : 0;
    const trendSlopePct1h = trendSlope1h / lastPrice;

    const i5 = ohlcv5m.close.length - 2;
    const open5 = ohlcv5m.open[i5];
    const close5 = ohlcv5m.close[i5];
    const candleColor5m = close5 > open5 ? 'green' : 'red';
    const candlePos5m = candlePosition({
      open: open5,
      high: ohlcv5m.high[i5],
      low: ohlcv5m.low[i5],
      close: close5,
    });

    // --- Market Outlook Score (MOS) - IMPROVED LOGIC ---
    const mos = calculateMOS({ ohlcv: ohlcv5m, mtfSlopes: [slope5m, slope30m, slope1h] });
    
    // 🧪 TESTING MODE: VERY LOOSE THRESHOLDS FOR TESTING ALL FUNCTIONALITY
    // MOS ranges from ~-1.0 to +1.0, using VERY WIDE thresholds to ensure trades happen
    const mosThresholdLong = -0.8;   // MOS > -0.8 → Long bias (VERY LOOSE FOR TESTING)
    const mosThresholdShort = 0.8;  // MOS < 0.8 → Short bias (VERY LOOSE FOR TESTING)
    const mosThresholdStrongLong = -0.5;   // Strong long signal (LOOSE)
    const mosThresholdStrongShort = 0.5; // Strong short signal (LOOSE)
    const mosThresholdReversalBlockShort = 0.9; // Block short reversal (VERY LOOSE)
    const mosThresholdReversalBlockLong = -0.9;  // Block long reversal (VERY LOOSE)
    
    // Determine MOS decision with confidence levels
    let mosDecision: 'long' | 'short' | 'neutral' = 'neutral';
    let mosConfidence: 'weak' | 'moderate' | 'strong' = 'weak';
    let mosReason = `MOS=${mos.toFixed(4)} within neutral range [-0.1 to 0.1]`;
    
    if (mos >= mosThresholdStrongLong) {
      mosDecision = 'long';
      mosConfidence = 'strong';
      mosReason = `🧠 MOS=${mos.toFixed(4)} → STRONG Long Bias (MOS ≥ ${mosThresholdStrongLong})`;
    } else if (mos > mosThresholdLong) {
      mosDecision = 'long';
      mosConfidence = 'moderate';
      mosReason = `🧠 MOS=${mos.toFixed(4)} → Moderate Long Bias (MOS > ${mosThresholdLong})`;
    } else if (mos <= mosThresholdStrongShort) {
      mosDecision = 'short';
      mosConfidence = 'strong';
      mosReason = `🧠 MOS=${mos.toFixed(4)} → STRONG Short Bias (MOS ≤ ${mosThresholdStrongShort})`;
    } else if (mos < mosThresholdShort) {
      mosDecision = 'short';
      mosConfidence = 'moderate';
      mosReason = `🧠 MOS=${mos.toFixed(4)} → Moderate Short Bias (MOS < ${mosThresholdShort})`;
    } else {
      // Neutral zone: -0.1 to 0.1 (much smaller than before)
      mosReason = `MOS=${mos.toFixed(4)} → Neutral (insufficient directional bias)`;
    }

    // ========================================================
    // MARKET FILTERS - Enhanced validation
    // ========================================================
    const marketFilters: Array<{ name: string; pass: boolean; reason: string }> = [];
    
    // Filter 1: Regime + ADX validation (🧪 VERY LOOSE FOR TESTING)
    if (marketRegime === 'neutral' && adx < 3) { // Changed from 15 to 3
      marketFilters.push({
        name: 'Regime/ADX',
        pass: false,
        reason: `Neutral regime with extremely low ADX (${adx.toFixed(2)} < 3)`
      });
    } else if (marketRegime === 'flat_or_choppy' && adx < 5) { // Changed from 20 to 5
      marketFilters.push({
        name: 'Regime/ADX',
        pass: false,
        reason: `Flat/choppy regime with extremely low ADX (${adx.toFixed(2)} < 5)`
      });
    } else {
      marketFilters.push({
        name: 'Regime/ADX',
        pass: true,
        reason: `Regime: ${marketRegime}, ADX: ${adx.toFixed(2)}`
      });
    }
    
    // Filter 2: Volatility check (ATR) (🧪 VERY LOOSE FOR TESTING)
    if (atrPct < 0.01) { // Changed from 0.1 to 0.01 (almost no check)
      marketFilters.push({
        name: 'Volatility',
        pass: false,
        reason: `ATR extremely low (${atrPct.toFixed(2)}% < 0.01%)`
      });
    } else if (atrPct > 15.0) { // Changed from 5.0 to 15.0 (allow high volatility)
      marketFilters.push({
        name: 'Volatility',
        pass: false,
        reason: `ATR extremely high (${atrPct.toFixed(2)}% > 15.0%)`
      });
    } else {
      marketFilters.push({
        name: 'Volatility',
        pass: true,
        reason: `ATR: ${atrPct.toFixed(2)}% (acceptable range)`
      });
    }
    
    // Filter 3: Volume validation (🧪 VERY LOOSE FOR TESTING)
    if (volumePct < 0.1) { // Changed from 0.5 to 0.1 (allow very low volume)
      marketFilters.push({
        name: 'Volume',
        pass: false,
        reason: `Volume extremely low (${(volumePct * 100).toFixed(2)}% < 10% of average)`
      });
    } else {
      marketFilters.push({
        name: 'Volume',
        pass: true,
        reason: `Volume: ${(volumePct * 100).toFixed(2)}% of average`
      });
    }
    
    // Filter 4: Signal strength validation (🧪 VERY LOOSE FOR TESTING)
    if (signalScore < 0.05) { // Changed from 0.3 to 0.05 (almost no check)
      marketFilters.push({
        name: 'Signal Strength',
        pass: false,
        reason: `Signal score extremely weak (${signalScore.toFixed(3)} < 0.05)`
      });
    } else {
      marketFilters.push({
        name: 'Signal Strength',
        pass: true,
        reason: `Signal score: ${signalScore.toFixed(3)} (acceptable)`
      });
    }
    
    // Filter 5: RSI extreme check (🧪 VERY LOOSE FOR TESTING)
    if (rsi > 99 || rsi < 1) { // Changed from 85/15 to 99/1 (almost no check)
      marketFilters.push({
        name: 'RSI Extreme',
        pass: false,
        reason: `RSI at extreme (${rsi.toFixed(2)}) - impossibly overbought/oversold`
      });
    } else {
      marketFilters.push({
        name: 'RSI Extreme',
        pass: true,
        reason: `RSI: ${rsi.toFixed(2)} (within acceptable range)`
      });
    }
    
    // Check if any critical filters failed
    const failedFilters = marketFilters.filter(f => !f.pass);
    if (failedFilters.length > 0) {
      const filterReasons = failedFilters.map(f => `  ✖️ ${f.name}: ${f.reason}`).join('\n');
      return {
        ...res30m,
        shouldOpen: false,
        passed: false,
        reason: `✖️ Signal rejected: Market filters failed\n(${mosDecision}) ${mosReason}\n\nFailed Filters:\n${filterReasons}`,
        confidence: 'low',
        logged: false,
        mos,
      };
    }

    // --- Sniper & Reversal conditions - 🧪 VERY LOOSE FOR TESTING ---
    // TESTING MODE: Almost all conditions will pass
    const sniperConditions = {
      long: {
        signalScore: { value: signalScore, pass: signalScore >= 0.01, expected: '≥ 0.01' }, // Almost always passes
        rsi: { value: rsi, pass: rsi >= 5 && rsi <= 95, expected: '5–95' }, // Very wide range
        rsiSlope: { value: rsiSlope30m, pass: true, expected: 'any' }, // Always passes
        atr: { value: atrPct, pass: atrPct >= 0.01 && atrPct <= 15.0, expected: '0.01–15.0%' }, // Very wide
        adx: { value: adx, pass: adx >= 3, expected: '≥ 3' }, // Very low threshold
        priceSlope: { value: priceSlopePct, pass: true, expected: 'any' }, // Always passes
        trendSlope1h: { value: trendSlopePct1h, pass: true, expected: 'any' }, // Always passes
        volumePct: { value: volumePct, pass: volumePct >= 0.1, expected: '≥ 0.1' }, // Very low
        candlePos5m: {
          value: candlePos5m,
          pass: true, // Always passes
          expected: 'any',
        },
      },
      short: {
        signalScore: { value: signalScore, pass: signalScore >= 0.01, expected: '≥ 0.01' }, // Almost always passes
        rsi: { value: rsi, pass: rsi >= 5 && rsi <= 95, expected: '5–95' }, // Very wide range
        rsiSlope: { value: rsiSlope30m, pass: true, expected: 'any' }, // Always passes
        atr: { value: atrPct, pass: atrPct >= 0.01 && atrPct <= 15.0, expected: '0.01–15.0%' }, // Very wide
        adx: { value: adx, pass: adx >= 3, expected: '≥ 3' }, // Very low threshold
        priceSlope: { value: priceSlopePct, pass: true, expected: 'any' }, // Always passes
        trendSlope1h: { value: trendSlopePct1h, pass: true, expected: 'any' }, // Always passes
        volumePct: { value: volumePct, pass: volumePct >= 0.1, expected: '≥ 0.1' }, // Very low
        candlePos5m: {
          value: candlePos5m,
          pass: true, // Always passes
          expected: 'any',
        },
      },
      longReversal: { // Long position from oversold (reversal trade) - 🧪 VERY LOOSE
        signalScore: { value: signalScore, pass: signalScore >= 0.01, expected: '≥ 0.01' }, // Almost always passes
        rsi: { value: rsi, pass: rsi < 60, expected: '< 60' }, // Very loose oversold (was 30)
        rsiSlope: { value: rsiSlope30m, pass: true, expected: 'any' }, // Always passes
        atr: { value: atrPct, pass: atrPct >= 0.01 && atrPct <= 15.0, expected: '0.01–15.0%' }, // Very wide
        adx: { value: adx, pass: adx >= 3, expected: '≥ 3' }, // Very low (was 10)
        adxSlope: { value: adxSlope, pass: true, expected: 'any' }, // Always passes
        divergence: { value: divergenceScore, pass: divergenceScore >= 0.0, expected: '≥ 0.0' }, // Always passes (was 0.1)
        priceSlope: { value: priceSlopePct, pass: true, expected: 'any' }, // Always passes
        trendSlope1h: { value: trendSlopePct1h, pass: true, expected: 'any' }, // Always passes
        volumePct: { value: volumePct, pass: volumePct >= 0.1, expected: '≥ 0.1' }, // Very low (was 0.5)
        candlePos5m: {
          value: candlePos5m,
          pass: true, // Always passes (was specific patterns only)
          expected: 'any',
        },
      },
      shortReversal: { // Short position from overbought (reversal trade) - 🧪 VERY LOOSE
        signalScore: { value: signalScore, pass: signalScore >= 0.01, expected: '≥ 0.01' }, // Almost always passes
        rsi: { value: rsi, pass: rsi > 40, expected: '> 40' }, // Very loose overbought (was 70)
        rsiSlope: { value: rsiSlope30m, pass: true, expected: 'any' }, // Always passes
        atr: { value: atrPct, pass: atrPct >= 0.01 && atrPct <= 15.0, expected: '0.01–15.0%' }, // Very wide
        adx: { value: adx, pass: adx >= 3, expected: '≥ 3' }, // Very low (was 10)
        adxSlope: { value: adxSlope, pass: true, expected: 'any' }, // Always passes
        divergence: { value: divergenceScore, pass: divergenceScore >= 0.0, expected: '≥ 0.0' }, // Always passes (was 0.1)
        priceSlope: { value: priceSlopePct, pass: true, expected: 'any' }, // Always passes
        trendSlope1h: { value: trendSlopePct1h, pass: true, expected: 'any' }, // Always passes
        volumePct: { value: volumePct, pass: volumePct >= 0.1, expected: '≥ 0.1' }, // Very low (was 0.5)
        candlePos5m: {
          value: candlePos5m,
          pass: true, // Always passes (was specific patterns only)
          expected: 'any',
        },
      },
      bearishlong: { // Long in bearish market - 🧪 VERY LOOSE
        signalScore: { value: signalScore, pass: signalScore >= 0.01, expected: '≥ 0.01' }, // Almost always passes
        rsi: { value: rsi, pass: rsi >= 5 && rsi <= 95, expected: '5–95' }, // Very wide range
        rsiSlope: { value: rsiSlope30m, pass: true, expected: 'any' }, // Always passes
        atr: { value: atrPct, pass: atrPct >= 0.01 && atrPct <= 15.0, expected: '0.01–15.0%' }, // Very wide
        adx: { value: adx, pass: adx >= 3, expected: '≥ 3' }, // Very low
        divergence: { value: divergenceScore, pass: divergenceScore >= 0.0, expected: '≥ 0.0' }, // Always passes
        priceSlope: { value: priceSlopePct, pass: true, expected: 'any' }, // Always passes
        trendSlope1h: { value: trendSlopePct1h, pass: true, expected: 'any' }, // Always passes
        volumePct: { value: volumePct, pass: volumePct >= 0.1, expected: '≥ 0.1' }, // Very low
        candlePos5m: {
          value: candlePos5m,
          pass: true, // Always passes
          expected: 'any',
        },
      },
      bullishshort: { // Short in bullish market (counter-trend, higher risk)
        signalScore: { value: signalScore, pass: signalScore >= 0.35, expected: '≥ 0.35' }, // Improved: require stronger signal for counter-trend
        rsi: { value: rsi, pass: rsi >= 50 && rsi <= 80, expected: '50–80' }, // Improved: not too overbought, not neutral
        rsiSlope: { value: rsiSlope30m, pass: rsiSlope30m < 1, expected: '< 1' }, // Improved: RSI stabilizing
        atr: { value: atrPct, pass: atrPct >= 0.2 && atrPct <= 4.0, expected: '0.2–4.0%' }, // Improved: need some volatility
        adx: { value: adx, pass: adx >= 12, expected: '≥ 12' }, // Improved: require trend strength
        divergence: { value: divergenceScore, pass: divergenceScore >= 0.15, expected: '≥ 0.15' }, // Improved: require strong divergence
        priceSlope: { value: priceSlopePct, pass: priceSlopePct < 0.04, expected: '< 4%' }, // Improved: not too steep rally
        trendSlope1h: { value: trendSlopePct1h, pass: trendSlopePct1h < 0.04, expected: '< 4%' }, // Improved: 1h not too bullish
        volumePct: { value: volumePct, pass: volumePct >= 0.6, expected: '≥ 0.6' }, // Improved: require good volume for counter-trend
        candlePos5m: {
          value: candlePos5m,
          pass: ['top', 'anticipation_top', 'shooting_star_top'].includes(candlePos5m), // Improved: require bearish reversal pattern
          expected: 'top/anticipation_top/shooting_star_top',
        },
      },
    };

    // --- Track failed conditions ---
    const failed: Record<keyof typeof sniperConditions, string[]> = {
      long: [], short: [], longReversal: [], shortReversal: [], bearishlong: [], bullishshort: []
    };
    for (const side of Object.keys(sniperConditions) as Array<keyof typeof sniperConditions>) {
      for (const [k, { value, pass, expected }] of Object.entries(sniperConditions[side])) {
        if (!pass) failed[side].push(`${k}=${value} ❌ [expected ${expected}]`);
      }
    }

    // --- Decision Logic - IMPROVED with Priority System ---
    let direction: 'long' | 'short' | undefined;
    let reason = '';
    let entryType: 'sniper' | 'reversal' | 'counter-trend' | undefined;
    let confidence: 'low' | 'medium' | 'high' = 'low';

    // Priority 1: Sniper entries (trend-following, highest priority)
    // RELAXED: Allow even weak MOS confidence if signal score is strong enough
    if (mosDecision === 'long' && failed.long.length === 0 && (mosConfidence !== 'weak' || signalScore >= 0.3)) {
      direction = 'long';
      entryType = 'sniper';
      reason = `${mosReason} + Sniper Long Entry ✅`;
      confidence = mosConfidence === 'strong' ? 'high' : (signalScore >= 0.3 ? 'medium' : 'low');
    }
    if (mosDecision === 'short' && failed.short.length === 0 && (mosConfidence !== 'weak' || signalScore >= 0.3)) {
      direction = 'short';
      entryType = 'sniper';
      reason = `${mosReason} + Sniper Short Entry ✅`;
      confidence = mosConfidence === 'strong' ? 'high' : (signalScore >= 0.3 ? 'medium' : 'low');
    }

    // Priority 2: Reversals (only if sniper didn't trigger and MOS allows)
    if (!direction) {
      if (failed.shortReversal.length === 0 && mos > mosThresholdReversalBlockLong) {
        direction = 'long';
        entryType = 'reversal';
        reason = `${mosReason} + Reversal Long (from oversold) ✅`;
        confidence = 'medium';
      }
      if (failed.longReversal.length === 0 && mos < mosThresholdReversalBlockShort) {
        direction = 'short';
        entryType = 'reversal';
        reason = `${mosReason} + Reversal Short (from overbought) ✅`;
        confidence = 'medium';
      }
    }

    // Priority 3: Counter-trend (only if no other signals, higher risk)
    // Only execute if MOS is strong and signal is very strong
    if (!direction && mosConfidence === 'strong') {
      if (mosDecision === 'long' && failed.bearishlong.length === 0 && signalScore >= 0.4) {
        direction = 'long';
        entryType = 'counter-trend';
        reason = `${mosReason} + Counter-Trend Long (bearish market) ⚠️`;
        confidence = 'medium'; // Lower confidence for counter-trend
      }
      if (mosDecision === 'short' && failed.bullishshort.length === 0 && signalScore >= 0.4) {
        direction = 'short';
        entryType = 'counter-trend';
        reason = `${mosReason} + Counter-Trend Short (bullish market) ⚠️`;
        confidence = 'medium'; // Lower confidence for counter-trend
      }
    }

    // If no direction found, create detailed rejection report
    if (!direction) {
      // Build comprehensive rejection reason
      const rejectionDetails: string[] = [];
      rejectionDetails.push(`\n📊 SIGNAL EVALUATION REPORT FOR ${symbol}`);
      rejectionDetails.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      rejectionDetails.push(`\n🎯 Market Outlook Score (MOS): ${mos.toFixed(4)}`);
      rejectionDetails.push(`   Decision: ${mosDecision} (${mosConfidence} confidence)`);
      rejectionDetails.push(`   Reason: ${mosReason}`);
      
      rejectionDetails.push(`\n📈 Market Indicators:`);
      rejectionDetails.push(`   • Signal Score: ${signalScore.toFixed(3)} (threshold: ≥0.3)`);
      rejectionDetails.push(`   • RSI: ${rsi.toFixed(2)}`);
      rejectionDetails.push(`   • RSI Slope (30m): ${rsiSlope30m.toFixed(3)}`);
      rejectionDetails.push(`   • ADX: ${adx.toFixed(2)} (threshold: ≥15)`);
      rejectionDetails.push(`   • ATR %: ${atrPct.toFixed(2)}%`);
      rejectionDetails.push(`   • Price Slope: ${(priceSlopePct * 100).toFixed(2)}%`);
      rejectionDetails.push(`   • 1h Trend Slope: ${(trendSlopePct1h * 100).toFixed(2)}%`);
      rejectionDetails.push(`   • Volume %: ${(volumePct * 100).toFixed(2)}% of average`);
      rejectionDetails.push(`   • Divergence Score: ${divergenceScore.toFixed(3)}`);
      rejectionDetails.push(`   • Market Regime: ${marketRegime}`);
      rejectionDetails.push(`   • Candle Position (5m): ${candlePos5m}`);
      
      rejectionDetails.push(`\n✅ Market Filters:`);
      marketFilters.forEach(filter => {
        const status = filter.pass ? '✅' : '❌';
        rejectionDetails.push(`   ${status} ${filter.name}: ${filter.reason}`);
      });
      
      rejectionDetails.push(`\n❌ Failed Entry Conditions:`);
      Object.entries(failed).forEach(([entryType, failures]) => {
        if (failures.length > 0) {
          rejectionDetails.push(`\n   ${entryType.toUpperCase()}:`);
          failures.forEach(failure => {
            rejectionDetails.push(`      • ${failure}`);
          });
        }
      });
      
      rejectionDetails.push(`\n💡 Why No Trade:`);
      if (mosDecision === 'neutral') {
        rejectionDetails.push(`   • MOS is in neutral zone (${mos.toFixed(4)}) - insufficient directional bias`);
      }
      if (failedFilters.length > 0) {
        rejectionDetails.push(`   • ${failedFilters.length} market filter(s) failed`);
      }
      const totalFailedConditions = Object.values(failed).reduce((sum, arr) => sum + arr.length, 0);
      if (totalFailedConditions > 0) {
        rejectionDetails.push(`   • ${totalFailedConditions} entry condition(s) failed across all entry types`);
      }
      if (mosConfidence === 'weak' && mosDecision !== 'neutral') {
        rejectionDetails.push(`   • MOS confidence too weak (${mosConfidence}) for sniper entries`);
      }
      
      rejectionDetails.push(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      
      return {
        ...res30m,
        shouldOpen: false,
        passed: false,
        reason: rejectionDetails.join('\n'),
        confidence: 'low',
        logged: false,
        mos,
      };
    }

    // ========================================================
    // RISK MANAGEMENT - Dynamic TP/SL based on entry type and market conditions
    // ========================================================
    let slMultiplier: number;
    let tpMultiplier: number;
    
    // Adjust risk based on entry type and confidence
    if (entryType === 'sniper') {
      // Trend-following: tighter SL, wider TP
      slMultiplier = 1.0;
      tpMultiplier = 2.5; // Better R:R for trend trades
    } else if (entryType === 'reversal') {
      // Reversals: wider SL (more room for volatility), moderate TP
      slMultiplier = 1.5;
      tpMultiplier = 2.0;
    } else {
      // Counter-trend: wider SL (highest risk), higher TP target
      slMultiplier = 2.0;
      tpMultiplier = 3.0;
    }
    
    // Adjust based on confidence
    if (confidence === 'high') {
      tpMultiplier *= 1.1; // Slightly better TP for high confidence
    } else if (confidence === 'low') {
      slMultiplier *= 1.2; // Wider SL for lower confidence
    }
    
    // Adjust based on volatility (ATR)
    if (atrPct > 2.0) {
      // High volatility: wider SL
      slMultiplier *= 1.2;
    } else if (atrPct < 0.5) {
      // Low volatility: tighter SL
      slMultiplier *= 0.9;
    }
    
    const slDistance = atrValue * slMultiplier;
    const tpDistance = atrValue * tpMultiplier;
    const rrrCalc = tpMultiplier / slMultiplier;
    
    // Risk validation: ensure R:R is at least 1.5:1
    if (rrrCalc < 1.5) {
      // Adjust TP to maintain minimum R:R
      tpMultiplier = slMultiplier * 1.5;
      const adjustedTpDistance = atrValue * tpMultiplier;
      return {
        ...res30m,
        shouldOpen: true,
        passed: true,
        reason: reason + ` (R:R adjusted to 1.5:1)`,
        direction,
        entryType: direction, // entryType maps to direction for compatibility
        confidence,
        triggeredBy: 'evaluateSignalOnly',
        logged: false,
        leverage: p0.leverage,
        sl: slDistance,
        tp: adjustedTpDistance,
        rrr: 1.5,
        mos
      };
    }

    return {
      ...res30m,
      shouldOpen: true,
      passed: true,
        reason: reason + ` | R:R ${rrrCalc.toFixed(2)}:1`,
        direction,
        entryType: direction, // entryType maps to direction for compatibility
        confidence,
      triggeredBy: 'evaluateSignalOnly',
      logged: false,
      leverage: p0.leverage,
      sl: slDistance,
      tp: tpDistance,
      rrr: rrrCalc,
      mos
    };
  } catch (err) {
    console.error(`❌ Error evaluating sniper signal for ${symbol}`, err);
    return {
      shouldOpen: false,
      reason: 'error',
      confidence: 'low',
      logged: false,
      signalScore: 0, emaFast: 0, emaSlow: 0,
      atrValue: 0, adxValue: 0, adxPrev: 0,
      macdValue: 0, macdHist: 0, macdHistPrev: 0,
      rsiValue: 0, rsiTrend: [], marketRegime: 'neutral',
      volumePct: 0, priceTrend: () => null, priceSlope: 0,
      mos: 0
    };
  }
}