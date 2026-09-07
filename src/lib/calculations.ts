import { 
  Position, 
  PerformanceMetrics, 
  PortfolioHistoryPoint, 
  PortfolioHistoryResult, 
  BenchmarkKey, 
  BenchmarkComparisonPoint, 
  MultiBenchmarkPoint,
  ChartPeriod 
} from '../types';
import { getHistoricalPrices, getForexRates, convertToEur } from './marketApi';

/**
 * Solves XIRR using the Newton-Raphson method.
 * Cashflows: dates as numbers (time in ms), amounts where outflows are negative and current value is positive.
 */
export function calculateXIRR(
  cashflows: { date: Date; amount: number }[],
  guess: number = 0.1
): number {
  if (cashflows.length < 2) return 0;

  // Verify that there is at least one positive and one negative cash flow
  const hasPositive = cashflows.some(c => c.amount > 0);
  const hasNegative = cashflows.some(c => c.amount < 0);
  if (!hasPositive || !hasNegative) return 0;

  const d0 = cashflows[0].date.getTime();
  const maxIterations = 100;
  const tolerance = 1e-6;
  let rate = guess;

  const f = (r: number) => {
    return cashflows.reduce((sum, cf) => {
      const years = (cf.date.getTime() - d0) / (1000 * 60 * 60 * 24 * 365.25);
      return sum + cf.amount / Math.pow(1 + r, years);
    }, 0);
  };

  const df = (r: number) => {
    return cashflows.reduce((sum, cf) => {
      const years = (cf.date.getTime() - d0) / (1000 * 60 * 60 * 24 * 365.25);
      return sum - years * cf.amount / Math.pow(1 + r, years + 1);
    }, 0);
  };

  for (let i = 0; i < maxIterations; i++) {
    const val = f(rate);
    const deriv = df(rate);

    if (Math.abs(deriv) < 1e-10) break;

    const newRate = rate - val / deriv;

    // Prevent negative rates below -0.99 or wild explosions
    if (newRate <= -0.99) {
      rate = (rate - 0.99) / 2;
    } else {
      rate = newRate;
    }

    if (Math.abs(val) < tolerance) {
      return rate * 100;
    }
  }

  // Fallback simple annualized return if iteration doesn't converge
  const totalOutflow = Math.abs(cashflows.filter(c => c.amount < 0).reduce((s, c) => s + c.amount, 0));
  const inflow = cashflows.filter(c => c.amount > 0).reduce((s, c) => s + c.amount, 0);
  if (totalOutflow > 0) {
    const earliest = Math.min(...cashflows.map(c => c.date.getTime()));
    const latest = Math.max(...cashflows.map(c => c.date.getTime()));
    const years = Math.max(0.1, (latest - earliest) / (1000 * 60 * 60 * 24 * 365.25));
    const simpleAnnual = (Math.pow(inflow / totalOutflow, 1 / years) - 1) * 100;
    return isNaN(simpleAnnual) ? 0 : Math.min(Math.max(simpleAnnual, -99.9), 999.9);
  }

  return 0;
}

/**
 * Computes all performance metrics for the portfolio
 */
export function calculatePerformanceMetrics(
  positions: Position[],
  realHistoryPoints?: PortfolioHistoryPoint[]
): PerformanceMetrics {
  if (positions.length === 0) {
    return {
      xirr: 0,
      twr: 0,
      annualizedVolatility: 0,
      maxDrawdown: 0,
      totalInvestedEur: 0,
      currentValueEur: 0,
      totalReturnEur: 0,
      totalReturnPct: 0,
      bestPosition: null,
      worstPosition: null,
    };
  }

  let totalInvested = 0;
  let currentValue = 0;

  positions.forEach(p => {
    totalInvested += p.costBasisEur;
    currentValue += p.marketValueEur;
  });

  const totalReturnEur = currentValue - totalInvested;
  const totalReturnPct = totalInvested > 0 ? (totalReturnEur / totalInvested) * 100 : 0;

  // Cash flows for XIRR:
  // Outflows: purchase dates and cost bases (- amount)
  // Inflow: current date and total portfolio current value (+ amount)
  const cashflows: { date: Date; amount: number }[] = [];
  const sortedPositions = [...positions].sort(
    (a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime()
  );

  sortedPositions.forEach(p => {
    cashflows.push({
      date: new Date(p.openTime),
      amount: -p.costBasisEur,
    });
  });

  // Current terminal value
  cashflows.push({
    date: new Date(),
    amount: currentValue,
  });

  const xirr = calculateXIRR(cashflows);

  // Use real history points if available
  const historyPoints = realHistoryPoints || [];

  // Calculate daily returns adjusted for cash flows (new positions / capital additions)
  const dailyReturns: number[] = [];
  for (let i = 1; i < historyPoints.length; i++) {
    const prevVal = historyPoints[i - 1].portfolioValueEur;
    const currVal = historyPoints[i].portfolioValueEur;
    const prevCost = historyPoints[i - 1].costBasisEur;
    const currCost = historyPoints[i].costBasisEur;
    const deltaCash = currCost - prevCost;

    if (prevVal > 0) {
      if (deltaCash > 0) {
        // Cash inflow on day i: remove injected capital from end value before measuring return on pre-existing capital
        const adjustedReturn = (currVal - deltaCash - prevVal) / prevVal;
        dailyReturns.push(adjustedReturn);
      } else if (deltaCash < 0) {
        // Cash outflow: base is adjusted for capital withdrawn
        const effectiveBase = prevVal + deltaCash;
        const adjustedReturn = effectiveBase > 0 ? (currVal - effectiveBase) / effectiveBase : 0;
        dailyReturns.push(adjustedReturn);
      } else {
        // Pure market return (no cash flow)
        dailyReturns.push((currVal - prevVal) / prevVal);
      }
    } else if (currCost > 0 && prevVal === 0) {
      // Initial funding day transition
      const initialDayReturn = (currVal - currCost) / currCost;
      dailyReturns.push(initialDayReturn);
    }
  }

  // Annualized Volatility: standard deviation of cash-flow-adjusted daily returns * sqrt(252)
  let annualizedVolatility = 0;
  if (dailyReturns.length > 2) {
    const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (dailyReturns.length - 1);
    annualizedVolatility = Math.sqrt(Math.max(0, variance)) * Math.sqrt(252) * 100;
  }

  // Max Drawdown: peak to trough decline
  let peak = 0;
  let maxDrawdown = 0;
  historyPoints.forEach(pt => {
    if (pt.portfolioValueEur > peak) {
      peak = pt.portfolioValueEur;
    }
    if (peak > 0) {
      const dd = ((peak - pt.portfolioValueEur) / peak) * 100;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
      }
    }
  });

  // TWR: Time-Weighted Return compounding sub-period returns with cash-flow isolation
  let twr = totalReturnPct;
  if (dailyReturns.length > 0) {
    let twrProduct = 1.0;
    dailyReturns.forEach(r => {
      const cleanR = isNaN(r) ? 0 : Math.max(-0.9999, r);
      twrProduct *= (1 + cleanR);
    });
    const calculatedTwr = (twrProduct - 1) * 100;
    if (!isNaN(calculatedTwr)) {
      twr = calculatedTwr;
    }
  }

  // Best and worst positions
  const ranked = [...positions].sort((a, b) => b.unrealizedProfitPct - a.unrealizedProfitPct);
  const bestPosition = ranked.length > 0 ? {
    symbol: ranked[0].symbol,
    name: ranked[0].name,
    profitPct: ranked[0].unrealizedProfitPct,
  } : null;

  const worstPosition = ranked.length > 0 ? {
    symbol: ranked[ranked.length - 1].symbol,
    name: ranked[ranked.length - 1].name,
    profitPct: ranked[ranked.length - 1].unrealizedProfitPct,
  } : null;

  return {
    xirr,
    twr: isNaN(twr) ? totalReturnPct : twr,
    annualizedVolatility: isNaN(annualizedVolatility) ? 0 : annualizedVolatility,
    maxDrawdown: isNaN(maxDrawdown) ? 0 : maxDrawdown,
    totalInvestedEur: totalInvested,
    currentValueEur: currentValue,
    totalReturnEur,
    totalReturnPct,
    bestPosition,
    worstPosition,
  };
}

/**
 * Reconstructs portfolio value history from real market candle data for held positions.
 * Fetches real historical closing prices using the Finnhub -> TwelveData -> Yahoo cascade.
 * Excludes positions missing data gracefully (records hasMissingData) without fabricating data.
 * Marks purchase events with dots on 'All' view.
 */
export async function reconstructPortfolioHistory(
  positions: Position[],
  period: ChartPeriod = 'All'
): Promise<PortfolioHistoryResult> {
  if (positions.length === 0) {
    return { points: [], hasMissingData: false, missingSymbols: [] };
  }

  const isAll = period === 'All';
  const fxRates = await getForexRates();

  // 1. Fetch real candles for all held positions in parallel
  const candlePromises = positions.map(async (pos) => {
    try {
      const candles = await getHistoricalPrices(pos.symbol, period);
      return { pos, candles };
    } catch (e) {
      console.warn(`Failed fetching candles for ${pos.symbol}:`, e);
      return { pos, candles: [] as { date: string; price: number }[] };
    }
  });

  const positionCandleResults = await Promise.all(candlePromises);

  const missingSymbols: string[] = [];
  positionCandleResults.forEach(({ pos, candles }) => {
    if (candles.length === 0) {
      missingSymbols.push(pos.symbol);
    }
  });
  const hasMissingData = missingSymbols.length > 0;

  // Build a date lookup map per position: positionId -> Map<dateStr, price>
  const posDatePriceMap = new Map<string, Map<string, number>>();
  const allDatesSet = new Set<string>();

  positionCandleResults.forEach(({ pos, candles }) => {
    const map = new Map<string, number>();
    candles.forEach((c) => {
      map.set(c.date, c.price);
      allDatesSet.add(c.date);
    });
    posDatePriceMap.set(pos.id, map);
  });

  // If no historical dates could be fetched from any provider, return empty with hasMissingData
  if (allDatesSet.size === 0) {
    return { points: [], hasMissingData: true, missingSymbols };
  }

  // Sort dates chronologically
  const sortedDates = Array.from(allDatesSet).sort();

  // Group purchase events by date (YYYY-MM-DD) for dot markers on 'All' view
  const purchaseDatesMap = new Map<string, { symbol: string; costEur: number; gainPct: number }[]>();
  positions.forEach((p) => {
    const dStr = p.openTime.split('T')[0];
    if (!purchaseDatesMap.has(dStr)) {
      purchaseDatesMap.set(dStr, []);
    }
    purchaseDatesMap.get(dStr)!.push({
      symbol: p.symbol,
      costEur: p.costBasisEur,
      gainPct: p.unrealizedProfitPct,
    });
  });

  // Keep last known price per position to handle exchange holiday differences (forward-fill)
  const lastKnownPrice = new Map<string, number>();

  const points: PortfolioHistoryPoint[] = [];

  for (const dateStr of sortedDates) {
    let dayCostBasis = 0;
    let dayValue = 0;
    let dateHasActivePositions = false;

    for (const { pos } of positionCandleResults) {
      const openDateStr = pos.openTime.split('T')[0];
      // A position with no open date on or before that day contributes 0
      if (openDateStr > dateStr && period !== '1D') {
        continue;
      }

      dateHasActivePositions = true;
      const priceMap = posDatePriceMap.get(pos.id);
      let price = priceMap?.get(dateStr);

      if (price !== undefined) {
        lastKnownPrice.set(pos.id, price);
      } else if (lastKnownPrice.has(pos.id)) {
        // Exchange holiday or missing intraday point: use last known close
        price = lastKnownPrice.get(pos.id);
      }

      // If we have a valid price for this position on or before this day:
      if (price !== undefined && price > 0) {
        const priceEur = convertToEur(price, pos.currency, fxRates);
        dayValue += pos.quantity * priceEur;
        dayCostBasis += pos.costBasisEur;
      }
    }

    if (!dateHasActivePositions && dayValue === 0 && dayCostBasis === 0) {
      continue;
    }

    const gainPct = dayCostBasis > 0 ? ((dayValue - dayCostBasis) / dayCostBasis) * 100 : 0;
    const purchasesOnDay = purchaseDatesMap.get(dateStr);
    const showPurchaseDot = Boolean(isAll && purchasesOnDay && purchasesOnDay.length > 0);

    let timestamp = new Date(dateStr).getTime();
    if (isNaN(timestamp)) {
      timestamp = Date.now();
    }

    points.push({
      date: dateStr,
      timestamp,
      portfolioValueEur: Math.round(dayValue * 100) / 100,
      costBasisEur: Math.round(dayCostBasis * 100) / 100,
      gainPct: Math.round(gainPct * 10) / 10,
      isPurchase: showPurchaseDot,
      purchaseSymbol: showPurchaseDot ? purchasesOnDay?.[0]?.symbol : undefined,
      purchaseGainPct: showPurchaseDot && purchasesOnDay?.[0]?.gainPct !== undefined 
        ? Math.round(purchasesOnDay[0].gainPct * 10) / 10 
        : undefined,
      purchaseAmountEur: showPurchaseDot ? purchasesOnDay?.[0]?.costEur : undefined,
    });
  }

  return {
    points,
    hasMissingData,
    missingSymbols,
  };
}

/**
 * Generates real benchmark comparison cumulative % series (SPY, VWCE, QQQ)
 * Fetches REAL historical price series using the existing candle cascade.
 * No synthetic annual return or artificial wiggle.
 */
export async function generateBenchmarkComparison(
  historyPoints: PortfolioHistoryPoint[],
  benchmark: BenchmarkKey,
  chartPeriod: ChartPeriod = 'All'
): Promise<{ comparisonPoints: BenchmarkComparisonPoint[]; hasMissingData: boolean }> {
  if (historyPoints.length === 0) {
    return { comparisonPoints: [], hasMissingData: false };
  }

  const ticker = BENCHMARK_TICKER_MAP[benchmark];
  let benchmarkCandles: { date: string; price: number }[] = [];

  try {
    benchmarkCandles = await getHistoricalPrices(ticker, chartPeriod);
    // Fallback for VWCE without suffix if VWCE.DE returned empty
    if (benchmark === 'VWCE' && benchmarkCandles.length === 0) {
      benchmarkCandles = await getHistoricalPrices('VWCE', chartPeriod);
    }
  } catch (err) {
    console.warn(`Failed fetching benchmark candles for ${ticker}:`, err);
  }

  if (benchmarkCandles.length === 0) {
    // If benchmark data genuinely can't be fetched, degrade gracefully:
    // return portfolio series only without synthetic benchmark line, and mark hasMissingData
    const comparisonPoints = historyPoints.map((pt) => {
      const portfolioPct = pt.costBasisEur > 0
        ? ((pt.portfolioValueEur - pt.costBasisEur) / pt.costBasisEur) * 100
        : 0;
      return {
        date: pt.date,
        portfolioPct: Math.round(portfolioPct * 10) / 10,
        benchmarkPct: 0,
      };
    });
    return { comparisonPoints, hasMissingData: true };
  }

  // Benchmark prices date lookup
  const bmPriceMap = new Map<string, number>();
  benchmarkCandles.forEach((c) => bmPriceMap.set(c.date, c.price));

  // Determine baseline benchmark price (the closing price on or closest to historyPoints[0].date)
  const firstDate = historyPoints[0].date;
  let baselinePrice = bmPriceMap.get(firstDate);

  if (baselinePrice === undefined) {
    // Find closest candle on or after firstDate, or fallback to first candle
    const match = benchmarkCandles.find((c) => c.date >= firstDate);
    baselinePrice = match ? match.price : benchmarkCandles[0].price;
  }

  let lastKnownBmPrice = baselinePrice;

  const comparisonPoints: BenchmarkComparisonPoint[] = historyPoints.map((pt) => {
    // Real portfolio cumulative return relative to cost basis
    const portfolioPct = pt.costBasisEur > 0
      ? ((pt.portfolioValueEur - pt.costBasisEur) / pt.costBasisEur) * 100
      : 0;

    const currentBmPrice = bmPriceMap.get(pt.date);
    if (currentBmPrice !== undefined) {
      lastKnownBmPrice = currentBmPrice;
    }

    const effectiveBmPrice = currentBmPrice !== undefined ? currentBmPrice : lastKnownBmPrice;
    const benchmarkPct = baselinePrice && baselinePrice > 0
      ? ((effectiveBmPrice - baselinePrice) / baselinePrice) * 100
      : 0;

    return {
      date: pt.date,
      portfolioPct: Math.round(portfolioPct * 10) / 10,
      benchmarkPct: Math.round(benchmarkPct * 10) / 10,
    };
  });

  return {
    comparisonPoints,
    hasMissingData: false,
  };
}

/** Ticker used to fetch real candle data for each benchmark key */
export const BENCHMARK_TICKER_MAP: Record<BenchmarkKey, string> = {
  SPY: 'SPY',
  VWCE: 'VWCE.DE',
  QQQ: 'QQQ',
  STOXX: 'EXSA.DE',
  BTC: 'BTC-USD',
  GLD: 'GLD',
};

/**
 * Generates a REAL cumulative % comparison between the portfolio and an
 * arbitrary number of benchmarks simultaneously (like getquin's multi-line
 * benchmarking chart). Each point carries `portfolioPct` plus one numeric
 * field per benchmark key (e.g. point.SPY, point.QQQ).
 *
 * Also returns each series' total (last-point) cumulative % change so the
 * UI can render a summary row per benchmark, and flags any benchmark whose
 * real data could not be fetched for the selected period.
 */
export async function generateMultiBenchmarkComparison(
  historyPoints: PortfolioHistoryPoint[],
  benchmarks: BenchmarkKey[],
  chartPeriod: ChartPeriod = 'All'
): Promise<{
  comparisonPoints: MultiBenchmarkPoint[];
  totalReturns: Partial<Record<BenchmarkKey, number>>;
  portfolioTotalReturnPct: number;
  missingBenchmarks: BenchmarkKey[];
}> {
  if (historyPoints.length === 0 || benchmarks.length === 0) {
    return { comparisonPoints: [], totalReturns: {}, portfolioTotalReturnPct: 0, missingBenchmarks: [] };
  }

  const firstDate = historyPoints[0].date;
  const missingBenchmarks: BenchmarkKey[] = [];

  // Fetch real candle series for every requested benchmark in parallel
  const seriesResults = await Promise.all(
    benchmarks.map(async (key) => {
      const ticker = BENCHMARK_TICKER_MAP[key];
      let candles: { date: string; price: number }[] = [];
      try {
        candles = await getHistoricalPrices(ticker, chartPeriod);
        if (key === 'VWCE' && candles.length === 0) {
          candles = await getHistoricalPrices('VWCE', chartPeriod);
        }
      } catch (err) {
        console.warn(`Failed fetching benchmark candles for ${ticker}:`, err);
      }

      if (candles.length === 0) {
        missingBenchmarks.push(key);
        return { key, priceMap: new Map<string, number>(), baselinePrice: undefined as number | undefined };
      }

      const priceMap = new Map<string, number>();
      candles.forEach((c) => priceMap.set(c.date, c.price));

      let baselinePrice = priceMap.get(firstDate);
      if (baselinePrice === undefined) {
        const match = candles.find((c) => c.date >= firstDate);
        baselinePrice = match ? match.price : candles[0].price;
      }

      return { key, priceMap, baselinePrice };
    })
  );

  // Track last-known price per benchmark to forward-fill exchange holidays
  const lastKnownPrice = new Map<BenchmarkKey, number | undefined>();
  seriesResults.forEach((s) => lastKnownPrice.set(s.key, s.baselinePrice));

  const comparisonPoints: MultiBenchmarkPoint[] = historyPoints.map((pt) => {
    const portfolioPct = pt.costBasisEur > 0
      ? ((pt.portfolioValueEur - pt.costBasisEur) / pt.costBasisEur) * 100
      : 0;

    const point: MultiBenchmarkPoint = {
      date: pt.date,
      portfolioPct: Math.round(portfolioPct * 10) / 10,
    };

    seriesResults.forEach(({ key, priceMap, baselinePrice }) => {
      if (baselinePrice === undefined) return;
      const currentPrice = priceMap.get(pt.date);
      if (currentPrice !== undefined) {
        lastKnownPrice.set(key, currentPrice);
      }
      const effectivePrice = currentPrice !== undefined ? currentPrice : lastKnownPrice.get(key);
      const pct = effectivePrice !== undefined && baselinePrice > 0
        ? ((effectivePrice - baselinePrice) / baselinePrice) * 100
        : 0;
      point[key] = Math.round(pct * 10) / 10;
    });

    return point;
  });

  const totalReturns: Partial<Record<BenchmarkKey, number>> = {};
  const lastPoint = comparisonPoints[comparisonPoints.length - 1];
  benchmarks.forEach((key) => {
    if (typeof lastPoint[key] === 'number') {
      totalReturns[key] = lastPoint[key] as number;
    }
  });

  const portfolioTotalReturnPct = lastPoint ? lastPoint.portfolioPct : 0;

  return { comparisonPoints, totalReturns, portfolioTotalReturnPct, missingBenchmarks };
}

export interface PositionLeader {
  symbol: string;
  name: string;
  pct: number;
}

/**
 * Finds which held position is performing best "since the market opened today"
 * (real previous-close vs current price, no candle fetch needed), and which
 * position gained the most over the last real week and last real month
 * (fetched from the Finnhub -> TwelveData -> Yahoo candle cascade, one
 * request per position per period, run in parallel).
 * Positions missing the required data point are skipped gracefully.
 */
export async function getPeriodLeaders(
  positions: Position[]
): Promise<{ bestToday: PositionLeader | null; bestWeek: PositionLeader | null; bestMonth: PositionLeader | null }> {
  if (positions.length === 0) {
    return { bestToday: null, bestWeek: null, bestMonth: null };
  }

  // "Since the market opened" = today's live price vs real previous close, already on the position
  let bestToday: PositionLeader | null = null;
  positions.forEach((p) => {
    if (p.previousCloseEur && p.previousCloseEur > 0 && p.currentPriceEur > 0) {
      const pct = ((p.currentPriceEur - p.previousCloseEur) / p.previousCloseEur) * 100;
      if (!bestToday || pct > bestToday.pct) {
        bestToday = { symbol: p.displaySymbol || p.symbol, name: p.name, pct };
      }
    }
  });

  // Last real week / last real month = first vs last real closing candle in each range
  const computeBestForPeriod = async (period: ChartPeriod): Promise<PositionLeader | null> => {
    const results = await Promise.all(
      positions.map(async (p) => {
        try {
          const candles = await getHistoricalPrices(p.symbol, period);
          if (candles.length < 2) return null;
          const first = candles[0].price;
          const last = candles[candles.length - 1].price;
          if (!first || first <= 0) return null;
          const pct = ((last - first) / first) * 100;
          return { symbol: p.displaySymbol || p.symbol, name: p.name, pct } as PositionLeader;
        } catch {
          return null;
        }
      })
    );

    let best: PositionLeader | null = null;
    results.forEach((r) => {
      if (r && (!best || r.pct > best.pct)) {
        best = r;
      }
    });
    return best;
  };

  const [bestWeek, bestMonth] = await Promise.all([
    computeBestForPeriod('1W'),
    computeBestForPeriod('1M'),
  ]);

  return { bestToday, bestWeek, bestMonth };
}
