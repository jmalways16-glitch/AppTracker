import React, { useEffect, useState, useMemo } from 'react';
import { Position, ChartPeriod } from '../types';
import { getHistoricalPrices } from '../lib/marketApi';
import { 
  X, 
  TrendingUp, 
  Globe, 
  Building2, 
  Calendar, 
  ExternalLink,
  DollarSign,
  Edit2,
  Trash2,
  Layers
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceDot
} from 'recharts';

interface HoldingDetailModalProps {
  position: Position | null;
  onClose: () => void;
  onEdit?: (position: Position) => void;
  onDelete?: (position: Position) => void;
}

const PERIODS: ChartPeriod[] = ['1D', '1W', '2W', '1M', '3M', 'YTD', '1Y', '3Y', '5Y', 'All'];

export const HoldingDetailModal: React.FC<HoldingDetailModalProps> = ({
  position,
  onClose,
  onEdit,
  onDelete,
}) => {
  const [history, setHistory] = useState<{ date: string; price: number }[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [timeRange, setTimeRange] = useState<ChartPeriod>('1Y');

  useEffect(() => {
    if (!position) return;

    let isMounted = true;
    setLoadingHistory(true);

    getHistoricalPrices(position.symbol, timeRange)
      .then((data) => {
        if (isMounted) {
          setHistory(data);
          setLoadingHistory(false);
        }
      })
      .catch(() => {
        if (isMounted) setLoadingHistory(false);
      });

    return () => {
      isMounted = false;
    };
  }, [position, timeRange]);

  if (!position) return null;

  const formatEur = (val: number) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
    }).format(val);
  };

  const isProfit = position.unrealizedProfitEur >= 0;

  // Map lots that fall within history date range to plot on chart
  const chartLotMarks = useMemo(() => {
    if (!position?.lots || position.lots.length === 0 || history.length === 0) return [];
    const minDate = history[0].date;
    const maxDate = history[history.length - 1].date;

    return position.lots
      .filter((lot) => {
        const d = lot.date ? lot.date.split('T')[0] : '';
        return d && d >= minDate && d <= maxDate;
      })
      .map((lot) => {
        const d = lot.date.split('T')[0];
        // Find closest date in history to snap to valid X axis value
        const match = history.find((h) => h.date === d) || history.reduce((prev, curr) => {
          return Math.abs(new Date(curr.date).getTime() - new Date(d).getTime()) <
                 Math.abs(new Date(prev.date).getTime() - new Date(d).getTime())
            ? curr
            : prev;
        });

        return {
          lot,
          x: match ? match.date : d,
          y: lot.price,
        };
      });
  }, [position?.lots, history]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div 
        className="relative w-full max-w-2xl bg-white rounded-sm shadow-xl border border-[#E5E7EB] overflow-hidden my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-[#E5E7EB] flex items-start justify-between bg-white">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-[#111827] tracking-tight">
                {position.symbol}
              </span>
              <span className="text-xs uppercase font-semibold px-2 py-0.5 rounded-sm bg-blue-50 text-[#2563EB]">
                {position.assetClass}
              </span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded-sm border border-[#E5E7EB] text-[#6B7280]">
                Src: {position.priceSource}
              </span>
            </div>
            <p className="text-xs text-[#6B7280] mt-0.5 font-medium">
              {position.name}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                onClick={() => {
                  onEdit(position);
                  onClose();
                }}
                className="px-2.5 py-1.5 text-xs font-medium text-[#111827] bg-white border border-[#E5E7EB] hover:bg-gray-50 rounded-sm transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Edit quantity, price, currency, or date"
              >
                <Edit2 className="w-3.5 h-3.5 text-[#2563EB]" />
                <span className="hidden sm:inline">Edit</span>
              </button>
            )}

            {onDelete && (
              <button
                onClick={() => {
                  onDelete(position);
                  onClose();
                }}
                className="px-2.5 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 hover:bg-red-50 rounded-sm transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Delete position from portfolio"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-[#9CA3AF] hover:text-[#111827] hover:bg-gray-100 rounded-sm transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Key Metrics Header */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-[#F9FAFB] rounded-sm border border-[#E5E7EB] text-xs">
            <div>
              <span className="text-[#6B7280]">Current Price</span>
              <div className="text-sm font-semibold text-[#111827] font-mono mt-0.5">
                {position.currentPrice > 0 ? formatEur(position.currentPriceEur) : 'Unavailable'}
              </div>
              {position.currency !== 'EUR' && position.currentPrice > 0 && (
                <div className="text-[10px] text-[#9CA3AF] font-mono">
                  {position.currentPrice.toFixed(2)} {position.currency}
                </div>
              )}
            </div>

            <div>
              <span className="text-[#6B7280]">Avg Buy Price</span>
              <div className="text-sm font-semibold text-[#111827] font-mono mt-0.5">
                {formatEur(position.openPriceEur)}
              </div>
              {position.currency !== 'EUR' && (
                <div className="text-[10px] text-[#9CA3AF] font-mono">
                  {position.openPrice.toFixed(2)} {position.currency}
                </div>
              )}
            </div>

            <div>
              <span className="text-[#6B7280]">Quantity</span>
              <div className="text-sm font-semibold text-[#111827] font-mono mt-0.5">
                {position.quantity}
              </div>
              <div className="text-[10px] text-[#9CA3AF]">shares / units</div>
            </div>

            <div>
              <span className="text-[#6B7280]">Unrealized P&amp;L</span>
              <div
                className={`text-sm font-semibold font-mono mt-0.5 ${
                  isProfit ? 'text-[#10B981]' : 'text-[#EF4444]'
                }`}
              >
                {isProfit ? '+' : ''}
                {formatEur(position.unrealizedProfitEur)}
              </div>
              <div className={`text-[10px] font-mono ${isProfit ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                {isProfit ? '+' : ''}
                {position.unrealizedProfitPct.toFixed(2)}%
              </div>
            </div>
          </div>

          {/* Historical Price Chart */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-3">
                <h4 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
                  Price History
                </h4>
                {chartLotMarks.length > 0 && (
                  <div className="flex items-center gap-2.5 text-[11px] text-[#6B7280]">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-[#10B981] inline-block" /> Compra
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-[#EF4444] inline-block" /> Venda
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center space-x-0.5 bg-[#F9FAFB] border border-[#E5E7EB] p-0.5 rounded-sm text-[11px] overflow-x-auto">
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setTimeRange(p)}
                    className={`px-2 py-0.5 rounded-sm whitespace-nowrap cursor-pointer ${
                      timeRange === p
                        ? 'bg-white text-[#2563EB] font-semibold shadow-xs'
                        : 'text-[#6B7280] hover:text-[#111827]'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-56 bg-white rounded-sm border border-[#E5E7EB] p-3">
              {loadingHistory ? (
                <div className="h-full flex items-center justify-center text-xs text-[#9CA3AF]">
                  Loading market price series...
                </div>
              ) : history.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                    <XAxis
                      dataKey="date"
                      stroke="#9CA3AF"
                      fontSize={10}
                      tickLine={false}
                      axisLine={{ stroke: '#E5E7EB' }}
                      tickFormatter={(d) => (timeRange === '1D' ? d : d.slice(5))}
                    />
                    <YAxis
                      stroke="#9CA3AF"
                      fontSize={10}
                      tickLine={false}
                      axisLine={{ stroke: '#E5E7EB' }}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const pt = payload[0].payload;
                          return (
                            <div className="bg-[#111827] text-white px-2.5 py-1.5 rounded-sm text-xs font-mono">
                              <div className="text-[#9CA3AF]">{pt.date}</div>
                              <div className="font-semibold text-blue-400">
                                {position.currency} {Number(pt.price).toFixed(2)}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke="#2563EB"
                      strokeWidth={1.75}
                      dot={false}
                      isAnimationActive={false}
                    />
                    {chartLotMarks.map(({ lot, x, y }) => (
                      <ReferenceDot
                        key={lot.id}
                        x={x}
                        y={y}
                        r={5}
                        fill={lot.type === 'sell' ? '#EF4444' : '#10B981'}
                        stroke="#FFFFFF"
                        strokeWidth={2}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-[#9CA3AF]">
                  Historical series unavailable for {position.symbol}
                </div>
              )}
            </div>
          </div>

          {/* Transaction Lots Table */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#2563EB]" />
                Lotes de Transação ({position.lots?.length || 0})
              </h4>
            </div>

            <div className="border border-[#E5E7EB] rounded-sm overflow-hidden">
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F9FAFB] text-[#6B7280] font-semibold border-b border-[#E5E7EB] sticky top-0">
                    <tr>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2 text-right">Qtd</th>
                      <th className="px-3 py-2 text-right">Preço</th>
                      <th className="px-3 py-2 text-right">Preço (EUR)</th>
                      <th className="px-3 py-2 text-right">Valor Total (EUR)</th>
                      <th className="px-3 py-2 text-center">Origem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6]">
                    {(position.lots || []).map((lot) => (
                      <tr key={lot.id} className="hover:bg-gray-50/70 font-mono">
                        <td className="px-3 py-2 text-[#111827]">
                          {lot.date ? lot.date.split('T')[0] : 'N/A'}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded-xs text-[10px] font-semibold uppercase ${
                              lot.type === 'sell'
                                ? 'bg-red-50 text-red-600 border border-red-200'
                                : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                            }`}
                          >
                            {lot.type === 'sell' ? 'Venda' : 'Compra'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-[#111827]">
                          {lot.quantity}
                        </td>
                        <td className="px-3 py-2 text-right text-[#6B7280]">
                          {lot.price.toFixed(2)} {lot.currency}
                        </td>
                        <td className="px-3 py-2 text-right text-[#111827]">
                          {formatEur(lot.priceEur)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-[#111827]">
                          {formatEur(lot.valueEur)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded-xs bg-gray-100 text-[#4B5563]">
                            {lot.source}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Fundamentals & Metadata */}
          <div>
            <h4 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2.5">
              Fundamentals &amp; Classification
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 bg-[#F9FAFB] rounded-sm border border-[#E5E7EB]">
                <span className="text-[#6B7280] flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-[#9CA3AF]" /> Sector
                </span>
                <span className="font-medium text-[#111827] mt-1 block truncate">
                  {position.sector || 'Not classified'}
                </span>
              </div>

              <div className="p-3 bg-[#F9FAFB] rounded-sm border border-[#E5E7EB]">
                <span className="text-[#6B7280] flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5 text-[#9CA3AF]" /> Country
                </span>
                <span className="font-medium text-[#111827] mt-1 block truncate">
                  {position.country || 'Global'}
                </span>
              </div>

              <div className="p-3 bg-[#F9FAFB] rounded-sm border border-[#E5E7EB]">
                <span className="text-[#6B7280] flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-[#9CA3AF]" /> Open Date
                </span>
                <span className="font-medium text-[#111827] mt-1 block truncate font-mono">
                  {position.openTime.split('T')[0]}
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-[#F9FAFB] border-t border-[#E5E7EB] flex items-center justify-between text-xs text-[#6B7280]">
          <span>Single Source of Truth: Firestore Cloud</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-[#E5E7EB] text-[#111827] font-medium rounded-sm hover:bg-gray-50 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
