import React, { useState, useEffect, useMemo } from 'react';
import { 
  Position, 
  PortfolioHistoryPoint, 
  PerformanceMetrics,
  ChartPeriod,
  BenchmarkKey,
  MultiBenchmarkPoint
} from '../types';
import { 
  reconstructPortfolioHistory, 
  generateMultiBenchmarkComparison,
  calculatePerformanceMetrics,
  getPeriodLeaders,
  type PositionLeader
} from '../lib/calculations';
import { 
  ArrowUpRight, 
  ArrowDownRight, 
  UploadCloud, 
  Calendar,
  Sparkles,
  Info,
  HelpCircle,
  Activity,
  TrendingDown,
  TrendingUp,
  BarChart2,
  Loader2,
  AlertCircle,
  Plus,
  X
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine
} from 'recharts';

interface DashboardViewProps {
  positions: Position[];
  metrics: PerformanceMetrics;
  onOpenImport: () => void;
  onLoadSampleData: () => void;
  lastRefreshTime?: string;
}

const PERIODS: ChartPeriod[] = ['1D', '3D', '1W', '2W', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'All'];

const BENCHMARK_COLORS = ['#9CA3AF', '#F59E0B', '#8B5CF6', '#10B981', '#EC4899', '#0EA5E9'];

const BENCHMARK_INFO: Record<BenchmarkKey, { name: string; desc: string }> = {
  SPY: { name: 'S&P 500 (SPY)', desc: 'US Large-Cap Equity Index' },
  VWCE: { name: 'FTSE All-World (VWCE)', desc: 'Global Developed & Emerging Markets ETF' },
  QQQ: { name: 'NASDAQ 100 (QQQ)', desc: 'Tech & Growth Large-Cap Index' },
  STOXX: { name: 'STOXX Europe 600', desc: 'European Developed Markets ETF (EXSA)' },
  BTC: { name: 'Bitcoin (BTC)', desc: 'Leading Cryptocurrency Reference' },
  GLD: { name: 'Gold (GLD)', desc: 'Gold Spot Trust ETF' },
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  positions,
  metrics: initialMetrics,
  onOpenImport,
  onLoadSampleData,
  lastRefreshTime,
}) => {
  const [activeRange, setActiveRange] = useState<ChartPeriod>('All');
  const [hoveredPoint, setHoveredPoint] = useState<PortfolioHistoryPoint | null>(null);

  // History state: fetched from real market candles and stored in state
  const [historyPoints, setHistoryPoints] = useState<PortfolioHistoryPoint[]>([]);
  const [hasHistoryMissingData, setHasHistoryMissingData] = useState(false);
  const [missingHistorySymbols, setMissingHistorySymbols] = useState<string[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Benchmark comparison state: multiple benchmarks can be compared at once (fetched from real market candles)
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<BenchmarkKey[]>(['SPY']);
  const [isBenchmarkPickerOpen, setIsBenchmarkPickerOpen] = useState(false);
  const [multiBenchmarkPoints, setMultiBenchmarkPoints] = useState<MultiBenchmarkPoint[]>([]);
  const [benchmarkTotalReturns, setBenchmarkTotalReturns] = useState<Partial<Record<BenchmarkKey, number>>>({});
  const [portfolioTotalReturnPct, setPortfolioTotalReturnPct] = useState(0);
  const [missingBenchmarks, setMissingBenchmarks] = useState<BenchmarkKey[]>([]);
  const [isLoadingBenchmark, setIsLoadingBenchmark] = useState(false);

  // Period leaders: which held position is up the most today / this week / this month
  const [bestTodayLeader, setBestTodayLeader] = useState<PositionLeader | null>(null);
  const [bestWeekLeader, setBestWeekLeader] = useState<PositionLeader | null>(null);
  const [bestMonthLeader, setBestMonthLeader] = useState<PositionLeader | null>(null);
  const [isLoadingLeaders, setIsLoadingLeaders] = useState(false);

  const formatEur = (val: number) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  };

  const formatPct = (val: number) => {
    const prefix = val > 0 ? '+' : '';
    return `${prefix}${val.toFixed(2)}%`;
  };

  // 1. Fetch real historical closing prices for portfolio history
  useEffect(() => {
    let isCancelled = false;

    if (positions.length === 0) {
      setHistoryPoints([]);
      setHasHistoryMissingData(false);
      setMissingHistorySymbols([]);
      setIsLoadingHistory(false);
      return;
    }

    setIsLoadingHistory(true);

    reconstructPortfolioHistory(positions, activeRange)
      .then((res) => {
        if (isCancelled) return;
        setHistoryPoints(res.points);
        setHasHistoryMissingData(res.hasMissingData);
        setMissingHistorySymbols(res.missingSymbols);
      })
      .catch((err) => {
        if (isCancelled) return;
        console.warn('Failed reconstructing portfolio history:', err);
        setHistoryPoints([]);
        setHasHistoryMissingData(true);
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingHistory(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [positions, activeRange, lastRefreshTime]);

  // 2. Fetch real historical series for all active benchmarks against portfolio history
  useEffect(() => {
    let isCancelled = false;

    if (historyPoints.length === 0 || selectedBenchmarks.length === 0) {
      setMultiBenchmarkPoints([]);
      setBenchmarkTotalReturns({});
      setPortfolioTotalReturnPct(0);
      setMissingBenchmarks([]);
      setIsLoadingBenchmark(false);
      return;
    }

    setIsLoadingBenchmark(true);

    generateMultiBenchmarkComparison(historyPoints, selectedBenchmarks, activeRange)
      .then((res) => {
        if (isCancelled) return;
        setMultiBenchmarkPoints(res.comparisonPoints);
        setBenchmarkTotalReturns(res.totalReturns);
        setPortfolioTotalReturnPct(res.portfolioTotalReturnPct);
        setMissingBenchmarks(res.missingBenchmarks);
      })
      .catch((err) => {
        if (isCancelled) return;
        console.warn('Failed generating benchmark comparison:', err);
        setMultiBenchmarkPoints([]);
        setBenchmarkTotalReturns({});
        setMissingBenchmarks(selectedBenchmarks);
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingBenchmark(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [historyPoints, selectedBenchmarks, activeRange]);

  // 3. Find which position leads today / this week / this month (real prices, no synthetic data)
  useEffect(() => {
    let isCancelled = false;

    if (positions.length === 0) {
      setBestTodayLeader(null);
      setBestWeekLeader(null);
      setBestMonthLeader(null);
      setIsLoadingLeaders(false);
      return;
    }

    setIsLoadingLeaders(true);

    getPeriodLeaders(positions)
      .then((res) => {
        if (isCancelled) return;
        setBestTodayLeader(res.bestToday);
        setBestWeekLeader(res.bestWeek);
        setBestMonthLeader(res.bestMonth);
      })
      .catch((err) => {
        if (isCancelled) return;
        console.warn('Failed computing period leaders:', err);
        setBestTodayLeader(null);
        setBestWeekLeader(null);
        setBestMonthLeader(null);
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingLeaders(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [positions, lastRefreshTime]);

  const addBenchmark = (key: BenchmarkKey) => {
    setSelectedBenchmarks((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setIsBenchmarkPickerOpen(false);
  };

  const removeBenchmark = (key: BenchmarkKey) => {
    setSelectedBenchmarks((prev) => prev.filter((k) => k !== key));
  };

  const availableBenchmarksToAdd = (Object.keys(BENCHMARK_INFO) as BenchmarkKey[]).filter(
    (k) => !selectedBenchmarks.includes(k)
  );

  // Derived Performance Metrics incorporating real history points for volatility & max drawdown
  const dynamicMetrics = useMemo(() => {
    return calculatePerformanceMetrics(positions, historyPoints);
  }, [positions, historyPoints]);

  const metrics = dynamicMetrics.totalInvestedEur > 0 ? dynamicMetrics : initialMetrics;

  // Today's Gain/Loss Calculation using Finnhub's pc (previous-close) field vs currentPrice
  const todayStats = useMemo(() => {
    let eligibleCount = 0;
    let excludedCount = 0;
    let totalTodayChangeEur = 0;
    let totalPrevValueEur = 0;

    positions.forEach((p) => {
      if (p.previousCloseEur && p.previousCloseEur > 0 && p.currentPriceEur > 0) {
        const changeEur = (p.currentPriceEur - p.previousCloseEur) * p.quantity;
        const prevValEur = p.previousCloseEur * p.quantity;
        totalTodayChangeEur += changeEur;
        totalPrevValueEur += prevValEur;
        eligibleCount++;
      } else {
        excludedCount++;
      }
    });

    const todayChangePct = totalPrevValueEur > 0 ? (totalTodayChangeEur / totalPrevValueEur) * 100 : 0;
    const isPartial = excludedCount > 0 && eligibleCount > 0;
    const hasData = eligibleCount > 0;

    return {
      todayChangeEur: totalTodayChangeEur,
      todayChangePct,
      isPartial,
      eligibleCount,
      excludedCount,
      totalPositions: positions.length,
      hasData,
    };
  }, [positions]);

  // Top 5 Positions by current market value
  const top5Positions = useMemo(() => {
    return [...positions]
      .sort((a, b) => b.marketValueEur - a.marketValueEur)
      .slice(0, 5);
  }, [positions]);

  const top5TotalWeight = useMemo(() => {
    if (metrics.currentValueEur <= 0) return 0;
    const top5Val = top5Positions.reduce((sum, p) => sum + p.marketValueEur, 0);
    return (top5Val / metrics.currentValueEur) * 100;
  }, [top5Positions, metrics.currentValueEur]);

  const isTotalGain = metrics.totalReturnEur >= 0;
  const isTodayGain = todayStats.todayChangeEur >= 0;

  // Chart trend color for the currently visible range (green if it ends up vs. where it started, red otherwise) — Yahoo Finance style
  const isRangePositive = historyPoints.length > 1
    ? historyPoints[historyPoints.length - 1].portfolioValueEur >= historyPoints[0].portfolioValueEur
    : true;
  const chartTrendColor = isRangePositive ? '#10B981' : '#EF4444';

  return (
    <div className="space-y-8 pb-24">
      
      {/* 1. Top Header: Title, Total Value, Today's Change, and Unrealized P&L */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pt-1">
        <div>
          <h1 className="text-3xl font-light text-[#111827] mb-1 tracking-tight">Dashboard</h1>
          <p className="text-sm text-[#6B7280] flex items-center gap-1.5">
            <span>Market tracking</span>
            <span>•</span>
            <span className="text-[#2563EB] font-medium">Finnhub, Yahoo &amp; TwelveData Connected</span>
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-6 sm:gap-8">
          {/* Total Value */}
          <div className="text-left sm:text-right">
            <p className="text-xs uppercase tracking-wider text-[#6B7280] mb-1 font-semibold">Total Value</p>
            <p className="text-3xl sm:text-4xl font-light tracking-tighter text-[#111827] font-mono">
              {formatEur(metrics.currentValueEur)}
            </p>
          </div>

          {/* Today's Change Stat */}
          <div className="text-left sm:text-right">
            <div className="flex items-center sm:justify-end gap-1 mb-1">
              <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">Today's Gain/Loss</p>
              {todayStats.isPartial && (
                <span 
                  className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1 py-0.2 rounded-sm font-medium"
                  title={`Partial: calculated for ${todayStats.eligibleCount} of ${todayStats.totalPositions} positions with previous-close data`}
                >
                  Partial
                </span>
              )}
            </div>
            <p className={`text-2xl font-medium font-mono ${isTodayGain ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
              {formatEur(todayStats.todayChangeEur)} <span className="text-sm font-normal">({formatPct(todayStats.todayChangePct)})</span>
            </p>
          </div>

          {/* Total Unrealized P&L */}
          <div className="text-left sm:text-right">
            <p className="text-xs uppercase tracking-wider text-[#6B7280] mb-1 font-semibold">Total P&amp;L</p>
            <p className={`text-2xl font-medium font-mono ${isTotalGain ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
              {formatEur(metrics.totalReturnEur)} <span className="text-sm font-normal">({formatPct(metrics.totalReturnPct)})</span>
            </p>
          </div>
        </div>
      </header>

      {/* 2. Summary Cards Grid (4 columns) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Invested */}
        <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm">
          <p className="text-xs text-[#6B7280] uppercase tracking-wide mb-2 font-semibold">Total Invested</p>
          <p className="text-xl font-medium text-[#111827] font-mono">{formatEur(metrics.totalInvestedEur)}</p>
          <p className="text-[11px] text-[#9CA3AF] mt-1">Cost basis (open price × qty)</p>
        </div>

        {/* Today's Return Card */}
        <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-[#6B7280] uppercase tracking-wide font-semibold">Today's Return</p>
            {todayStats.isPartial && (
              <span className="text-[10px] text-amber-600 bg-amber-50 px-1 py-0.2 rounded-sm font-mono">
                {todayStats.eligibleCount}/{todayStats.totalPositions}
              </span>
            )}
          </div>
          <p className={`text-xl font-medium font-mono ${isTodayGain ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
            {formatEur(todayStats.todayChangeEur)}
          </p>
          <p className="text-[11px] text-[#9CA3AF] mt-1">
            {isTodayGain ? '+' : ''}{todayStats.todayChangePct.toFixed(2)}% vs previous close
          </p>
        </div>

        {/* Best Performer */}
        <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm">
          <p className="text-xs text-[#6B7280] uppercase tracking-wide mb-2 font-semibold">Best Performer</p>
          {metrics.bestPosition ? (
            <div>
              <p className="text-xl font-medium text-[#10B981] font-mono truncate">
                {metrics.bestPosition.symbol} <span className="text-sm font-normal">+{metrics.bestPosition.profitPct.toFixed(1)}%</span>
              </p>
              <p className="text-[11px] text-[#9CA3AF] truncate mt-1">{metrics.bestPosition.name}</p>
            </div>
          ) : (
            <p className="text-xl font-medium text-[#9CA3AF]">—</p>
          )}
        </div>

        {/* Max Drawdown */}
        <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm">
          <p className="text-xs text-[#6B7280] uppercase tracking-wide mb-2 font-semibold">Max Drawdown</p>
          <p className="text-xl font-medium text-[#EF4444] font-mono">
            {metrics.maxDrawdown > 0 ? `-${metrics.maxDrawdown.toFixed(1)}%` : '0.0%'}
          </p>
          <p className="text-[11px] text-[#9CA3AF] mt-1">Peak-to-trough decline</p>
        </div>
      </section>

      {/* 2b. Period Leaders: which held position is up the most today / this week / this month */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Best Today (since market open) */}
        <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm">
          <p className="text-xs text-[#6B7280] uppercase tracking-wide mb-2 font-semibold">Best Today</p>
          {isLoadingLeaders ? (
            <p className="text-xl font-medium text-[#9CA3AF] font-mono">…</p>
          ) : bestTodayLeader ? (
            <div>
              <p className="text-xl font-medium text-[#10B981] font-mono truncate">
                {bestTodayLeader.symbol} <span className="text-sm font-normal">{formatPct(bestTodayLeader.pct)}</span>
              </p>
              <p className="text-[11px] text-[#9CA3AF] truncate mt-1">{bestTodayLeader.name}</p>
            </div>
          ) : (
            <p className="text-xl font-medium text-[#9CA3AF]">—</p>
          )}
          <p className="text-[11px] text-[#9CA3AF] mt-1">Vs. real previous close</p>
        </div>

        {/* Best This Week */}
        <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm">
          <p className="text-xs text-[#6B7280] uppercase tracking-wide mb-2 font-semibold">Best This Week</p>
          {isLoadingLeaders ? (
            <p className="text-xl font-medium text-[#9CA3AF] font-mono">…</p>
          ) : bestWeekLeader ? (
            <div>
              <p className="text-xl font-medium text-[#10B981] font-mono truncate">
                {bestWeekLeader.symbol} <span className="text-sm font-normal">{formatPct(bestWeekLeader.pct)}</span>
              </p>
              <p className="text-[11px] text-[#9CA3AF] truncate mt-1">{bestWeekLeader.name}</p>
            </div>
          ) : (
            <p className="text-xl font-medium text-[#9CA3AF]">—</p>
          )}
          <p className="text-[11px] text-[#9CA3AF] mt-1">Real close, last 7 days</p>
        </div>

        {/* Best This Month */}
        <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm">
          <p className="text-xs text-[#6B7280] uppercase tracking-wide mb-2 font-semibold">Best This Month</p>
          {isLoadingLeaders ? (
            <p className="text-xl font-medium text-[#9CA3AF] font-mono">…</p>
          ) : bestMonthLeader ? (
            <div>
              <p className="text-xl font-medium text-[#10B981] font-mono truncate">
                {bestMonthLeader.symbol} <span className="text-sm font-normal">{formatPct(bestMonthLeader.pct)}</span>
              </p>
              <p className="text-[11px] text-[#9CA3AF] truncate mt-1">{bestMonthLeader.name}</p>
            </div>
          ) : (
            <p className="text-xl font-medium text-[#9CA3AF]">—</p>
          )}
          <p className="text-[11px] text-[#9CA3AF] mt-1">Real close, last 30 days</p>
        </div>
      </section>

      {/* 3. Main Portfolio Value History Chart */}
      <section className="bg-white border border-[#E5E7EB] p-6 rounded-sm flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-[#6B7280]">
              Portfolio Performance History
            </h3>
            <button type="button" className="group relative cursor-pointer touch-manipulation focus:outline-none">
              <Info className="w-3.5 h-3.5 text-[#6B7280]" />
              <div className="hidden group-hover:block group-focus:block absolute left-0 bottom-full mb-1.5 w-64 p-2 bg-[#111827] text-white text-[11px] rounded-sm shadow-lg z-20 text-left">
                Dots along the curve represent your XTB buy dates (shown on the "All" view) with the percentage gain or loss at each milestone.
              </div>
            </button>
            {hasHistoryMissingData && (
              <span 
                className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-sm font-medium flex items-center gap-1"
                title={missingHistorySymbols.length > 0 ? `Missing candle data for: ${missingHistorySymbols.join(', ')}` : 'Some positions lack historical data'}
              >
                <AlertCircle className="w-3 h-3 text-amber-600" />
                <span>Partial history: some positions missing data</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3 text-xs font-medium">
              <span style={{ color: chartTrendColor }}>● Portfolio</span>
              <span className="text-[#9CA3AF]">● Cost Basis</span>
            </div>

            {/* Time range selector: 1D, 1W, 2W, 1M, 3M, YTD, 1Y, All */}
            {positions.length > 0 && (
              <div className="flex items-center border border-[#E5E7EB] rounded-sm p-0.5 bg-[#F9FAFB] overflow-x-auto">
                {PERIODS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setActiveRange(r)}
                    disabled={isLoadingHistory}
                    className={`px-2 py-0.5 text-xs font-medium rounded-sm cursor-pointer whitespace-nowrap transition-colors ${
                      activeRange === r
                        ? 'bg-white text-[#2563EB] shadow-xs font-semibold'
                        : 'text-[#6B7280] hover:text-[#111827]'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Chart Canvas */}
        {isLoadingHistory ? (
          <div className="h-72 sm:h-80 flex flex-col items-center justify-center text-center p-6 bg-[#F9FAFB] rounded-sm border border-[#E5E7EB]">
            <Loader2 className="w-6 h-6 text-[#2563EB] animate-spin mb-2" />
            <p className="text-xs text-[#6B7280]">Reconstructing portfolio history from real market candles...</p>
          </div>
        ) : historyPoints.length > 0 ? (
          <div className="w-full h-72 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={historyPoints}
                margin={{ top: 16, right: 12, left: 0, bottom: 0 }}
                onMouseMove={(e: any) => {
                  if (e && e.activePayload && e.activePayload[0]) {
                    setHoveredPoint(e.activePayload[0].payload);
                  }
                }}
                onMouseLeave={() => setHoveredPoint(null)}
              >
                <defs>
                  <linearGradient id="portfolioAreaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartTrendColor} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={chartTrendColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  stroke="#9CA3AF"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                  tickFormatter={(val) => {
                    if (activeRange === '1D') return val;
                    const parts = val.split('-');
                    return parts.length === 3 ? `${parts[2]}.${parts[1]}` : val;
                  }}
                />
                <YAxis hide domain={['auto', 'auto']} />
                {/* Dashed baseline at the range's starting value, like the Yahoo Finance / getquin reference line */}
                <ReferenceLine
                  y={historyPoints[0].portfolioValueEur}
                  stroke="#D1D5DB"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload as PortfolioHistoryPoint;
                      return (
                        <div className="bg-[#111827] text-white p-3 rounded-sm shadow-xl text-xs space-y-1">
                          <div className="text-[#9CA3AF] font-mono">{data.date}</div>
                          <div className="font-semibold text-sm font-mono text-white">
                            {formatEur(data.portfolioValueEur)}
                          </div>
                          <div className="text-[#9CA3AF]">
                            Cost Basis: {formatEur(data.costBasisEur)}
                          </div>
                          <div className={data.gainPct >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}>
                            Unrealized Gain: {formatPct(data.gainPct)}
                          </div>
                          {data.isPurchase && activeRange === 'All' && (
                            <div className="pt-1.5 mt-1 border-t border-gray-700 text-blue-300 flex items-center gap-1 font-medium">
                              <span>● Buy: {data.purchaseSymbol}</span>
                              {data.purchaseGainPct !== undefined && (
                                <span className="text-[#9CA3AF] text-[10px]">
                                  ({formatPct(data.purchaseGainPct)} gain)
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  }}
                />

                {/* Cost basis dotted guideline */}
                <Line
                  type="monotone"
                  dataKey="costBasisEur"
                  stroke="#E5E7EB"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />

                {/* Portfolio value as a filled gradient area, colored by trend (green/red), with a dot on the last point */}
                <Area
                  type="monotone"
                  dataKey="portfolioValueEur"
                  stroke={chartTrendColor}
                  strokeWidth={2}
                  fill="url(#portfolioAreaFill)"
                  isAnimationActive={false}
                  dot={(props: any) => {
                    const { cx, cy, payload, index } = props;
                    const isLastPoint = index === historyPoints.length - 1;

                    // Keep purchase-date dots visible ONLY on the "All" view as requested
                    if (activeRange === 'All' && payload && payload.isPurchase) {
                      return (
                        <g key={`dot-${payload.date}`}>
                          <circle
                            cx={cx}
                            cy={cy}
                            r={3.5}
                            fill="#ffffff"
                            stroke={chartTrendColor}
                            strokeWidth={2}
                          />
                          {payload.purchaseGainPct !== undefined && (
                            <text
                              x={cx}
                              y={cy - 9}
                              textAnchor="middle"
                              fontSize={9}
                              fill="#6B7280"
                              fontWeight="600"
                            >
                              {formatPct(payload.purchaseGainPct)}
                            </text>
                          )}
                        </g>
                      );
                    }

                    // Solid filled dot marking the most recent value, like the Yahoo Finance / getquin charts
                    if (isLastPoint) {
                      return (
                        <circle
                          key="dot-last"
                          cx={cx}
                          cy={cy}
                          r={4.5}
                          fill={chartTrendColor}
                          stroke="#ffffff"
                          strokeWidth={2}
                        />
                      );
                    }
                    return <></>;
                  }}
                  activeDot={{ r: 4.5, fill: chartTrendColor, stroke: '#ffffff', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-[#F9FAFB] rounded-sm border border-dashed border-[#E5E7EB]">
            <p className="text-sm text-[#6B7280] font-medium">
              No historical market data points available
            </p>
            <p className="text-xs text-[#9CA3AF] mt-1 max-w-sm">
              Import an XTB Open Positions report to see your portfolio reconstructed over time.
            </p>
          </div>
        )}
      </section>

      {/* 4. TOP 5 POSITIONS CARD */}
      {positions.length > 0 && (
        <section className="bg-white border border-[#E5E7EB] p-6 rounded-sm shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5 pb-3 border-b border-[#E5E7EB]">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-widest text-[#6B7280]">
                Top 5 Positions
              </h3>
              <p className="text-xs text-[#9CA3AF] mt-0.5">
                Largest holdings by current market value ({top5TotalWeight.toFixed(1)}% of total portfolio)
              </p>
            </div>
            <div className="text-xs font-mono font-medium text-[#2563EB] bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-sm self-start sm:self-auto">
              Top 5 Value: {formatEur(top5Positions.reduce((s, p) => s + p.marketValueEur, 0))}
            </div>
          </div>

          <div className="space-y-4">
            {top5Positions.map((pos, idx) => {
              const weightPct = metrics.currentValueEur > 0 ? (pos.marketValueEur / metrics.currentValueEur) * 100 : 0;
              const isGain = pos.unrealizedProfitEur >= 0;

              return (
                <div key={pos.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2.5 min-w-0 pr-3">
                      <span className="text-[#9CA3AF] font-mono text-xs w-4 shrink-0">{idx + 1}.</span>
                      <span className="font-semibold text-[#111827] font-mono">{pos.symbol}</span>
                      <span className="text-[#6B7280] truncate max-w-[200px] sm:max-w-md hidden sm:inline">
                        {pos.name}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded-sm bg-gray-100 text-gray-600 uppercase font-mono shrink-0">
                        {pos.assetClass}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 font-mono">
                      <span className="text-[#111827] font-medium">{formatEur(pos.marketValueEur)}</span>
                      <span className={`text-[11px] hidden md:inline ${isGain ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                        {formatPct(pos.unrealizedProfitPct)}
                      </span>
                      <span className="text-[#2563EB] font-semibold w-12 text-right">
                        {weightPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Thin horizontal bar for visual weight */}
                  <div className="w-full bg-[#F3F4F6] h-1.5 rounded-sm overflow-hidden">
                    <div 
                      className="bg-[#2563EB] h-full rounded-sm"
                      style={{ width: `${Math.min(100, Math.max(2, weightPct))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 5. Top Holdings and Quick Allocation Grid */}
      {positions.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Top Holdings */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-[#6B7280] mb-4">
              Top Holdings
            </h3>
            <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead className="border-b border-[#E5E7EB] bg-[#F9FAFB]/50">
                  <tr className="text-left">
                    <th className="p-3 font-semibold text-[#6B7280] text-xs uppercase tracking-wider">Symbol</th>
                    <th className="p-3 font-semibold text-[#6B7280] text-xs uppercase tracking-wider">Price</th>
                    <th className="p-3 font-semibold text-[#6B7280] text-xs uppercase tracking-wider">Value</th>
                    <th className="p-3 font-semibold text-[#6B7280] text-xs uppercase tracking-wider text-right">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {positions
                    .slice()
                    .sort((a, b) => b.marketValueEur - a.marketValueEur)
                    .slice(0, 5)
                    .map((pos) => {
                      const isGain = pos.unrealizedProfitEur >= 0;
                      return (
                        <tr key={pos.id} className="border-b border-[#F3F4F6] hover:bg-gray-50/70 transition-colors">
                          <td className="p-3 font-medium text-[#111827]">
                            {pos.symbol}
                            <span className="text-[10px] bg-gray-100 text-gray-700 px-1 py-0.5 rounded-sm ml-1 font-mono uppercase">
                              {pos.priceSource === 'finnhub' ? 'FH' : pos.priceSource === 'yahoo' ? 'YF' : '12D'}
                            </span>
                          </td>
                          <td className="p-3 font-mono text-[#111827]">{formatEur(pos.currentPriceEur)}</td>
                          <td className="p-3 font-mono text-[#111827]">{formatEur(pos.marketValueEur)}</td>
                          <td className={`p-3 font-mono text-right font-medium ${isGain ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                            {formatPct(pos.unrealizedProfitPct)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Allocation Breakdown Overview */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-[#6B7280] mb-4">
              Allocation Breakdown
            </h3>
            <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm flex items-center gap-6">
              {/* Geometric Balance concentric ring icon / badge */}
              <div className="w-24 h-24 rounded-full border-[10px] border-l-[#2563EB] border-t-[#3B82F6] border-r-[#60A5FA] border-b-[#93C5FD] shrink-0" />
              <div className="space-y-2 flex-1">
                {(() => {
                  const map = new Map<string, number>();
                  positions.forEach((p) => {
                    const sec = p.sector || (p.assetClass === 'etf' ? 'Index / Fund' : 'Other');
                    map.set(sec, (map.get(sec) || 0) + p.marketValueEur);
                  });
                  const sorted = Array.from(map.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 4);
                  const total = metrics.currentValueEur > 0 ? metrics.currentValueEur : 1;

                  return sorted.map(([name, val], idx) => {
                    const pct = (val / total) * 100;
                    const colors = ['#2563EB', '#3B82F6', '#60A5FA', '#93C5FD'];
                    return (
                      <div key={name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: colors[idx % colors.length] }} />
                          <span className="text-[#111827] truncate max-w-[140px]">{name}</span>
                        </div>
                        <span className="font-semibold font-mono text-[#111827]">{pct.toFixed(1)}%</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* 6. PERFORMANCE & BENCHMARK ANALYTICS SECTION (Folded into Dashboard) */}
      {positions.length > 0 && (
        <section className="space-y-6 pt-4 border-t border-[#E5E7EB]">
          <div>
            <h2 className="text-xl font-light text-[#111827] mb-1 tracking-tight">
              Performance Analytics &amp; Benchmark Comparison
            </h2>
            <p className="text-xs text-[#6B7280]">
              Mathematical return metrics and real market index comparison without synthetic wiggles
            </p>
          </div>

          {/* Metrics Suite Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* XIRR */}
            <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">
                  XIRR
                </span>
                <button type="button" className="group relative cursor-pointer touch-manipulation focus:outline-none">
                  <HelpCircle className="w-3.5 h-3.5 text-[#9CA3AF]" />
                  <div className="hidden group-hover:block group-focus:block absolute right-0 bottom-full mb-1.5 w-60 p-2 bg-[#111827] text-white text-[11px] rounded-sm shadow-lg z-20 text-left">
                    Extended Internal Rate of Return: annualized money-weighted return accounting for the exact timing of each purchase cashflow.
                  </div>
                </button>
              </div>
              <div className={`text-xl font-medium mt-2 font-mono ${metrics.xirr >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                {formatPct(metrics.xirr)}
              </div>
              <div className="text-[11px] text-[#9CA3AF] mt-1">
                Annualized money-weighted
              </div>
            </div>

            {/* TWR */}
            <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">
                  TWR
                </span>
                <button type="button" className="group relative cursor-pointer touch-manipulation focus:outline-none">
                  <HelpCircle className="w-3.5 h-3.5 text-[#9CA3AF]" />
                  <div className="hidden group-hover:block group-focus:block absolute right-0 bottom-full mb-1.5 w-60 p-2 bg-[#111827] text-white text-[11px] rounded-sm shadow-lg z-20 text-left">
                    Time-Weighted Return: compounds daily sub-period returns independently of capital additions.
                  </div>
                </button>
              </div>
              <div className={`text-xl font-medium mt-2 font-mono ${metrics.twr >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                {formatPct(metrics.twr)}
              </div>
              <div className="text-[11px] text-[#9CA3AF] mt-1">
                Compound growth rate
              </div>
            </div>

            {/* Annualized Volatility */}
            <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">
                  Volatility
                </span>
                <button type="button" className="group relative cursor-pointer touch-manipulation focus:outline-none">
                  <HelpCircle className="w-3.5 h-3.5 text-[#9CA3AF]" />
                  <div className="hidden group-hover:block group-focus:block absolute right-0 bottom-full mb-1.5 w-60 p-2 bg-[#111827] text-white text-[11px] rounded-sm shadow-lg z-20 text-left">
                    Annualized standard deviation of daily portfolio returns (σ × √252) computed from real closing prices.
                  </div>
                </button>
              </div>
              <div className="text-xl font-medium text-[#111827] mt-2 font-mono">
                {metrics.annualizedVolatility > 0 ? `${metrics.annualizedVolatility.toFixed(2)}%` : '—'}
              </div>
              <div className="text-[11px] text-[#9CA3AF] mt-1">
                Standard deviation (annualized)
              </div>
            </div>

            {/* Max Drawdown */}
            <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">
                  Max Drawdown
                </span>
                <button type="button" className="group relative cursor-pointer touch-manipulation focus:outline-none">
                  <HelpCircle className="w-3.5 h-3.5 text-[#9CA3AF]" />
                  <div className="hidden group-hover:block group-focus:block absolute right-0 bottom-full mb-1.5 w-60 p-2 bg-[#111827] text-white text-[11px] rounded-sm shadow-lg z-20 text-left">
                    Maximum observed percentage decline from a historic peak to a subsequent trough on real price history.
                  </div>
                </button>
              </div>
              <div className="text-xl font-medium text-[#EF4444] mt-2 font-mono">
                {metrics.maxDrawdown > 0 ? `-${metrics.maxDrawdown.toFixed(2)}%` : '0.00%'}
              </div>
              <div className="text-[11px] text-[#9CA3AF] mt-1">
                Peak-to-trough decline
              </div>
            </div>

          </div>

          {/* Benchmark Comparison Chart */}
          <div className="bg-white border border-[#E5E7EB] rounded-sm p-6 shadow-xs">
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-[#6B7280]">
                  Benchmarking
                </h3>
                {missingBenchmarks.length > 0 && (
                  <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-sm font-medium flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-amber-600" />
                    <span>No data for: {missingBenchmarks.join(', ')}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-[#9CA3AF] mt-0.5">
                Real cumulative % return of your portfolio against one or more market indices for the period selected above (no synthetic returns)
              </p>
            </div>

            {isLoadingBenchmark ? (
              <div className="h-72 flex flex-col items-center justify-center text-center p-6 bg-[#F9FAFB] rounded-sm border border-[#E5E7EB]">
                <Loader2 className="w-6 h-6 text-[#2563EB] animate-spin mb-2" />
                <p className="text-xs text-[#6B7280]">Fetching real benchmark price series...</p>
              </div>
            ) : multiBenchmarkPoints.length > 0 ? (
              <div className="w-full h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={multiBenchmarkPoints} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                    <XAxis
                      dataKey="date"
                      stroke="#9CA3AF"
                      fontSize={10}
                      tickLine={false}
                      axisLine={{ stroke: '#E5E7EB' }}
                      tickFormatter={(val) => {
                        const parts = val.split('-');
                        return parts.length === 3 ? `${parts[2]}.${parts[1]}` : val;
                      }}
                    />
                    <YAxis
                      stroke="#9CA3AF"
                      fontSize={10}
                      tickLine={false}
                      axisLine={{ stroke: '#E5E7EB' }}
                      tickFormatter={(val) => `${val > 0 ? '+' : ''}${val}%`}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-[#111827] text-white p-3 rounded-sm text-xs font-mono shadow-xl space-y-1">
                              <div className="text-[#9CA3AF] font-sans">{label}</div>
                              <div className="text-white font-medium flex items-center justify-between gap-4">
                                <span>My Portfolio:</span>
                                <span className={portfolioTotalReturnPct >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}>
                                  {formatPct((payload.find((p: any) => p.dataKey === 'portfolioPct')?.value as number) ?? 0)}
                                </span>
                              </div>
                              {selectedBenchmarks.map((key, idx) => {
                                const val = payload.find((p: any) => p.dataKey === key)?.value as number | undefined;
                                if (val === undefined) return null;
                                return (
                                  <div key={key} className="text-[#9CA3AF] flex items-center justify-between gap-4">
                                    <span>{key}:</span>
                                    <span style={{ color: BENCHMARK_COLORS[idx % BENCHMARK_COLORS.length] }}>
                                      {formatPct(val)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Line
                      name="My Portfolio"
                      type="monotone"
                      dataKey="portfolioPct"
                      stroke="#2563EB"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    {selectedBenchmarks.map((key, idx) => (
                      <Line
                        key={key}
                        name={BENCHMARK_INFO[key].name}
                        type="monotone"
                        dataKey={key}
                        stroke={BENCHMARK_COLORS[idx % BENCHMARK_COLORS.length]}
                        strokeWidth={1.75}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-center text-xs text-[#9CA3AF] bg-[#F9FAFB] rounded-sm border border-dashed border-[#E5E7EB]">
                Historical price points needed to generate benchmark comparison curves.
              </div>
            )}

            {/* Series legend list: Portfolio + each active benchmark, with cumulative % and a remove (X) button — like getquin's benchmarking screen */}
            <div className="mt-5 divide-y divide-[#F3F4F6] border-t border-[#F3F4F6]">
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB]" />
                  <span className="text-sm font-medium text-[#111827]">Portfolio</span>
                </div>
                <span className={`text-sm font-semibold font-mono ${portfolioTotalReturnPct >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                  {formatPct(portfolioTotalReturnPct)}
                </span>
              </div>
              {selectedBenchmarks.map((key, idx) => {
                const ret = benchmarkTotalReturns[key];
                return (
                  <div key={key} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: BENCHMARK_COLORS[idx % BENCHMARK_COLORS.length] }}
                      />
                      <span className="text-sm font-medium text-[#111827]">{BENCHMARK_INFO[key].name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {ret !== undefined ? (
                        <span className={`text-sm font-semibold font-mono ${ret >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                          {formatPct(ret)}
                        </span>
                      ) : (
                        <span className="text-xs text-[#9CA3AF]">no data</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeBenchmark(key)}
                        className="text-[#9CA3AF] hover:text-[#EF4444] cursor-pointer p-1 -m-1"
                        aria-label={`Remove ${key} benchmark`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add benchmark control */}
            {availableBenchmarksToAdd.length > 0 && (
              <div className="relative mt-3">
                <button
                  type="button"
                  onClick={() => setIsBenchmarkPickerOpen((v) => !v)}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-[#2563EB] border border-[#E5E7EB] rounded-sm hover:bg-blue-50 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Benchmark</span>
                </button>
                {isBenchmarkPickerOpen && (
                  <div className="absolute left-0 right-0 sm:right-auto sm:w-64 mt-1 bg-white border border-[#E5E7EB] rounded-sm shadow-lg z-20 overflow-hidden">
                    {availableBenchmarksToAdd.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => addBenchmark(key)}
                        className="w-full text-left px-4 py-2.5 text-xs font-medium text-[#111827] hover:bg-[#F9FAFB] cursor-pointer flex flex-col"
                      >
                        <span>{BENCHMARK_INFO[key].name}</span>
                        <span className="text-[10px] text-[#9CA3AF] font-normal">{BENCHMARK_INFO[key].desc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* 7. Empty State Call to Action */}
      {positions.length === 0 && (
        <div className="bg-white border border-[#E5E7EB] rounded-sm p-8 sm:p-12 text-center max-w-xl mx-auto shadow-xs">
          <div className="w-12 h-12 rounded-sm bg-blue-50 flex items-center justify-center mx-auto text-[#2563EB] mb-4">
            <UploadCloud className="w-6 h-6 text-[#2563EB]" />
          </div>
          <h3 className="text-base font-semibold text-[#111827]">
            Import your XTB file
          </h3>
          <p className="text-xs text-[#6B7280] mt-1.5 leading-relaxed">
            Export your open positions from XTB xStation 5 as an .xlsx or .csv report. Johnfolio will auto-detect columns, preview rows, and stream live prices.
          </p>

          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={onOpenImport}
              className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 active:bg-blue-800 rounded-sm transition-colors shadow-xs cursor-pointer"
            >
              <UploadCloud className="w-4 h-4" />
              <span>Import XTB Open Positions</span>
            </button>
            <button
              onClick={onLoadSampleData}
              className="w-full sm:w-auto inline-flex items-center justify-center space-x-1.5 px-4 py-2 text-xs font-medium text-[#111827] bg-white border border-[#E5E7EB] hover:bg-gray-50 rounded-sm transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#2563EB]" />
              <span>Load sample portfolio</span>
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
