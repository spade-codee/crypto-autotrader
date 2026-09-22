import Decimal from 'decimal.js';

/** One OHLCV bar. `time` is the candle OPEN time, in epoch milliseconds, UTC. */
export type Candle = {
  time: number;
  open: Decimal;
  high: Decimal;
  low: Decimal;
  close: Decimal;
  volume: Decimal;
};

/** What the strategy wants the account to be holding. */
export type TargetState = 'LONG' | 'FLAT';

/**
 * A strategy is a pure function from price history to a desired state.
 *
 * `candles` contains history up to AND INCLUDING the candle whose close is
 * being evaluated. It must never contain a future candle — the engine
 * guarantees this, and the strategy must not assume anything beyond it.
 */
export type StrategyFn = (candles: Candle[]) => TargetState;

export type StrategyConfig = {
  /** Number of candles in the moving average. */
  maPeriod: number;
};

export type CostModel = {
  /** Taker fee as a fraction of notional. Bybit spot taker is 0.001 (0.1%). */
  feeRate: Decimal;
  /** Adverse price movement as a fraction, applied against us on both sides. */
  slippageRate: Decimal;
};

export type Trade = {
  time: number;
  side: 'BUY' | 'SELL';
  /** Fill price after slippage. */
  price: Decimal;
  quantity: Decimal;
  fee: Decimal;
};

export type EquityPoint = {
  time: number;
  /** Cash plus mark-to-market value of holdings, at this candle's close. */
  equity: Decimal;
  state: TargetState;
};

export type Metrics = {
  initialCapital: Decimal;
  finalEquity: Decimal;
  totalReturn: Decimal;
  cagr: Decimal;
  maxDrawdown: Decimal;
  sharpe: Decimal;
  tradeCount: number;
  /** Fraction of days holding the asset, 0 to 1. */
  exposure: Decimal;
  /** Fraction of completed round trips that were profitable, 0 to 1. */
  winRate: Decimal;
  totalFees: Decimal;
};

export type BacktestResult = {
  label: string;
  trades: Trade[];
  equityCurve: EquityPoint[];
  metrics: Metrics;
};

/** Whether an account may trade. Only `active` accounts do. */
export type AccountStatus = 'active' | 'paused' | 'frozen';
