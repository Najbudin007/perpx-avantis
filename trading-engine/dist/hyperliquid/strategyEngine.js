"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateSignalOnly = evaluateSignalOnly;
const signals_1 = require("./signals");
const binanceHistorical_1 = require("./binanceHistorical");
function candlePosition({ open, close, high, low }) {
    const body = Math.abs(close - open);
    const range = high - low || 1;
    const upperShadow = high - Math.max(open, close);
    const lowerShadow = Math.min(open, close) - low;
    const bodyPct = body / range;
    const closePos = (close - low) / range;
    const isDoji = bodyPct < 0.1 && upperShadow / range > 0.3 && lowerShadow / range > 0.3;
    const isHammer = lowerShadow > 2 * body && upperShadow < body;
    const isShootingStar = upperShadow > 2 * body && lowerShadow < body;
    let pos = 'middle';
    if (closePos >= 0.8)
        pos = 'top';
    else if (closePos >= 0.67)
        pos = 'anticipation_top';
    else if (closePos <= 0.2)
        pos = 'bottom';
    else if (closePos <= 0.33)
        pos = 'anticipation_bottom';
    if (isDoji) {
        if (pos === 'top' || pos === 'anticipation_top')
            return 'doji_top';
        if (pos === 'bottom' || pos === 'anticipation_bottom')
            return 'doji_bottom';
    }
    if (isHammer && (pos === 'bottom' || pos === 'anticipation_bottom')) {
        return 'hammer_bottom';
    }
    if (isShootingStar && (pos === 'top' || pos === 'anticipation_top')) {
        return 'shooting_star_top';
    }
    return pos;
}
async function evaluateSignalOnly(symbol, _ohlcv, p0) {
    try {
        // --- Load multi-timeframe data ---
        const mtf = await (0, binanceHistorical_1.getMultiTimeframeOHLCV)(symbol, ['5m', '30m', '1h'], 300);
        const ohlcv5m = mtf['5m'];
        const ohlcv30m = mtf['30m'];
        const ohlcv1h = mtf['1h'];
        // --- Check signals for 30m timeframe ---
        const res30m = (0, signals_1.checkSignals)(symbol, ohlcv30m, p0.configOverride, p0.regimeOverride);
        const { signalScore = 0, rsiValue: rsi = 50, rsiTrend = [], adxValue: adx = 0, adxPrev = 0, atrValue = 0, divergenceScore = 0, priceSlope: rawPriceSlope30m, volumePct = 0, marketRegime = 'neutral', } = res30m;
        // --- Calculations ---
        const rsiSlope30m = (0, signals_1.linearSlope)(rsiTrend);
        const priceSlope30m = typeof rawPriceSlope30m === 'number' && !isNaN(rawPriceSlope30m) ? rawPriceSlope30m : 0;
        const lastPrice = ohlcv30m.close.at(-1);
        const atrPct = (atrValue / lastPrice) * 100;
        const priceSlopePct = priceSlope30m / lastPrice;
        const adxSlope = adx - adxPrev;
        const slope5m = (0, signals_1.linearSlope)(ohlcv5m.close.slice(-20));
        const slope30m = (0, signals_1.linearSlope)(ohlcv30m.close.slice(-20));
        const slope1h = (0, signals_1.linearSlope)(ohlcv1h.close.slice(-20));
        const trendSlope1h = ohlcv1h.close.length >= 20 ? (0, signals_1.linearSlope)(ohlcv1h.close.slice(-20)) : 0;
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
        const mos = (0, signals_1.calculateMOS)({ ohlcv: ohlcv5m, mtfSlopes: [slope5m, slope30m, slope1h] });
        // ⚡ OPTIMIZED MODE: Relaxed thresholds for faster entries with quality
        // MOS ranges from ~-1.0 to +1.0, using looser thresholds for quicker trades
        const mosThresholdLong = 0.05; // MOS > 0.05 → Long bias (relaxed)
        const mosThresholdShort = -0.05; // MOS < -0.05 → Short bias (relaxed)
        const mosThresholdStrongLong = 0.20; // Strong long signal (reduced)
        const mosThresholdStrongShort = -0.20; // Strong short signal (reduced)
        const mosThresholdReversalBlockShort = 0.6; // Block short reversal when very bullish
        const mosThresholdReversalBlockLong = -0.6; // Block long reversal when very bearish
        // Determine MOS decision with confidence levels
        let mosDecision = 'neutral';
        let mosConfidence = 'weak';
        let mosReason = `MOS=${mos.toFixed(4)} within neutral range [-0.1 to 0.1]`;
        if (mos >= mosThresholdStrongLong) {
            mosDecision = 'long';
            mosConfidence = 'strong';
            mosReason = `🧠 MOS=${mos.toFixed(4)} → STRONG Long Bias (MOS ≥ ${mosThresholdStrongLong})`;
        }
        else if (mos > mosThresholdLong) {
            mosDecision = 'long';
            mosConfidence = 'moderate';
            mosReason = `🧠 MOS=${mos.toFixed(4)} → Moderate Long Bias (MOS > ${mosThresholdLong})`;
        }
        else if (mos <= mosThresholdStrongShort) {
            mosDecision = 'short';
            mosConfidence = 'strong';
            mosReason = `🧠 MOS=${mos.toFixed(4)} → STRONG Short Bias (MOS ≤ ${mosThresholdStrongShort})`;
        }
        else if (mos < mosThresholdShort) {
            mosDecision = 'short';
            mosConfidence = 'moderate';
            mosReason = `🧠 MOS=${mos.toFixed(4)} → Moderate Short Bias (MOS < ${mosThresholdShort})`;
        }
        else {
            // Neutral zone: -0.1 to 0.1 - no strong directional bias
            mosReason = `MOS=${mos.toFixed(4)} → Neutral (waiting for clearer signal)`;
        }
        // ========================================================
        // MARKET FILTERS - Optimized for faster entries with quality
        // ========================================================
        const marketFilters = [];
        // Filter 1: Regime + ADX validation (🔧 OPTIMIZED - less blocking in neutral)
        // Neutral regime is common, don't require high ADX - just some directional bias
        if (marketRegime === 'neutral' && adx < 10) {
            // Only block if ADX is very low (no direction at all)
            marketFilters.push({
                name: 'Regime/ADX',
                pass: false,
                reason: `Neutral regime with very low ADX (${adx.toFixed(2)} < 10) - completely directionless`
            });
        }
        else if (marketRegime === 'flat_or_choppy' && adx < 15) {
            // Choppy markets - still need some trend
            marketFilters.push({
                name: 'Regime/ADX',
                pass: false,
                reason: `Flat/choppy regime with weak ADX (${adx.toFixed(2)} < 15) - avoid choppy markets`
            });
        }
        else {
            marketFilters.push({
                name: 'Regime/ADX',
                pass: true,
                reason: `Regime: ${marketRegime}, ADX: ${adx.toFixed(2)}`
            });
        }
        // Filter 2: Volatility check (ATR) (🔧 OPTIMIZED - wider acceptable range)
        if (atrPct < 0.10) {
            // Only block if volatility is extremely low
            marketFilters.push({
                name: 'Volatility',
                pass: false,
                reason: `ATR too low (${atrPct.toFixed(2)}% < 0.10%) - insufficient volatility for profit`
            });
        }
        else if (atrPct > 8.0) {
            // Higher ATR tolerance for volatile markets
            marketFilters.push({
                name: 'Volatility',
                pass: false,
                reason: `ATR too high (${atrPct.toFixed(2)}% > 8.0%) - excessive risk`
            });
        }
        else {
            marketFilters.push({
                name: 'Volatility',
                pass: true,
                reason: `ATR: ${atrPct.toFixed(2)}% (acceptable range)`
            });
        }
        // Filter 3: Volume validation (🔧 OPTIMIZED - lower threshold)
        if (volumePct < 0.35) {
            // Only reject very low volume
            marketFilters.push({
                name: 'Volume',
                pass: false,
                reason: `Volume low (${(volumePct * 100).toFixed(2)}% < 35% of average) - low liquidity`
            });
        }
        else {
            marketFilters.push({
                name: 'Volume',
                pass: true,
                reason: `Volume: ${(volumePct * 100).toFixed(2)}% of average`
            });
        }
        // Filter 4: Signal strength validation (🔧 OPTIMIZED - lower threshold)
        if (signalScore < 0.18) {
            // Lower signal score threshold for faster entries
            marketFilters.push({
                name: 'Signal Strength',
                pass: false,
                reason: `Signal score weak (${signalScore.toFixed(3)} < 0.18) - insufficient conviction`
            });
        }
        else {
            marketFilters.push({
                name: 'Signal Strength',
                pass: true,
                reason: `Signal score: ${signalScore.toFixed(3)} (acceptable)`
            });
        }
        // Filter 5: RSI extreme check (🔧 OPTIMIZED - slightly wider range)
        if (rsi > 85 || rsi < 15) {
            // Only block at extreme RSI values
            marketFilters.push({
                name: 'RSI Extreme',
                pass: false,
                reason: `RSI at extreme (${rsi.toFixed(2)}) - overbought/oversold, reversal risk`
            });
        }
        else {
            marketFilters.push({
                name: 'RSI Extreme',
                pass: true,
                reason: `RSI: ${rsi.toFixed(2)} (within safe range)`
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
        // --- Sniper & Reversal conditions - ⚡ OPTIMIZED FOR FASTER ENTRIES ---
        // Relaxed thresholds for quicker position opening while maintaining quality
        const sniperConditions = {
            long: {
                signalScore: { value: signalScore, pass: signalScore >= 0.15, expected: '≥ 0.15' }, // Optimized: lower threshold
                rsi: { value: rsi, pass: rsi >= 20 && rsi <= 80, expected: '20–80' }, // Optimized: wider range
                rsiSlope: { value: rsiSlope30m, pass: rsiSlope30m > -3, expected: '> -3' }, // Optimized: more tolerance
                atr: { value: atrPct, pass: atrPct >= 0.08 && atrPct <= 10.0, expected: '0.08–10.0%' }, // Optimized: wider range
                adx: { value: adx, pass: adx >= 10, expected: '≥ 10' }, // Optimized: lower ADX requirement
                priceSlope: { value: priceSlopePct, pass: priceSlopePct > -0.08, expected: '> -8%' }, // Optimized: more tolerance
                trendSlope1h: { value: trendSlopePct1h, pass: trendSlopePct1h > -0.04, expected: '> -4%' }, // Optimized: more tolerance
                volumePct: { value: volumePct, pass: volumePct >= 0.35, expected: '≥ 0.35' }, // Optimized: lower volume req
                candlePos5m: {
                    value: candlePos5m,
                    pass: !['shooting_star_top'].includes(candlePos5m), // Only block clear reversal pattern
                    expected: 'not shooting star',
                },
            },
            short: {
                signalScore: { value: signalScore, pass: signalScore >= 0.15, expected: '≥ 0.15' }, // Optimized: lower threshold
                rsi: { value: rsi, pass: rsi >= 20 && rsi <= 80, expected: '20–80' }, // Optimized: wider range
                rsiSlope: { value: rsiSlope30m, pass: rsiSlope30m < 3, expected: '< 3' }, // Optimized: more tolerance
                atr: { value: atrPct, pass: atrPct >= 0.08 && atrPct <= 10.0, expected: '0.08–10.0%' }, // Optimized: wider range
                adx: { value: adx, pass: adx >= 10, expected: '≥ 10' }, // Optimized: lower ADX requirement
                priceSlope: { value: priceSlopePct, pass: priceSlopePct < 0.08, expected: '< 8%' }, // Optimized: more tolerance
                trendSlope1h: { value: trendSlopePct1h, pass: trendSlopePct1h < 0.04, expected: '< 4%' }, // Optimized: more tolerance
                volumePct: { value: volumePct, pass: volumePct >= 0.35, expected: '≥ 0.35' }, // Optimized: lower volume req
                candlePos5m: {
                    value: candlePos5m,
                    pass: !['hammer_bottom'].includes(candlePos5m), // Only block clear reversal pattern
                    expected: 'not hammer',
                },
            },
            longReversal: {
                signalScore: { value: signalScore, pass: signalScore >= 0.18, expected: '≥ 0.18' }, // Optimized: lower threshold
                rsi: { value: rsi, pass: rsi < 50, expected: '< 50' }, // Optimized: wider range
                rsiSlope: { value: rsiSlope30m, pass: rsiSlope30m > -2, expected: '> -2' }, // Optimized: more tolerance
                atr: { value: atrPct, pass: atrPct >= 0.1 && atrPct <= 8.0, expected: '0.1–8.0%' }, // Optimized: wider range
                adx: { value: adx, pass: adx >= 8, expected: '≥ 8' }, // Optimized: lower ADX
                adxSlope: { value: adxSlope, pass: adxSlope > -8, expected: '> -8' }, // Optimized: more tolerance
                divergence: { value: divergenceScore, pass: divergenceScore >= 0.02, expected: '≥ 0.02' }, // Optimized: lower divergence
                priceSlope: { value: priceSlopePct, pass: priceSlopePct > -0.06, expected: '> -6%' }, // Optimized: more tolerance
                trendSlope1h: { value: trendSlopePct1h, pass: trendSlopePct1h > -0.04, expected: '> -4%' }, // Optimized: more tolerance
                volumePct: { value: volumePct, pass: volumePct >= 0.30, expected: '≥ 0.30' }, // Optimized: lower volume
                candlePos5m: {
                    value: candlePos5m,
                    pass: !['shooting_star_top', 'top'].includes(candlePos5m), // Only block clear bearish patterns
                    expected: 'not clear bearish pattern',
                },
            },
            shortReversal: {
                signalScore: { value: signalScore, pass: signalScore >= 0.18, expected: '≥ 0.18' }, // Optimized: lower threshold
                rsi: { value: rsi, pass: rsi > 50, expected: '> 50' }, // Optimized: wider range
                rsiSlope: { value: rsiSlope30m, pass: rsiSlope30m < 2, expected: '< 2' }, // Optimized: more tolerance
                atr: { value: atrPct, pass: atrPct >= 0.1 && atrPct <= 8.0, expected: '0.1–8.0%' }, // Optimized: wider range
                adx: { value: adx, pass: adx >= 8, expected: '≥ 8' }, // Optimized: lower ADX
                adxSlope: { value: adxSlope, pass: adxSlope > -8, expected: '> -8' }, // Optimized: more tolerance
                divergence: { value: divergenceScore, pass: divergenceScore >= 0.02, expected: '≥ 0.02' }, // Optimized: lower divergence
                priceSlope: { value: priceSlopePct, pass: priceSlopePct < 0.06, expected: '< 6%' }, // Optimized: more tolerance
                trendSlope1h: { value: trendSlopePct1h, pass: trendSlopePct1h < 0.04, expected: '< 4%' }, // Optimized: more tolerance
                volumePct: { value: volumePct, pass: volumePct >= 0.30, expected: '≥ 0.30' }, // Optimized: lower volume
                candlePos5m: {
                    value: candlePos5m,
                    pass: !['hammer_bottom', 'bottom'].includes(candlePos5m), // Only block clear bullish patterns
                    expected: 'not clear bullish pattern',
                },
            },
            bearishlong: {
                signalScore: { value: signalScore, pass: signalScore >= 0.30, expected: '≥ 0.30' }, // Higher signal for counter-trend
                rsi: { value: rsi, pass: rsi >= 20 && rsi <= 40, expected: '20–40' }, // Oversold but not extreme
                rsiSlope: { value: rsiSlope30m, pass: rsiSlope30m > 0, expected: '> 0' }, // Must be turning up
                atr: { value: atrPct, pass: atrPct >= 0.3 && atrPct <= 5.0, expected: '0.3–5.0%' }, // Moderate volatility
                adx: { value: adx, pass: adx >= 18, expected: '≥ 18' }, // Need decent trend
                divergence: { value: divergenceScore, pass: divergenceScore >= 0.10, expected: '≥ 0.10' }, // Need divergence
                priceSlope: { value: priceSlopePct, pass: priceSlopePct > -0.02, expected: '> -2%' }, // Stabilizing
                trendSlope1h: { value: trendSlopePct1h, pass: trendSlopePct1h > -0.01, expected: '> -1%' }, // 1h stabilizing
                volumePct: { value: volumePct, pass: volumePct >= 0.60, expected: '≥ 0.60' }, // Good volume needed
                candlePos5m: {
                    value: candlePos5m,
                    pass: ['bottom', 'hammer_bottom', 'anticipation_bottom'].includes(candlePos5m), // Must show reversal
                    expected: 'strong bullish reversal',
                },
            },
            bullishshort: {
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
        const failed = {
            long: [], short: [], longReversal: [], shortReversal: [], bearishlong: [], bullishshort: []
        };
        for (const side of Object.keys(sniperConditions)) {
            for (const [k, { value, pass, expected }] of Object.entries(sniperConditions[side])) {
                if (!pass)
                    failed[side].push(`${k}=${value} ❌ [expected ${expected}]`);
            }
        }
        // --- Decision Logic - IMPROVED with Priority System ---
        let direction;
        let reason = '';
        let entryType;
        let confidence = 'low';
        // Priority 1: Sniper entries (trend-following, highest priority)
        // ⚡ OPTIMIZED: Allow weak MOS confidence if signal score is decent (>= 0.20)
        if (mosDecision === 'long' && failed.long.length === 0 && (mosConfidence !== 'weak' || signalScore >= 0.20)) {
            direction = 'long';
            entryType = 'sniper';
            reason = `${mosReason} + Sniper Long Entry ✅`;
            confidence = mosConfidence === 'strong' ? 'high' : (signalScore >= 0.25 ? 'medium' : 'low');
        }
        if (mosDecision === 'short' && failed.short.length === 0 && (mosConfidence !== 'weak' || signalScore >= 0.20)) {
            direction = 'short';
            entryType = 'sniper';
            reason = `${mosReason} + Sniper Short Entry ✅`;
            confidence = mosConfidence === 'strong' ? 'high' : (signalScore >= 0.25 ? 'medium' : 'low');
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
        // ⚡ OPTIMIZED: Allow with moderate MOS confidence and decent signal
        if (!direction && (mosConfidence === 'strong' || mosConfidence === 'moderate')) {
            if (mosDecision === 'long' && failed.bearishlong.length === 0 && signalScore >= 0.30) {
                direction = 'long';
                entryType = 'counter-trend';
                reason = `${mosReason} + Counter-Trend Long (bearish market) ⚠️`;
                confidence = 'medium'; // Lower confidence for counter-trend
            }
            if (mosDecision === 'short' && failed.bullishshort.length === 0 && signalScore >= 0.30) {
                direction = 'short';
                entryType = 'counter-trend';
                reason = `${mosReason} + Counter-Trend Short (bullish market) ⚠️`;
                confidence = 'medium'; // Lower confidence for counter-trend
            }
        }
        // If no direction found, create detailed rejection report
        if (!direction) {
            // Determine primary failure reason
            let primaryReason = 'No signal conditions met';
            let thresholdInfo = '';
            // Check which threshold failed first
            if (volumePct < 0.50) {
                primaryReason = `RVOL ${volumePct.toFixed(2)} below threshold 0.50`;
                thresholdInfo = `RVOL: ${volumePct.toFixed(2)}`;
            }
            else if (signalScore < 0.20) {
                primaryReason = `Signal score ${signalScore.toFixed(2)} below threshold 0.20`;
                thresholdInfo = `Score: ${signalScore.toFixed(2)}`;
            }
            else if (adx < 15) {
                primaryReason = `ADX ${adx.toFixed(2)} below threshold 15`;
                thresholdInfo = `ADX: ${adx.toFixed(2)}`;
            }
            else if (atrPct > 8.0) {
                primaryReason = `ATR% ${(atrPct * 100).toFixed(2)}% exceeds maximum 8.0%`;
                thresholdInfo = `ATR%: ${(atrPct * 100).toFixed(2)}%`;
            }
            else if (mosDecision === 'neutral') {
                primaryReason = `MOS ${mos.toFixed(4)} in neutral zone`;
                thresholdInfo = `MOS: ${mos.toFixed(4)}`;
            }
            // Concise rejection log (similar to user's example)
            console.log(`❌ ${symbol}: No signal. ${primaryReason}. 🕯️ Candle Positions - Entry: 30m, Signal: 2h, Trend: 6h | MOS: ${mos.toFixed(4)}, RVOL: ${volumePct.toFixed(2)}, RSI: ${rsi.toFixed(2)}, ATR%: ${(atrPct * 100).toFixed(2)}%`);
            // Build comprehensive rejection reason
            const rejectionDetails = [];
            rejectionDetails.push(`\n📊 SIGNAL EVALUATION REPORT FOR ${symbol}`);
            rejectionDetails.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            rejectionDetails.push(`\n🎯 Market Outlook Score (MOS): ${mos.toFixed(4)}`);
            rejectionDetails.push(`   Decision: ${mosDecision} (${mosConfidence} confidence)`);
            rejectionDetails.push(`   Reason: ${mosReason}`);
            rejectionDetails.push(`\n📈 Market Indicators:`);
            rejectionDetails.push(`   • Signal Score: ${signalScore.toFixed(3)} (threshold: ≥0.20)`);
            rejectionDetails.push(`   • RSI: ${rsi.toFixed(2)}`);
            rejectionDetails.push(`   • RSI Slope (30m): ${rsiSlope30m.toFixed(3)}`);
            rejectionDetails.push(`   • ADX: ${adx.toFixed(2)} (threshold: ≥15)`);
            rejectionDetails.push(`   • ATR %: ${(atrPct * 100).toFixed(2)}% (range: 0.1-8.0%)`);
            rejectionDetails.push(`   • Price Slope: ${(priceSlopePct * 100).toFixed(2)}%`);
            rejectionDetails.push(`   • 1h Trend Slope: ${(trendSlopePct1h * 100).toFixed(2)}%`);
            rejectionDetails.push(`   • Volume %: ${(volumePct * 100).toFixed(2)}% of average (threshold: ≥50%)`);
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
        let slMultiplier;
        let tpMultiplier;
        // Adjust risk based on entry type and confidence
        if (entryType === 'sniper') {
            // Trend-following: tighter SL, wider TP
            slMultiplier = 1.0;
            tpMultiplier = 2.5; // Better R:R for trend trades
        }
        else if (entryType === 'reversal') {
            // Reversals: wider SL (more room for volatility), moderate TP
            slMultiplier = 1.5;
            tpMultiplier = 2.0;
        }
        else {
            // Counter-trend: wider SL (highest risk), higher TP target
            slMultiplier = 2.0;
            tpMultiplier = 3.0;
        }
        // Adjust based on confidence
        if (confidence === 'high') {
            tpMultiplier *= 1.1; // Slightly better TP for high confidence
        }
        else if (confidence === 'low') {
            slMultiplier *= 1.2; // Wider SL for lower confidence
        }
        // Adjust based on volatility (ATR)
        if (atrPct > 2.0) {
            // High volatility: wider SL
            slMultiplier *= 1.2;
        }
        else if (atrPct < 0.5) {
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
        // Log successful signal detection
        console.log(`✅ ${symbol}: ${direction.toUpperCase()} signal detected! 🕯️ Candle Positions - Entry: 30m, Signal: 2h, Trend: 6h | MOS: ${mos.toFixed(4)}, RVOL: ${volumePct.toFixed(2)}, RSI: ${rsi.toFixed(2)}, Confidence: ${confidence}`);
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
    }
    catch (err) {
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
//# sourceMappingURL=strategyEngine.js.map