import React, { useMemo, useState } from 'react';
import { Position } from '../types';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';
import { EtfOverlapSection } from './EtfOverlapSection';

interface AllocationViewProps {
  positions: Position[];
  totalPortfolioValueEur: number;
}

// Geometric Balance theme palette
const PALETTE = [
  '#2563EB', // blue-600
  '#3B82F6', // blue-500
  '#60A5FA', // blue-400
  '#93C5FD', // blue-300
  '#1D4ED8', // blue-700
  '#1E40AF', // blue-800
  '#111827', // gray-900
  '#374151', // gray-700
  '#4B5563', // gray-600
  '#6B7280', // gray-500
  '#9CA3AF', // gray-400
];

export const AllocationView: React.FC<AllocationViewProps> = ({
  positions,
  totalPortfolioValueEur,
}) => {
  const [activeSegment, setActiveSegment] = useState<'sector' | 'country' | 'assetClass'>('sector');

  const formatEur = (val: number) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(val);
  };

  // Group by sector
  const sectorData = useMemo(() => {
    const map = new Map<string, number>();
    positions.forEach((p) => {
      const sec = p.sector || (p.assetClass === 'etf' ? 'Index / Fund' : 'Not classified');
      map.set(sec, (map.get(sec) || 0) + p.marketValueEur);
    });

    return Array.from(map.entries())
      .map(([name, value]) => ({
        name,
        value: Math.round(value),
        pct: totalPortfolioValueEur > 0 ? (value / totalPortfolioValueEur) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [positions, totalPortfolioValueEur]);

  // Group by country/region
  const countryData = useMemo(() => {
    const map = new Map<string, number>();
    positions.forEach((p) => {
      const c = p.country || 'Global';
      map.set(c, (map.get(c) || 0) + p.marketValueEur);
    });

    return Array.from(map.entries())
      .map(([name, value]) => ({
        name,
        value: Math.round(value),
        pct: totalPortfolioValueEur > 0 ? (value / totalPortfolioValueEur) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [positions, totalPortfolioValueEur]);

  // Group by Asset Class (Stock vs ETF)
  const assetClassData = useMemo(() => {
    const map = new Map<string, number>();
    positions.forEach((p) => {
      const cls = p.assetClass === 'etf' ? 'ETFs' : p.assetClass === 'stock' ? 'Stocks' : 'Other';
      map.set(cls, (map.get(cls) || 0) + p.marketValueEur);
    });

    return Array.from(map.entries())
      .map(([name, value]) => ({
        name,
        value: Math.round(value),
        pct: totalPortfolioValueEur > 0 ? (value / totalPortfolioValueEur) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [positions, totalPortfolioValueEur]);

  const activeData =
    activeSegment === 'sector'
      ? sectorData
      : activeSegment === 'country'
      ? countryData
      : assetClassData;

  const titleText =
    activeSegment === 'sector'
      ? 'Sector Allocation'
      : activeSegment === 'country'
      ? 'Regional / Country Allocation'
      : 'Asset Class Allocation (Stocks vs ETFs)';

  return (
    <div className="space-y-6 pb-16">
      
      {/* Segment Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light text-[#111827] mb-1 tracking-tight">
            Allocation
          </h1>
          <p className="text-sm text-[#6B7280]">
            Diversification breakdown across sectors, countries, and asset types
          </p>
        </div>

        <div className="flex items-center border border-[#E5E7EB] rounded-sm p-0.5 bg-[#F9FAFB] self-start">
          <button
            onClick={() => setActiveSegment('sector')}
            className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors cursor-pointer ${
              activeSegment === 'sector'
                ? 'bg-white text-[#2563EB] shadow-xs font-semibold'
                : 'text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            Sector
          </button>
          <button
            onClick={() => setActiveSegment('country')}
            className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors cursor-pointer ${
              activeSegment === 'country'
                ? 'bg-white text-[#2563EB] shadow-xs font-semibold'
                : 'text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            Region / Country
          </button>
          <button
            onClick={() => setActiveSegment('assetClass')}
            className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors cursor-pointer ${
              activeSegment === 'assetClass'
                ? 'bg-white text-[#2563EB] shadow-xs font-semibold'
                : 'text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            Stock vs ETF
          </button>
        </div>
      </div>

      {positions.length > 0 ? (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-white border border-[#E5E7EB] rounded-sm p-6 shadow-xs">
          
          {/* Donut Chart Canvas */}
          <div className="lg:col-span-6 flex flex-col items-center justify-center p-4">
            <h3 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2">
              {titleText}
            </h3>
            <div className="w-full h-64 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const item = payload[0].payload;
                        return (
                          <div className="bg-[#111827] text-white px-3 py-2 rounded-sm text-xs font-mono shadow-xl">
                            <div className="font-semibold font-sans">{item.name}</div>
                            <div className="text-blue-400 mt-0.5">{formatEur(item.value)}</div>
                            <div className="text-[#9CA3AF]">{item.pct.toFixed(1)}% of portfolio</div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Pie
                    data={activeData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={105}
                    paddingAngle={2}
                    stroke="#ffffff"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {activeData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={PALETTE[index % PALETTE.length]}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="text-center text-xs text-[#9CA3AF] -mt-2 font-mono">
              Total Valuation: {formatEur(totalPortfolioValueEur)}
            </div>
          </div>

          {/* Breakdown List */}
          <div className="lg:col-span-6 flex flex-col justify-center border-t lg:border-t-0 lg:border-l border-[#E5E7EB] lg:pl-6 pt-4 lg:pt-0">
            <h3 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-3">
              Distribution &amp; Weight
            </h3>
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {activeData.map((item, index) => {
                const color = PALETTE[index % PALETTE.length];
                return (
                  <div
                    key={item.name}
                    className="flex items-center justify-between text-xs p-2 rounded-sm hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="font-medium text-[#111827] truncate">
                        {item.name}
                      </span>
                    </div>

                    <div className="text-right shrink-0 font-mono">
                      <span className="text-[#111827] font-medium mr-2.5">
                        {formatEur(item.value)}
                      </span>
                      <span className="text-[#6B7280] font-normal inline-block w-12 text-right">
                        {item.pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* ETF Overlap Analysis */}
        <EtfOverlapSection
          positions={positions}
          totalPortfolioValueEur={totalPortfolioValueEur}
        />
      </>
      ) : (
        <div className="bg-white border border-[#E5E7EB] rounded-sm p-12 text-center text-xs text-[#9CA3AF]">
          No holdings available for allocation breakdown. Import your XTB positions file to begin.
        </div>
      )}

    </div>
  );
};
