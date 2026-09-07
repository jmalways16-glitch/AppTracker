import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Position,
  BenchmarkKey,
  MultiBenchmarkPoint
} from '../types';
import {
  reconstructPortfolioHistory,
  generateMultiBenchmarkComparison,
} from '../lib/calculations';
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  X,
  Layers,
  Plus,
  Calendar,
  Check,
  BarChart3
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip
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

// Popular indices available to add as a benchmark
const AVAILABLE_BENCHMARKS: BenchmarkMeta[] = [
  { key: 'SPY', name: 'S&P 500', ticker: 'SPY', color: '#60A5FA' },
  { key: 'QQQ', name: 'NASDAQ 100', ticker: 'QQQ', color: '#8B5CF6' },
  { key: 'DIA', name: 'Dow Jones', ticker: 'DIA', color: '#F59E0B' },
  { key: 'IWM', name: 'Russell 2000', ticker: 'IWM', color: '#EF4444' },
  { key: 'URTH', name: 'MSCI World', ticker: 'URTH', color: '#10B981' },
  { key: 'VWCE', name: 'FTSE All-World', ticker: 'VWCE.DE', color: '#06B6D4' },
  { key: 'STOXX', name: 'STOXX Europe 600', ticker: 'EXSA.DE', color: '#EC4899' },
];

const PORTFOLIO_COLOR = '#1E3A8A';
const PORTFOLIO_NAME = 'Individual';

// Portfolio + up to 2 benchmarks active at once
const MAX_TOTAL_LINES = 3;
const MAX_BENCHMARKS = MAX_TOTAL_LINES - 1;

type PeriodPreset = '1D' | '1W' | '1M' | '3M' | 'YTD';

const PERIOD_LIST: { id: PeriodPreset; label: string }[] = [
  { id: '1D', label: '1D' },
  { id: '1W', label: '1S' },
  { id: '1M', label: '1M' },
  { id: '3M', label: '3M' },
  { id: 'YTD', label: 'YTD' },
];

const formatCrosshairDate = (dateStr: string): string => {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const BenchmarkView: React.FC<BenchmarkViewProps> = ({
  positions,
  onOpenImport,
  onLoadSampleData,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<PeriodPreset | 'CUSTOM'>('1M');
  const [customDays, setCustomDays] = useState<number | null>(null);
  const [customLabel, setCustomLabel] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [pendingCustomDate, setPendingCustomDate] = useState<string>('');

  const [selectedBenchmarks, setSelectedBenchmarks] = useState<BenchmarkKey[]>(['SPY']);
  const [showAddBenchmarkModal, setShowAddBenchmarkModal] = useState<boolean>(false);
  const [pendingBenchmarkSelection, setPendingBenchmarkSelection] = useState<BenchmarkKey[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [comparisonPoints, setComparisonPoints] = useState<MultiBenchmarkPoint[]>([]);
  const [benchmarkReturns, setBenchmarkReturns] = useState<Partial<Record<BenchmarkKey, number>>>({});
  const [portfolioReturnPct, setPortfolioReturnPct] = useState<number>(0);
  const [hoveredPoint, setHoveredPoint] = useState<MultiBenchmarkPoint | null>(null);

  // The actual period value passed down to the data layer
  const effectivePeriod = useMemo(() => {
    if (selectedPreset === 'CUSTOM' && customDays) return customDays;
    return selectedPreset === 'CUSTOM' ? '1M' : selectedPreset;
  }, [selectedPreset, customDays]);

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
        const historyResult = await reconstructPortfolioHistory(positions, effectivePeriod as any);
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

        const comp = await generateMultiBenchmarkComparison(
          points,
          selectedBenchmarks,
          effectivePeriod as any
        );

        if (isCancelled) return;

        setComparisonPoints(comp.comparisonPoints);
        setBenchmarkReturns(comp.totalReturns);
        setPortfolioReturnPct(comp.portfolioTotalReturnPct);
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
  }, [positions, effectivePeriod, selectedBenchmarks]);

  // Unified Y domain covering portfolio & active benchmarks
  const yDomain = useMemo(() => {
    if (comparisonPoints.length === 0) return { min: -1, max: 1 };
    let min = Infinity;
    let max = -Infinity;
    comparisonPoints.forEach((pt) => {
      if (typeof pt.portfolioPct === 'number') {
        min = Math.min(min, pt.portfolioPct);
        max = Math.max(max, pt.portfolioPct);
      }
      selectedBenchmarks.forEach((key) => {
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
  }, [comparisonPoints, selectedBenchmarks]);

  // Rows shown below the chart: portfolio first, then each active benchmark
  const legendRows = useMemo(() => {
    const target = hoveredPoint || (comparisonPoints.length > 0 ? comparisonPoints[comparisonPoints.length - 1] : null);

    interface Row {
      id: string;
      isPortfolio: boolean;
      name: string;
      color: string;
      pct: number;
    }

    const rows: Row[] = [];

    const pPct = target && typeof target.portfolioPct === 'number' ? target.portfolioPct : portfolioReturnPct;
    rows.push({ id: 'portfolio', isPortfolio: true, name: PORTFOLIO_NAME, color: PORTFOLIO_COLOR, pct: pPct });

    selectedBenchmarks.forEach((key) => {
      const meta = AVAILABLE_BENCHMARKS.find((b) => b.key === key);
      if (!meta) return;
      let bPct = 0;
      if (target && typeof target[key] === 'number') {
        bPct = target[key] as number;
      } else if (benchmarkReturns[key] !== undefined) {
        bPct = benchmarkReturns[key] as number;
      }
      rows.push({ id: key, isPortfolio: false, name: meta.name, color: meta.color, pct: bPct });
    });

    return rows;
  }, [hoveredPoint, comparisonPoints, portfolioReturnPct, benchmarkReturns, selectedBenchmarks]);

  const removeBenchmark = (key: BenchmarkKey) => {
    setSelectedBenchmarks((prev) => prev.filter((k) => k !== key));
  };

  const openAddBenchmarkModal = () => {
    setPendingBenchmarkSelection(selectedBenchmarks);
    setShowAddBenchmarkModal(true);
  };

  const toggleBenchmarkPending = (key: BenchmarkKey) => {
    setPendingBenchmarkSelection((prev) => {
      if (prev.includes(key)) {
        return prev.filter((k) => k !== key);
      }
      if (prev.length >= MAX_BENCHMARKS) return prev;
      return [...prev, key];
    });
  };

  const applyBenchmarkSelection = () => {
    setSelectedBenchmarks(pendingBenchmarkSelection);
    setShowAddBenchmarkModal(false);
  };

  const openDatePicker = () => {
    setShowDatePicker(true);
  };

  const applyCustomDate = () => {
    if (!pendingCustomDate) return;
    const picked = new Date(pendingCustomDate);
    if (isNaN(picked.getTime())) return;
    const days = Math.max(1, Math.ceil((Date.now() - picked.getTime()) / 86400000));
    setCustomDays(days);
    setCustomLabel(picked.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }));
    setSelectedPreset('CUSTOM');
    setShowDatePicker(false);
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
          Importe o relatório de posições abertas da XTB para ver a comparação em tempo real com os principais índices globais.
        </p>
        <div className="flex flex-col w-full gap-2.5">
          {onOpenImport && (
            <button
              onClick={onOpenImport}
              className="w-full py-3 px-4 bg-[#0284C7] hover:bg-sky-700 active:scale-98 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
            >
              Importar Relatório XTB
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

      {/* Header, matching the rest of the app's tab pages */}
      <div className="pt-1 pb-3">
        <h1 className="text-3xl font-light text-[#111827] tracking-tight">
          Benchmarking
        </h1>
      </div>

      {/* Chart area */}
      <div className="relative w-full h-64 sm:h-72 min-w-0">
        {/* Crosshair date label */}
        {hoveredPoint && (
          <div className="absolute top-0 left-0 right-0 flex justify-center pointer-events-none z-10">
            <span className="text-[11px] font-medium text-gray-400 bg-white/90 px-1.5 rounded">
              {formatCrosshairDate(hoveredPoint.date)}
            </span>
          </div>
        )}

        {isLoading ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-center">
            <RefreshCw className="w-7 h-7 text-[#0284C7] animate-spin mb-2" />
            <span className="text-xs font-medium text-[#6B7280]">A sincronizar…</span>
          </div>
        ) : comparisonPoints.length === 0 ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-center p-4">
            <BarChart3 className="w-10 h-10 text-gray-300 mb-2" />
            <p className="text-xs text-[#6B7280]">Nenhum histórico disponível para este período.</p>
          </div>
        ) : (
          <div className="w-full h-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={comparisonPoints}
                margin={{ top: 22, right: 4, left: 4, bottom: 4 }}
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
                  cursor={{ stroke: '#D1D5DB', strokeWidth: 1, strokeDasharray: '3 3' }}
                />

                {selectedBenchmarks.map((key) => {
                  const meta = AVAILABLE_BENCHMARKS.find((b) => b.key === key);
                  if (!meta) return null;
                  return (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={meta.color}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  );
                })}

                <Line
                  type="monotone"
                  dataKey="portfolioPct"
                  stroke={PORTFOLIO_COLOR}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, fill: PORTFOLIO_COLOR, stroke: '#FFFFFF', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Period selector: 1D / 1S / 1M / 3M / YTD + custom date picker */}
      <div className="my-2.5 w-full min-w-0">
        <div
          className="bg-[#F3F4F6] p-1 rounded-full flex items-center justify-between overflow-x-auto scrollbar-none shadow-2xs w-full touch-pan-x"
          style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' }}
        >
          {PERIOD_LIST.map((p) => {
            const isSelected = selectedPreset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setSelectedPreset(p.id);
                  setCustomDays(null);
                  setCustomLabel(null);
                }}
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
            onClick={openDatePicker}
            className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              selectedPreset === 'CUSTOM'
                ? 'bg-white text-[#0284C7] shadow-sm'
                : 'text-[#6B7280] hover:text-[#111827]'
            }`}
            title="Escolher data"
          >
            <Calendar className="w-3.5 h-3.5" />
          </button>
        </div>
        {selectedPreset === 'CUSTOM' && customLabel && (
          <div className="text-center text-[10px] text-gray-400 mt-1.5">Desde {customLabel}</div>
        )}
      </div>

      {/* Legend rows: colour dot, name, % change, remove button */}
      <div className="mt-1 space-y-1.5">
        {legendRows.map((row) => {
          const isPositive = row.pct >= 0;
          return (
            <div
              key={row.id}
              className="flex items-center justify-between py-1.5"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                <span className="text-sm font-bold text-[#111827] truncate">{row.name}</span>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-sm font-bold flex items-center gap-0.5 ${isPositive ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
                  {isPositive ? <TrendingUp className="w-3.5 h-3.5 stroke-[2.5]" /> : <TrendingDown className="w-3.5 h-3.5 stroke-[2.5]" />}
                  {isPositive ? '+' : ''}{row.pct.toFixed(2)}%
                </span>
                {!row.isPortfolio && (
                  <button
                    onClick={() => removeBenchmark(row.id as BenchmarkKey)}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add benchmark */}
      {selectedBenchmarks.length < MAX_BENCHMARKS && (
        <button
          onClick={openAddBenchmarkModal}
          className="mt-2 w-full py-3 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 rounded-2xl text-sm font-semibold text-[#111827] flex items-center justify-center gap-1.5 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Benchmark
        </button>
      )}

      {/* Add Benchmark Modal */}
      {showAddBenchmarkModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end sm:items-center justify-center animate-in fade-in duration-200">
          <div className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl p-5 space-y-3 shadow-xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-[#F3F4F6]">
              <h3 className="text-sm font-bold text-[#111827]">Escolher Benchmark</h3>
              <button
                onClick={() => setShowAddBenchmarkModal(false)}
                className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[#6B7280] hover:text-[#111827] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-gray-400">Seleciona até {MAX_BENCHMARKS} índices</p>

            <div className="space-y-1.5">
              {AVAILABLE_BENCHMARKS.map((meta) => {
                const isChecked = pendingBenchmarkSelection.includes(meta.key);
                const isDisabled = !isChecked && pendingBenchmarkSelection.length >= MAX_BENCHMARKS;
                return (
                  <button
                    key={meta.key}
                    onClick={() => toggleBenchmarkPending(meta.key)}
                    disabled={isDisabled}
                    className={`w-full flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer ${
                      isChecked
                        ? 'bg-sky-50 border-sky-200'
                        : isDisabled
                        ? 'bg-gray-50 border-gray-100 opacity-50 cursor-not-allowed'
                        : 'bg-[#FAFAFA] hover:bg-white border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                      <span className="text-xs font-bold text-[#111827]">{meta.name}</span>
                    </div>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center border-2 ${
                      isChecked ? 'bg-[#0284C7] border-[#0284C7]' : 'border-gray-300'
                    }`}>
                      {isChecked && <Check className="w-3 h-3 text-white stroke-[3]" />}
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={applyBenchmarkSelection}
              className="w-full py-2.5 bg-[#0284C7] hover:bg-sky-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}

      {/* Date Picker Modal (custom period) */}
      {showDatePicker && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end sm:items-center justify-center animate-in fade-in duration-200">
          <div className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-2 border-b border-[#F3F4F6]">
              <h3 className="text-sm font-bold text-[#111827]">Ver desde uma data</h3>
              <button
                onClick={() => setShowDatePicker(false)}
                className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[#6B7280] hover:text-[#111827] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <input
              type="date"
              value={pendingCustomDate}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => setPendingCustomDate(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-sky-200"
            />

            <button
              onClick={applyCustomDate}
              disabled={!pendingCustomDate}
              className="w-full py-2.5 bg-[#0284C7] hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
