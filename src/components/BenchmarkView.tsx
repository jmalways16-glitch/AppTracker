import React, { useState, useEffect, useMemo } from 'react';
import {
  Position,
  ChartPeriod,
  BenchmarkKey,
  MultiBenchmarkPoint,
} from '../types';
import {
  reconstructPortfolioHistory,
  generateMultiBenchmarkComparison,
} from '../lib/calculations';
import {
  Plus,
  X,
  Calendar,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Layers,
  BarChart3,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';

interface BenchmarkViewProps {
  positions: Position[];
  onOpenImport?: () => void;
  onLoadSampleData?: () => void;
}

interface BenchmarkMeta {
  key: BenchmarkKey;
  name: string;
  ticker: string;
  color: string;
}

// Full catalogue of indices the user can add via "+ Benchmark"
export const AVAILABLE_BENCHMARKS: BenchmarkMeta[] = [
  { key: 'SPY', name: 'S&P 500', ticker: 'SPY', color: '#60A5FA' },
  { key: 'QQQ', name: 'NASDAQ 100', ticker: 'QQQ', color: '#8B5CF6' },
  { key: 'VWCE', name: 'FTSE All-World', ticker: 'VWCE.DE', color: '#10B981' },
  { key: 'STOXX', name: 'STOXX Europe 600', ticker: 'EXSA.DE', color: '#06B6D4' },
  { key: 'BTC', name: 'Bitcoin', ticker: 'BTC-USD', color: '#F59E0B' },
  { key: 'GLD', name: 'Ouro (Gold)', ticker: 'GLD', color: '#CA8A04' },
];

const PORTFOLIO_COLOR = '#1D4ED8'; // dark blue "Individual" line
const PORTFOLIO_NAME = 'Individual';

// Period pills shown at the bottom of the chart (1D/1W added per request)
const PERIOD_LIST: { id: ChartPeriod; label: string }[] = [
  { id: '1D', label: '1D' },
  { id: '1W', label: '1W' },
  { id: '1M', label: '1M' },
  { id: 'YTD', label: 'YTD' },
  { id: '1Y', label: '1Y' },
  { id: '3Y', label: '3Y' },
  { id: '5Y', label: '5Y' },
  { id: 'All', label: 'Max' },
];

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getDate()}. ${MONTHS_PT[d.getMonth()]} ${d.getFullYear()}`;
}

function toDateInputValue(d: Date): string {
  return d.toISOString().split('T')[0];
}

// Rebase a set of cumulative % series onto a new baseline point (the first
// point in the filtered/custom window) so a custom date range shows the
// correct % change *within* that window, not from the original chart start.
function rebaseComparisonPoints(
  points: MultiBenchmarkPoint[],
  keys: string[]
): MultiBenchmarkPoint[] {
  if (points.length === 0) return points;
  const base = points[0];
  return points.map((p) => {
    const next: MultiBenchmarkPoint = { date: p.date, portfolioPct: p.portfolioPct };
    keys.forEach((k) => {
      const baseVal = base[k];
      const val = p[k];
      if (typeof val === 'number' && typeof baseVal === 'number') {
        next[k] = Math.round((((1 + val / 100) / (1 + baseVal / 100) - 1) * 100) * 10) / 10;
      } else if (typeof val === 'number') {
        next[k] = val;
      }
    });
    return next;
  });
}

export const BenchmarkView: React.FC<BenchmarkViewProps> = ({
  positions,
  onOpenImport,
  onLoadSampleData,
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState<ChartPeriod | 'Custom'>('All');
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);
  const [activeBenchmarks, setActiveBenchmarks] = useState<BenchmarkKey[]>(['SPY']);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [comparisonPoints, setComparisonPoints] = useState<MultiBenchmarkPoint[]>([]);
  const [benchmarkReturns, setBenchmarkReturns] = useState<Partial<Record<BenchmarkKey, number>>>({});
  const [portfolioReturnPct, setPortfolioReturnPct] = useState<number>(0);
  const [hoveredPoint, setHoveredPoint] = useState<MultiBenchmarkPoint | null>(null);

  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showDateModal, setShowDateModal] = useState<boolean>(false);
  const [draftRange, setDraftRange] = useState<{ start: string; end: string }>(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { start: toDateInputValue(start), end: toDateInputValue(end) };
  });

  // Resolve the value we actually pass down to the data layer: either a
  // named ChartPeriod, or a number of days to cover a custom date range.
  const fetchPeriod: ChartPeriod | number = useMemo(() => {
    if (selectedPeriod === 'Custom' && customRange) {
      const startMs = new Date(`${customRange.start}T00:00:00`).getTime();
      if (!isNaN(startMs)) {
        const days = Math.max(2, Math.ceil((Date.now() - startMs) / 86400000) + 2);
        return days;
      }
    }
    return (selectedPeriod === 'Custom' ? 'All' : selectedPeriod) as ChartPeriod;
  }, [selectedPeriod, customRange]);

  // Fetch benchmark & portfolio comparison data
  useEffect(() => {
    let isCancelled = false;

    if (positions.length === 0) {
      setComparisonPoints([]);
      setBenchmarkReturns({});
      setPortfolioReturnPct(0);
      setIsLoading(false);
      return;
    }

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const historyResult = await reconstructPortfolioHistory(positions, fetchPeriod);
        if (isCancelled) return;

        let points = historyResult.points;
        if (points.length === 0) {
          const nowStr = new Date().toISOString().split('T')[0];
          const totalBasis = positions.reduce((sum, p) => sum + p.costBasisEur, 0);
          const totalVal = positions.reduce((sum, p) => sum + p.marketValueEur, 0);
          const gain = totalBasis > 0 ? ((totalVal - totalBasis) / totalBasis) * 100 : 0;
          points = [
            {
              date: nowStr,
              timestamp: Date.now(),
              portfolioValueEur: totalVal,
              costBasisEur: totalBasis,
              gainPct: gain,
            },
          ];
        }

        const comp = await generateMultiBenchmarkComparison(points, activeBenchmarks, fetchPeriod);
        if (isCancelled) return;

        let finalPoints = comp.comparisonPoints;

        // Trim + rebase to the exact custom window
        if (selectedPeriod === 'Custom' && customRange) {
          const filtered = finalPoints.filter(
            (p) => p.date >= customRange.start && p.date <= customRange.end
          );
          if (filtered.length > 0) {
            finalPoints = rebaseComparisonPoints(filtered, ['portfolioPct', ...activeBenchmarks]);
          }
        }

        setComparisonPoints(finalPoints);

        const lastPoint = finalPoints[finalPoints.length - 1];
        const returns: Partial<Record<BenchmarkKey, number>> = {};
        activeBenchmarks.forEach((key) => {
          if (lastPoint && typeof lastPoint[key] === 'number') {
            returns[key] = lastPoint[key] as number;
          } else if (comp.totalReturns[key] !== undefined) {
            returns[key] = comp.totalReturns[key];
          }
        });
        setBenchmarkReturns(returns);
        setPortfolioReturnPct(lastPoint ? (lastPoint.portfolioPct as number) : comp.portfolioTotalReturnPct);
      } catch (err) {
        console.error('Error calculating benchmark performance:', err);
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      isCancelled = true;
    };
  }, [positions, fetchPeriod, activeBenchmarks, selectedPeriod, customRange]);

  // Unified Y domain covering the portfolio & all active benchmarks
  const yDomain = useMemo(() => {
    if (comparisonPoints.length === 0) return { min: -1, max: 1 };
    let min = Infinity;
    let max = -Infinity;
    comparisonPoints.forEach((pt) => {
      if (typeof pt.portfolioPct === 'number') {
        min = Math.min(min, pt.portfolioPct);
        max = Math.max(max, pt.portfolioPct);
      }
      activeBenchmarks.forEach((key) => {
        const v = pt[key];
        if (typeof v === 'number') {
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      });
    });
    if (min === Infinity || max === -Infinity) return { min: -1, max: 1 };
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const range = max - min;
    const pad = Math.max(range * 0.16, 0.5);
    return { min: min - pad, max: max + pad };
  }, [comparisonPoints, activeBenchmarks]);

  // List of rows shown under the chart: Individual first, then each active
  // benchmark, all reflecting the scrubbed point (or the period end).
  const listItems = useMemo(() => {
    const target = hoveredPoint || (comparisonPoints.length > 0 ? comparisonPoints[comparisonPoints.length - 1] : null);

    const pPct = target && typeof target.portfolioPct === 'number' ? target.portfolioPct : portfolioReturnPct;

    const items: { id: string; name: string; color: string; pct: number; removable: boolean }[] = [
      { id: 'portfolio', name: PORTFOLIO_NAME, color: PORTFOLIO_COLOR, pct: pPct, removable: false },
    ];

    activeBenchmarks.forEach((key) => {
      const meta = AVAILABLE_BENCHMARKS.find((b) => b.key === key);
      if (!meta) return;
      let pct = 0;
      if (target && typeof target[key] === 'number') {
        pct = target[key] as number;
      } else if (benchmarkReturns[key] !== undefined) {
        pct = benchmarkReturns[key] as number;
      }
      items.push({ id: key, name: meta.name, color: meta.color, pct, removable: true });
    });

    return items;
  }, [hoveredPoint, comparisonPoints, portfolioReturnPct, benchmarkReturns, activeBenchmarks]);

  const removableOptions = AVAILABLE_BENCHMARKS.filter((b) => !activeBenchmarks.includes(b.key));

  const addBenchmark = (key: BenchmarkKey) => {
    setActiveBenchmarks((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setShowAddModal(false);
  };

  const removeBenchmark = (key: BenchmarkKey) => {
    setActiveBenchmarks((prev) => prev.filter((k) => k !== key));
  };

  const applyCustomRange = () => {
    if (!draftRange.start || !draftRange.end || draftRange.start > draftRange.end) return;
    setCustomRange({ start: draftRange.start, end: draftRange.end });
    setSelectedPeriod('Custom');
    setShowDateModal(false);
  };

  // Empty state handling
  if (positions.length === 0) {
    return (
      <div className="min-h-[75vh] flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 text-[#0284C7] flex items-center justify-center mb-4 shadow-sm">
          <Layers className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-[#111827] tracking-tight">Nenhuma Posição para Comparar</h2>
        <p className="text-xs text-[#6B7280] mt-2 mb-6 leading-relaxed">
          Importe o relatório de posições abertas para ver a comparação com os índices de mercado.
        </p>
        <div className="flex flex-col w-full gap-2.5">
          {onOpenImport && (
            <button
              onClick={onOpenImport}
              className="w-full py-3 px-4 bg-[#0284C7] hover:bg-sky-700 active:scale-98 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
            >
              Importar Relatório
            </button>
          )}
          {onLoadSampleData && (
            <button
              onClick={onLoadSampleData}
              className="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-[#374151] text-xs font-semibold rounded-xl transition-all cursor-pointer"
            >
              Carregar Dados de Exemplo
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto bg-[#FFFFFF] text-[#111827] flex flex-col px-3.5 py-2.5 sm:px-5 sm:py-4 select-none overflow-x-hidden min-w-0 pb-16">

      {/* Header */}
      <div className="flex items-center justify-center pt-1 pb-3 relative">
        <h1 className="text-lg font-bold tracking-tight text-[#111827]">Benchmarking</h1>
      </div>

      {/* Chart Area */}
      <div className="relative w-full h-72 sm:h-80 my-1 min-w-0">
        {isLoading ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-center">
            <RefreshCw className="w-7 h-7 text-[#0284C7] animate-spin mb-2" />
            <span className="text-xs font-medium text-[#6B7280]">A carregar...</span>
          </div>
        ) : comparisonPoints.length === 0 ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-center p-4">
            <BarChart3 className="w-10 h-10 text-gray-300 mb-2" />
            <p className="text-xs text-[#6B7280]">Sem histórico disponível para este período.</p>
          </div>
        ) : (
          <div className="w-full h-full relative">
            {/* Floating date label while scrubbing */}
            {hoveredPoint && (
              <div className="absolute top-0 left-0 right-0 flex justify-center pointer-events-none z-10">
                <span className="text-[11px] font-medium text-[#9CA3AF] bg-white/90 px-2">
                  {formatDateLabel(hoveredPoint.date)}
                </span>
              </div>
            )}

            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={comparisonPoints}
                margin={{ top: 24, right: 8, left: 2, bottom: 20 }}
                onMouseMove={(e: any) => {
                  if (e && e.activePayload && e.activePayload.length) {
                    setHoveredPoint(e.activePayload[0].payload as MultiBenchmarkPoint);
                  }
                }}
                onMouseLeave={() => setHoveredPoint(null)}
                onTouchMove={(e: any) => {
                  if (e && e.activePayload && e.activePayload.length) {
                    setHoveredPoint(e.activePayload[0].payload as MultiBenchmarkPoint);
                  }
                }}
                onTouchEnd={() => setHoveredPoint(null)}
              >
                <XAxis dataKey="date" hide />
                <YAxis hide domain={[yDomain.min, yDomain.max]} />

                <Tooltip
                  content={() => null}
                  cursor={{ stroke: '#CBD5E1', strokeWidth: 1.5, strokeDasharray: '3 3' }}
                />

                {hoveredPoint && (
                  <ReferenceLine x={hoveredPoint.date} stroke="#CBD5E1" strokeWidth={1.5} />
                )}

                {activeBenchmarks.map((key) => {
                  const meta = AVAILABLE_BENCHMARKS.find((b) => b.key === key);
                  if (!meta) return null;
                  return (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={meta.color}
                      strokeWidth={2.2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  );
                })}

                <Line
                  type="monotone"
                  dataKey="portfolioPct"
                  stroke={PORTFOLIO_COLOR}
                  strokeWidth={2.6}
                  dot={false}
                  activeDot={{ r: 4, fill: PORTFOLIO_COLOR, stroke: '#FFFFFF', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Period Selector Bar */}
      <div className="my-2.5 w-full min-w-0">
        <div
          className="bg-[#F3F4F6] p-1 rounded-full flex items-center justify-between overflow-x-auto scrollbar-none shadow-2xs w-full touch-pan-x"
          style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' }}
        >
          {PERIOD_LIST.map((p) => {
            const isSelected = selectedPeriod === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedPeriod(p.id)}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-full transition-all shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-white text-[#0284C7] shadow-sm font-bold'
                    : 'text-[#6B7280] hover:text-[#111827]'
                }`}
              >
                {p.label}
              </button>
            );
          })}
          <button
            onClick={() => setShowDateModal(true)}
            className={`w-7 h-7 flex items-center justify-center rounded-full shrink-0 cursor-pointer transition-all ${
              selectedPeriod === 'Custom' ? 'bg-white text-[#0284C7] shadow-sm' : 'text-[#6B7280] hover:text-[#111827]'
            }`}
            title="Escolher intervalo de datas"
          >
            <Calendar className="w-4 h-4" />
          </button>
        </div>
        {selectedPeriod === 'Custom' && customRange && (
          <div className="text-center text-[10px] text-gray-400 mt-1.5 font-medium">
            {formatDateLabel(customRange.start)} — {formatDateLabel(customRange.end)}
          </div>
        )}
      </div>

      {/* List: Individual + active benchmarks */}
      <div className="mt-2">
        {listItems.map((item) => {
          const isItemPositive = item.pct >= 0;
          return (
            <div
              key={item.id}
              className="flex items-center justify-between py-3 border-b border-gray-100"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-sm font-bold text-[#111827] truncate">{item.name}</span>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span
                  className={`flex items-center gap-1 text-sm font-bold ${
                    isItemPositive ? 'text-[#059669]' : 'text-[#DC2626]'
                  }`}
                >
                  {isItemPositive ? (
                    <TrendingUp className="w-3.5 h-3.5 stroke-[2.5]" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5 stroke-[2.5]" />
                  )}
                  {isItemPositive ? '+' : ''}
                  {item.pct.toFixed(2)}%
                </span>

                {item.removable && (
                  <button
                    onClick={() => removeBenchmark(item.id as BenchmarkKey)}
                    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700 cursor-pointer"
                    title="Remover"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Benchmark Button */}
      <button
        onClick={() => setShowAddModal(true)}
        disabled={removableOptions.length === 0}
        className="mt-4 w-full py-3 border border-gray-300 rounded-xl flex items-center justify-center gap-2 text-sm font-bold text-[#111827] hover:bg-gray-50 active:scale-98 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Plus className="w-4 h-4" />
        Benchmark
      </button>

      {/* Add Benchmark Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl p-5 space-y-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#F3F4F6]">
              <h3 className="text-sm font-bold text-[#111827]">Adicionar Benchmark</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[#6B7280] hover:text-[#111827] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {removableOptions.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">Já adicionaste todos os índices disponíveis.</p>
            ) : (
              <div className="space-y-1">
                {removableOptions.map((meta) => (
                  <button
                    key={meta.key}
                    onClick={() => addBenchmark(meta.key)}
                    className="w-full flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-gray-50 transition-all cursor-pointer"
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                    <span className="text-sm font-semibold text-[#111827]">{meta.name}</span>
                    <span className="text-[10px] text-gray-400 ml-auto">{meta.ticker}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Custom Date Range Modal */}
      {showDateModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
          onClick={() => setShowDateModal(false)}
        >
          <div
            className="bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl p-5 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#F3F4F6]">
              <h3 className="text-sm font-bold text-[#111827]">Intervalo de Datas</h3>
              <button
                onClick={() => setShowDateModal(false)}
                className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[#6B7280] hover:text-[#111827] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">De</label>
                <input
                  type="date"
                  value={draftRange.start}
                  max={draftRange.end}
                  onChange={(e) => setDraftRange((prev) => ({ ...prev, start: e.target.value }))}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-sky-200"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Até</label>
                <input
                  type="date"
                  value={draftRange.end}
                  min={draftRange.start}
                  max={toDateInputValue(new Date())}
                  onChange={(e) => setDraftRange((prev) => ({ ...prev, end: e.target.value }))}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-sky-200"
                />
              </div>
            </div>

            <button
              onClick={applyCustomRange}
              className="w-full py-3 bg-[#0284C7] hover:bg-sky-700 active:scale-98 text-white text-sm font-bold rounded-xl shadow-xs transition-all cursor-pointer"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
