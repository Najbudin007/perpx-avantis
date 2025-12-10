import { Regime } from './regime';
import { OHLCV, SignalResult } from './signals';
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
export declare function evaluateSignalOnly(symbol: string, _ohlcv: OHLCV, p0: {
    configOverride?: any;
    leverage: number;
    regimeOverride?: Regime;
    bypassBacktestCheck?: boolean;
}): Promise<SignalResult & EntryDecision & {
    mos: number;
}>;
//# sourceMappingURL=strategyEngine.d.ts.map