import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Position, 
  ChartPeriod, 
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
  Info, 
  X,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
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

export interface BenchmarkMeta {
  key: BenchmarkKey;
  name: string;
  fullName: string;
  ticker: string;
  description: string;
  color: string;
  bgColor: string;
  tag: string;
}

// 4 Predetermined Global Benchmark Indices (Excluding BTC & GLD)
export const CORE_BENCHMARKS: BenchmarkMeta[] = [
  {
    key: 'SPY',
    name: 'S&P 500',
    fullName: 'SPDR S&P 500 ETF Trust',
    ticker: 'SPY',
    description: 'As 500 maiores empresas dos EUA (Mercado Americano)',
    color: '#F59E0B', // Warm Amber Gold
    bgColor: '#FEF3C7',
    tag: 'EUA',
  },
  {
    key: 'QQQ',
    name: 'NASDAQ 100',
    fullName: 'Invesco QQQ Trust',
    ticker: 'QQQ',
    description: 'Gigantes globais de tecnologia e inovação',
    color: '#8B5CF6', // Purple Violet
    bgColor: '#EDE9FE',
    tag: 'Tech',
  },
  {
    key: 'VWCE',
    name: 'FTSE All-World',
    fullName: 'Vanguard FTSE All-World UCITS (VWCE)',
    ticker: 'VWCE.DE',
    description: 'Ações globais de mercados desenvolvidos e emergentes',
    color: '#10B981', // Emerald Green
    bgColor: '#D1FAE5',
    tag: 'Global',
  },
  {
    key: 'STOXX',
    name: 'STOXX Europe 600',
    fullName: 'iShares Core STOXX Europe 600 (EXSA)',
    ticker: 'EXSA.DE',
    description: 'As 600 principais empresas de 17 países da Europa',
    color: '#06B6D4', // Cyan Blue
    bgColor: '#CFFAFE',
    tag: 'Europa',
  },
];

// Always active benchmarks list
const ACTIVE_BENCHMARK_KEYS: BenchmarkKey[] = ['SPY', 'QQQ', 'VWCE', 'STOXX'];

// Standard periods
const PERIOD_LIST: { id: ChartPeriod; label: string }[] = [
  { id: '1D', label: '1D' },
  { id: '3D', label: '3D' },
  { id: '1W', label: '1W' },
  { id: '2W', label: '2W' },
  { id: '1M', label: '1M' },
  { id: '3M', label: '3M' },
  { id: '6M', label: '6M' },
  { id: 'YTD', label: 'YTD' },
  { id: '1Y', label: '1Y' },
  { id: 'All', label: 'ALL' },
];

export const BenchmarkView: React.FC<BenchmarkViewProps> = ({
  positions,
  onOpenImport,
  onLoadSampleData,
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState<ChartPeriod>('1D');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [comparisonPoints, setComparisonPoints] = useState<MultiBenchmarkPoint[]>([]);
  const [benchmarkReturns, setBenchmarkReturns] = useState<Partial<Record<BenchmarkKey, number>>>({});
  const [portfolioReturnPct, setPortfolioReturnPct] = useState<number>(0);
  const [hoveredPoint, setHoveredPoint] = useState<MultiBenchmarkPoint | null>(null);
  const [showInfoModal, setShowInfoModal] = useState<boolean>(false);

  // Total Portfolio Value in EUR
  const totalPortfolioValueEur = useMemo(() => {
    return positions.reduce((acc, p) => acc + p.marketValueEur, 0);
  }, [positions]);

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
        // 1. Reconstruct portfolio history points
        const historyResult = await reconstructPortfolioHistory(positions, selectedPeriod);
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

        // 2. Generate multi-benchmark comparison points for the 4 core benchmarks
        const comp = await generateMultiBenchmarkComparison(
          points,
          ACTIVE_BENCHMARK_KEYS,
          selectedPeriod
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
  }, [positions, selectedPeriod]);

  // Compute active displayed values: interactive scrubbing point or period end
  const displayedPct = useMemo(() => {
    if (hoveredPoint && typeof hoveredPoint.portfolioPct === 'number') {
      return hoveredPoint.portfolioPct;
    }
    return portfolioReturnPct;
  }, [hoveredPoint, portfolioReturnPct]);

  // Euro gain/loss in the period
  const periodEurChange = useMemo(() => {
    if (totalPortfolioValueEur === 0) return 0;
    return (totalPortfolioValueEur * displayedPct) / 100;
  }, [totalPortfolioValueEur, displayedPct]);

  const isPositive = displayedPct >= 0;

  // Format currency
  const formatEur = (val: number) => {
    return new Intl.NumberFormat('pt-PT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  };

  // Chart Container Dimensions & ResizeObserver for dynamic, pixel-perfect alignment
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartDimensions, setChartDimensions] = useState<{ width: number; height: number }>({
    width: 380,
    height: 310,
  });

  useEffect(() => {
    if (!chartContainerRef.current) return;
    const updateSize = () => {
      if (chartContainerRef.current) {
        const { width, height } = chartContainerRef.current.getBoundingClientRect();
        if (width > 0 && height > 0) {
          setChartDimensions({ width, height });
        }
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(chartContainerRef.current);
    return () => observer.disconnect();
  }, []);

  // Unified Y domain covering portfolio & all 4 benchmarks with comfortable vertical breathing room
  const yDomain = useMemo(() => {
    if (comparisonPoints.length === 0) return { min: -1, max: 1 };
    let min = Infinity;
    let max = -Infinity;
    comparisonPoints.forEach((pt) => {
      if (typeof pt.portfolioPct === 'number') {
        min = Math.min(min, pt.portfolioPct);
        max = Math.max(max, pt.portfolioPct);
      }
      ACTIVE_BENCHMARK_KEYS.forEach((key) => {
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
  }, [comparisonPoints]);

  // Guaranteed Anti-Collision Algorithm: Badges at the end of each line that NEVER overlap
  const lineEndBadges = useMemo(() => {
    if (comparisonPoints.length === 0) return [];
    const target = hoveredPoint || comparisonPoints[comparisonPoints.length - 1];
    if (!target) return [];

    const plotTop = 18;
    const plotBottom = chartDimensions.height - 28;
    const plotHeight = Math.max(40, plotBottom - plotTop);
    const domainRange = yDomain.max - yDomain.min;

    const getY = (val: number) => {
      if (domainRange <= 0) return plotTop + plotHeight / 2;
      const pct = (yDomain.max - val) / domainRange;
      const clamped = Math.max(0, Math.min(1, pct));
      return plotTop + clamped * plotHeight;
    };

    interface BadgeItem {
      id: string;
      name: string;
      color: string;
      textColor: string;
      value: number;
      rawY: number;
      adjustedY: number;
    }

    const items: BadgeItem[] = [];

    // 1. Portfolio line badge
    const pVal = target.portfolioPct ?? portfolioReturnPct ?? 0;
    const pY = getY(pVal);
    items.push({
      id: 'portfolio',
      name: 'XTB',
      color: '#0284C7',
      textColor: '#FFFFFF',
      value: pVal,
      rawY: pY,
      adjustedY: pY,
    });

    // 2. Selected 4 benchmark badges
    ACTIVE_BENCHMARK_KEYS.forEach((key) => {
      const meta = CORE_BENCHMARKS.find((b) => b.key === key);
      if (!meta) return;
      const bVal = (typeof target[key] === 'number' ? target[key] : benchmarkReturns[key]) as number ?? 0;
      const bY = getY(bVal);
      items.push({
        id: key,
        name: meta.name.split(' ')[0], // 'S&P', 'NASDAQ', 'FTSE', 'STOXX'
        color: meta.color,
        textColor: '#FFFFFF',
        value: bVal,
        rawY: bY,
        adjustedY: bY,
      });
    });

    // Sort ascending by rawY (from top of chart downwards)
    items.sort((a, b) => a.rawY - b.rawY);

    // Enforce 23px vertical distance between each badge so they NEVER collide
    const minGap = 23;
    const topBound = 14;
    const bottomBound = chartDimensions.height - 24;

    // Pass 1: push downwards
    for (let i = 1; i < items.length; i++) {
      if (items[i].adjustedY < items[i - 1].adjustedY + minGap) {
        items[i].adjustedY = items[i - 1].adjustedY + minGap;
      }
    }

    // Pass 2: push upwards if hitting bottom margin
    if (items.length > 0 && items[items.length - 1].adjustedY > bottomBound) {
      items[items.length - 1].adjustedY = bottomBound;
      for (let i = items.length - 2; i >= 0; i--) {
        if (items[i].adjustedY > items[i + 1].adjustedY - minGap) {
          items[i].adjustedY = items[i + 1].adjustedY - minGap;
        }
      }
    }

    // Pass 3: push downwards if hitting top margin
    if (items.length > 0 && items[0].adjustedY < topBound) {
      items[0].adjustedY = topBound;
      for (let i = 1; i < items.length; i++) {
        if (items[i].adjustedY < items[i - 1].adjustedY + minGap) {
          items[i].adjustedY = items[i - 1].adjustedY + minGap;
        }
      }
    }

    return items;
  }, [
    comparisonPoints,
    hoveredPoint,
    portfolioReturnPct,
    benchmarkReturns,
    yDomain,
    chartDimensions,
  ]);

  // Opção B: Ordenadas automaticamente pelo desempenho do período selecionado
  const rankedTableItems = useMemo(() => {
    const target = hoveredPoint || (comparisonPoints.length > 0 ? comparisonPoints[comparisonPoints.length - 1] : null);

    interface TableRowItem {
      id: string;
      isPortfolio: boolean;
      name: string;
      fullName: string;
      ticker: string;
      color: string;
      bgColor: string;
      tag: string;
      pct: number;
      valueEur: number;
    }

    const rows: TableRowItem[] = [];

    // 1. O Meu Portfólio (XTB)
    const pPct = target && typeof target.portfolioPct === 'number'
      ? target.portfolioPct
      : portfolioReturnPct;

    rows.push({
      id: 'portfolio',
      isPortfolio: true,
      name: 'O Meu Portfólio',
      fullName: 'Posições Abertas XTB',
      ticker: 'XTB',
      color: '#0284C7',
      bgColor: '#E0F2FE',
      tag: 'Carteira',
      pct: pPct,
      valueEur: totalPortfolioValueEur,
    });

    // 2. Os 4 Índices Globais
    CORE_BENCHMARKS.forEach((meta) => {
      let bPct = 0;
      if (target && typeof target[meta.key] === 'number') {
        bPct = target[meta.key] as number;
      } else if (benchmarkReturns[meta.key] !== undefined) {
        bPct = benchmarkReturns[meta.key] as number;
      }

      // Valor equivalente ilustrativo baseado no montante da carteira no período
      const simulatedVal = totalPortfolioValueEur > 0 
        ? totalPortfolioValueEur * (1 + bPct / 100) 
        : 0;

      rows.push({
        id: meta.key,
        isPortfolio: false,
        name: meta.name,
        fullName: meta.fullName,
        ticker: meta.ticker,
        color: meta.color,
        bgColor: meta.bgColor,
        tag: meta.tag,
        pct: bPct,
        valueEur: simulatedVal,
      });
    });

    // Ordenar de maior rendimento para menor rendimento no período selecionado (Opção B)
    rows.sort((a, b) => b.pct - a.pct);

    return rows;
  }, [hoveredPoint, comparisonPoints, portfolioReturnPct, benchmarkReturns, totalPortfolioValueEur]);

  // Empty state handling
  if (positions.length === 0) {
    return (
      <div className="min-h-[75vh] flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 text-[#0284C7] flex items-center justify-center mb-4 shadow-sm">
          <Layers className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-[#111827] tracking-tight">Nenhuma Posição para Comparar</h2>
        <p className="text-xs text-[#6B7280] mt-2 mb-6 leading-relaxed">
          Importe o relatório de posições abertas da XTB para ver a comparação em tempo real com os 4 principais índices globais.
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
    <div className="w-full max-w-md mx-auto bg-[#FFFFFF] text-[#111827] flex flex-col justify-between px-3.5 py-2.5 sm:px-5 sm:py-4 select-none overflow-x-hidden min-w-0 pb-16">
      
      {/* 1. Header Bar: Minimal, Centered, Clean */}
      <div className="flex items-center justify-between pt-1 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-xs">
            <BarChart3 className="w-4 h-4 stroke-[2.4]" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight text-[#111827] leading-tight">
              Benchmark Global
            </h1>
            <p className="text-[10px] text-[#6B7280] font-medium">
              4 Índices Mundiais + Carteira XTB
            </p>
          </div>
        </div>

        {/* Info button */}
        <button
          onClick={() => setShowInfoModal(true)}
          className="w-8 h-8 rounded-full bg-[#F3F4F6] hover:bg-gray-200 active:scale-95 text-[#6B7280] hover:text-[#111827] flex items-center justify-center transition-all cursor-pointer shadow-2xs"
          title="Ver detalhes de cálculo e índices"
        >
          <Info className="w-4 h-4 stroke-[2.2]" />
        </button>
      </div>

      {/* 2. Top Legend Pills (All 4 predefined + Portfolio) */}
      <div className="flex items-center gap-1.5 flex-wrap pt-1 pb-2.5">
        {/* Portfolio Chip */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-sky-200 bg-sky-50 text-xs font-bold text-[#0369A1] shadow-2xs whitespace-nowrap">
          <span className="w-2 h-2 rounded-full bg-[#0284C7] ring-2 ring-sky-200 shrink-0" />
          <span>XTB (Carteira)</span>
        </div>

        {/* 4 Core Benchmarks */}
        {CORE_BENCHMARKS.map((meta) => (
          <div
            key={meta.key}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[#E5E7EB] bg-white text-xs font-semibold text-[#374151] shadow-2xs whitespace-nowrap"
          >
            <span 
              className="w-2 h-2 rounded-full shrink-0" 
              style={{ backgroundColor: meta.color }}
            />
            <span>{meta.name}</span>
          </div>
        ))}
      </div>

      {/* 3. Hero Financial Metric: Dynamic with interactive scrubbing */}
      <div className="mt-1 mb-2 bg-gradient-to-b from-gray-50/70 to-white p-3.5 rounded-2xl border border-gray-100 shadow-2xs">
        <div className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-1 flex items-center justify-between">
          <span>Valor da Carteira</span>
          <span className="text-[10px] lowercase font-normal text-gray-400">
            {hoveredPoint ? `no ponto: ${hoveredPoint.date}` : `período: ${selectedPeriod}`}
          </span>
        </div>

        <div className="text-[32px] sm:text-[36px] font-black tracking-tight text-[#111827] leading-none">
          {formatEur(totalPortfolioValueEur)}
        </div>

        <div className="flex items-center gap-2 mt-2 text-xs sm:text-sm font-semibold">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${
            isPositive ? 'bg-emerald-50 text-[#059669]' : 'bg-rose-50 text-[#DC2626]'
          }`}>
            {isPositive ? <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" /> : <ArrowDownRight className="w-3.5 h-3.5 stroke-[2.5]" />}
            <span>
              {isPositive ? '+' : ''}{formatEur(periodEurChange)} ({isPositive ? '+' : ''}{displayedPct.toFixed(2)}%)
            </span>
          </span>
          <span className="text-[#9CA3AF] text-xs font-medium">
            em {selectedPeriod === '1D' ? '1 dia' : selectedPeriod}
          </span>
        </div>
      </div>

      {/* 4. Fluid Chart Area styled with Soft Curves, Glow & Anti-Colliding Badges */}
      <div 
        ref={chartContainerRef} 
        className="relative w-full h-72 sm:h-80 my-1 min-w-0"
      >
        {isLoading ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-center">
            <RefreshCw className="w-7 h-7 text-[#0284C7] animate-spin mb-2" />
            <span className="text-xs font-medium text-[#6B7280]">A sincronizar índices mundiais...</span>
          </div>
        ) : comparisonPoints.length === 0 ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-center p-4">
            <BarChart3 className="w-10 h-10 text-gray-300 mb-2" />
            <p className="text-xs text-[#6B7280]">Nenhum histórico disponível para {selectedPeriod}.</p>
          </div>
        ) : (
          <div className="w-full h-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={comparisonPoints}
                margin={{ top: 18, right: 78, left: 2, bottom: 20 }}
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
                <XAxis 
                  dataKey="date" 
                  tickLine={false} 
                  axisLine={false}
                  tick={{ fontSize: 10, fill: '#9CA3AF', fontWeight: 500 }}
                  minTickGap={35}
                />
                <YAxis hide domain={[yDomain.min, yDomain.max]} />

                {/* Soft vertical cursor for interactive scrubbing */}
                <Tooltip
                  content={() => null}
                  cursor={{ stroke: '#CBD5E1', strokeWidth: 1.5, strokeDasharray: '3 3' }}
                />

                {/* 4 Core Benchmark Lines (Smooth monotone curves with soft opacity) */}
                {CORE_BENCHMARKS.map((meta) => (
                  <Line
                    key={meta.key}
                    type="monotone"
                    dataKey={meta.key}
                    stroke={meta.color}
                    strokeWidth={1.8}
                    strokeOpacity={0.82}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}

                {/* Portfolio Line (Vibrant, Prominent, 3px stroke with shadow effect) */}
                <Line
                  type="monotone"
                  dataKey="portfolioPct"
                  stroke="#0284C7"
                  strokeWidth={3}
                  dot={false}
                  activeDot={{
                    r: 5,
                    fill: '#0284C7',
                    stroke: '#FFFFFF',
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>

            {/* Non-overlapping end-of-line percentage badges for each curve */}
            {lineEndBadges.length > 0 && (
              <div className="absolute inset-0 pointer-events-none">
                {/* SVG Connecting Hairlines and End Dots */}
                <svg className="w-full h-full absolute inset-0 overflow-visible">
                  {lineEndBadges.map((item) => {
                    const lineEndX = Math.max(0, chartDimensions.width - 78);
                    const isDisplaced = Math.abs(item.adjustedY - item.rawY) > 2;

                    return (
                      <g key={`dot-${item.id}`}>
                        <circle
                          cx={lineEndX}
                          cy={item.rawY}
                          r={3.5}
                          fill={item.color}
                          stroke="#FFFFFF"
                          strokeWidth={1.5}
                        />

                        {isDisplaced && (
                          <path
                            d={`M ${lineEndX} ${item.rawY} C ${lineEndX + 4} ${item.rawY}, ${lineEndX + 6} ${item.adjustedY}, ${lineEndX + 8} ${item.adjustedY}`}
                            fill="none"
                            stroke={item.color}
                            strokeWidth={1.2}
                            strokeDasharray="2 2"
                            opacity={0.7}
                          />
                        )}
                      </g>
                    );
                  })}
                </svg>

                {/* Badges Container - Anti-collided with guaranteed vertical separation */}
                {lineEndBadges.map((item) => {
                  const isPositiveVal = item.value >= 0;
                  const formattedVal = `${isPositiveVal ? '+' : ''}${item.value.toFixed(2)}%`;

                  return (
                    <div
                      key={`badge-${item.id}`}
                      style={{
                        position: 'absolute',
                        right: '2px',
                        top: `${item.adjustedY}px`,
                        transform: 'translateY(-50%)',
                        backgroundColor: item.color,
                        color: item.textColor,
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold shadow-xs whitespace-nowrap leading-none transition-all duration-75 pointer-events-auto"
                      title={`${item.name}: ${formattedVal}`}
                    >
                      <span className="opacity-90 font-medium text-[9px]">{item.name}</span>
                      <span>{formattedVal}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 5. Period Selector Bar (Pill design, horizontal scroll contained) */}
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
                    ? 'bg-white text-[#0284C7] shadow-sm font-bold scale-102'
                    : 'text-[#6B7280] hover:text-[#111827]'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 6. NOVO DESIGN DE TABELA SUAVE (Soft Cards):
             - Ordenada por desempenho do período (Opção B)
             - Debaixo do valor aparece a percentagem de cada uma delas
             - Atualização instantânea com a mudança de período
      */}
      <div className="mt-2 space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wider flex items-center gap-1.5">
            <span>Classificação no Período ({selectedPeriod})</span>
            <span className="text-[9px] font-normal text-gray-400 lowercase">(melhor para pior)</span>
          </span>
          <span className="text-[10px] font-medium text-gray-400">
            {rankedTableItems.length} ativos
          </span>
        </div>

        <div className="space-y-1.5">
          {rankedTableItems.map((item, index) => {
            const isItemPositive = item.pct >= 0;
            const isTop1 = index === 0;

            return (
              <div
                key={item.id}
                className={`flex items-center justify-between p-3 rounded-2xl border transition-all ${
                  item.isPortfolio
                    ? 'bg-sky-50/70 border-sky-200/90 shadow-2xs'
                    : 'bg-[#FAFAFA] hover:bg-white border-gray-100 hover:border-gray-200'
                }`}
              >
                {/* Left: Rank badge, Icon, Name & Tag */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    isTop1 
                      ? 'bg-amber-100 text-amber-800' 
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {index + 1}
                  </div>

                  <div 
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-bold truncate ${item.isPortfolio ? 'text-[#0369A1]' : 'text-[#111827]'}`}>
                        {item.name}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-semibold shrink-0">
                        {item.tag}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">
                      {item.isPortfolio ? 'Posições XTB' : item.ticker}
                    </div>
                  </div>
                </div>

                {/* Right: Valor em Cima e a Percentagem de cada uma dela por DEBAIXO do valor */}
                <div className="text-right shrink-0">
                  {/* Valor monetário proporcional */}
                  <div className="text-xs font-bold text-[#111827] leading-tight">
                    {formatEur(item.valueEur)}
                  </div>

                  {/* Percentagem no período selecionado logo abaixo do valor */}
                  <div className={`text-[11px] font-bold leading-tight mt-0.5 flex items-center justify-end gap-0.5 ${
                    isItemPositive ? 'text-[#059669]' : 'text-[#DC2626]'
                  }`}>
                    {isItemPositive ? (
                      <TrendingUp className="w-3 h-3 stroke-[2.5]" />
                    ) : (
                      <TrendingDown className="w-3 h-3 stroke-[2.5]" />
                    )}
                    <span>
                      {isItemPositive ? '+' : ''}{item.pct.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Information Modal (when clicking (i)) */}
      {showInfoModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-2 border-b border-[#F3F4F6]">
              <h3 className="text-sm font-bold text-[#111827] flex items-center gap-2">
                <Info className="w-4 h-4 text-[#0284C7]" />
                Como funciona o Benchmark
              </h3>
              <button
                onClick={() => setShowInfoModal(false)}
                className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[#6B7280] hover:text-[#111827] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-[#4B5563]">
              <p>
                <strong>4 Índices Mundiais Fixos:</strong> S&P 500 (EUA), NASDAQ 100 (Tecnologia), FTSE All-World (Global) e STOXX Europe 600 (Europa).
              </p>
              <p>
                <strong>O Seu Portfólio (XTB):</strong> Representa o rendimento ponderado cumulativo das suas posições abertas na XTB em Euros (€).
              </p>
              <p>
                <strong>Tabela Dinâmica:</strong> Os ativos são classificados do melhor para o pior no período selecionado ({selectedPeriod}), com o valor monetário e a percentagem calculada logo por baixo.
              </p>
            </div>

            <button
              onClick={() => setShowInfoModal(false)}
              className="w-full py-2.5 bg-[#F3F4F6] hover:bg-gray-200 text-[#111827] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
