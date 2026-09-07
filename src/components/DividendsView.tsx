import React, { useState, useEffect } from 'react';
import { Position, DividendEvent } from '../types';
import { getDividendsForHoldings } from '../lib/marketApi';
import { 
  Calendar as CalendarIcon, 
  Coins, 
  TrendingUp, 
  Clock, 
  CheckCircle2, 
  RefreshCw,
  AlertCircle
} from 'lucide-react';

interface DividendsViewProps {
  positions: Position[];
  totalPortfolioValueEur: number;
}

export const DividendsView: React.FC<DividendsViewProps> = ({
  positions,
  totalPortfolioValueEur,
}) => {
  const [dividends, setDividends] = useState<DividendEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (positions.length === 0) return;

    let isMounted = true;
    setLoading(true);

    getDividendsForHoldings(
      positions.map((p) => ({
        symbol: p.symbol,
        quantity: p.quantity,
        name: p.name,
      }))
    )
      .then((data) => {
        if (isMounted) {
          setDividends(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.warn('Error fetching dividends:', e);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [positions]);

  const formatEur = (val: number) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  };

  const currentYear = new Date().getFullYear();

  // Metrics
  const thisYearDividends = dividends.filter((d) => {
    const y = new Date(d.payDate).getFullYear();
    return y === currentYear;
  });

  const totalDividendsThisYearEur = thisYearDividends.reduce(
    (sum, d) => sum + d.expectedAmountEur,
    0
  );

  const averageYieldPct =
    totalPortfolioValueEur > 0
      ? (totalDividendsThisYearEur / totalPortfolioValueEur) * 100
      : 0;

  const upcomingDividends = dividends.filter((d) => d.isUpcoming);
  const pastDividends = dividends.filter((d) => !d.isUpcoming);

  return (
    <div className="space-y-6 pb-16">
      
      {/* Header */}
      <div>
        <h1 className="text-3xl font-light text-[#111827] mb-1 tracking-tight">
          Dividends
        </h1>
        <p className="text-sm text-[#6B7280]">
          Expected payments matched against your open positions via Finnhub
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        
        <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
            Total Received / Scheduled ({currentYear})
          </span>
          <div className="text-xl font-medium text-[#111827] mt-1 font-mono">
            {formatEur(totalDividendsThisYearEur)}
          </div>
          <div className="text-[11px] text-[#9CA3AF] mt-1">
            Across {thisYearDividends.length} payment events
          </div>
        </div>

        <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
            Estimated Portfolio Yield
          </span>
          <div className="text-xl font-medium text-[#111827] mt-1 font-mono">
            {averageYieldPct > 0 ? `${averageYieldPct.toFixed(2)}%` : '0.00%'}
          </div>
          <div className="text-[11px] text-[#9CA3AF] mt-1">
            Annualized dividend income / portfolio value
          </div>
        </div>

        <div className="bg-white border border-[#E5E7EB] p-4 rounded-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
            Upcoming Payouts
          </span>
          <div className="text-xl font-medium text-[#111827] mt-1 font-mono">
            {upcomingDividends.length}
          </div>
          <div className="text-[11px] text-[#9CA3AF] mt-1">
            Future payment dates on calendar
          </div>
        </div>

      </div>

      {/* Upcoming Payouts Calendar Timeline */}
      <div className="bg-white border border-[#E5E7EB] rounded-sm p-6 shadow-xs">
        <h3 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-4 flex items-center gap-1.5">
          <CalendarIcon className="w-4 h-4 text-[#9CA3AF]" />
          Upcoming Dividend Calendar
        </h3>

        {loading ? (
          <div className="py-8 text-center text-xs text-[#9CA3AF] flex items-center justify-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#2563EB]" />
            <span>Scanning dividend records for held assets...</span>
          </div>
        ) : upcomingDividends.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {upcomingDividends.map((div) => (
              <div
                key={div.id}
                className="p-3.5 rounded-sm border border-[#E5E7EB] bg-[#F9FAFB] hover:bg-white transition-colors text-xs"
              >
                <div className="flex items-center justify-between font-mono">
                  <span className="font-semibold text-[#111827]">{div.symbol}</span>
                  <span className="text-[#10B981] font-semibold">{formatEur(div.expectedAmountEur)}</span>
                </div>
                <div className="text-[11px] text-[#6B7280] truncate mt-0.5">
                  {div.name}
                </div>
                <div className="flex items-center justify-between text-[11px] text-[#9CA3AF] mt-2 pt-2 border-t border-[#E5E7EB]">
                  <span>Pay date: {div.payDate}</span>
                  <span>{div.amountPerShare} / share</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-[#9CA3AF] bg-[#F9FAFB] rounded-sm border border-dashed border-[#E5E7EB]">
            No upcoming dividend payment dates announced for held positions at this time.
          </div>
        )}
      </div>

      {/* Historical Dividend Table */}
      <div className="bg-white border border-[#E5E7EB] rounded-sm shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <h3 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
            Dividend Distribution History
          </h3>
          <span className="text-xs text-[#9CA3AF]">
            {dividends.length} recorded events
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-mono">
            <thead className="bg-[#F9FAFB] text-[#6B7280] uppercase tracking-wider font-semibold text-[10.5px] border-b border-[#E5E7EB]">
              <tr>
                <th className="px-5 py-3">Symbol</th>
                <th className="px-5 py-3">Pay Date</th>
                <th className="px-5 py-3">Ex-Date</th>
                <th className="px-5 py-3 text-right">Per Share</th>
                <th className="px-5 py-3 text-right">Shares Held</th>
                <th className="px-5 py-3 text-right">Estimated Total (€)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {dividends.length > 0 ? (
                dividends.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-semibold text-[#111827]">
                      {item.symbol}
                    </td>
                    <td className="px-5 py-3 text-[#6B7280]">{item.payDate}</td>
                    <td className="px-5 py-3 text-[#9CA3AF]">{item.exDate}</td>
                    <td className="px-5 py-3 text-right text-[#4B5563]">
                      {item.currency} {item.amountPerShare.toFixed(4)}
                    </td>
                    <td className="px-5 py-3 text-right text-[#4B5563]">
                      {item.sharesHeld}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-[#111827]">
                      {formatEur(item.expectedAmountEur)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-[#9CA3AF] font-sans text-xs">
                    {loading ? 'Fetching dividend schedules...' : 'No dividend distributions found for your held symbols.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
