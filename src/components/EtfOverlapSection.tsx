import React, { useEffect, useState } from 'react';
import { Position, EtfOverlapItem } from '../types';
import { calculatePortfolioOverlap } from '../lib/etfOverlap';
import { Layers, Info, CheckCircle2, AlertCircle } from 'lucide-react';

interface EtfOverlapSectionProps {
  positions: Position[];
  totalPortfolioValueEur: number;
}

export const EtfOverlapSection: React.FC<EtfOverlapSectionProps> = ({
  positions,
  totalPortfolioValueEur,
}) => {
  const [overlapItems, setOverlapItems] = useState<EtfOverlapItem[]>([]);
  const [etfsAnalyzed, setEtfsAnalyzed] = useState<{ symbol: string; name: string; portfolioWeightPct: number; holdingsCount: number }[]>([]);
  const [skippedEtfs, setSkippedEtfs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    calculatePortfolioOverlap(positions, totalPortfolioValueEur)
      .then((res) => {
        if (isMounted) {
          setOverlapItems(res.overlapItems);
          setEtfsAnalyzed(res.etfsAnalyzed);
          setSkippedEtfs(res.skippedEtfs);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.warn('ETF overlap error:', err);
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [positions, totalPortfolioValueEur]);

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-sm p-6 shadow-xs mt-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#E5E7EB]">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-[#6B7280]">
              ETF Overlap Analysis
            </h3>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm bg-blue-50 text-[#2563EB] font-medium border border-blue-100">
              TwelveData Connected
            </span>
          </div>
          <p className="text-xs text-[#6B7280] mt-1">
            Detects companies appearing across multiple held ETFs and your direct stock positions.
          </p>
        </div>

        {/* Analyzed Count Pill */}
        {etfsAnalyzed.length > 0 && (
          <div className="flex items-center gap-2 text-xs font-mono text-[#111827] bg-[#F9FAFB] border border-[#E5E7EB] px-3 py-1.5 rounded-sm self-start sm:self-auto">
            <span className="text-[#6B7280]">ETFs Analyzed:</span>
            <span className="font-semibold text-[#2563EB]">{etfsAnalyzed.length}</span>
            <span className="text-[#9CA3AF]">|</span>
            <span className="text-[#6B7280]">Overlapping:</span>
            <span className="font-semibold text-[#111827]">{overlapItems.length}</span>
          </div>
        )}
      </div>

      {/* Skipped Notice if any */}
      {skippedEtfs.length > 0 && (
        <div className="mt-4 p-2.5 bg-gray-50 border border-gray-200 rounded-sm text-xs text-[#6B7280] flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
          <span>
            Holdings data unavailable for {skippedEtfs.join(', ')} — skipped gracefully from overlap calculation.
          </span>
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="py-12 text-center text-xs text-[#9CA3AF]">
          Analyzing ETF constituents via TwelveData...
        </div>
      ) : overlapItems.length > 0 ? (
        <div className="mt-5 space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-left text-[#6B7280] font-semibold uppercase tracking-wider">
                  <th className="pb-3 pr-4">Company / Stock</th>
                  <th className="pb-3 px-4">Found Inside</th>
                  <th className="pb-3 pl-4 text-right">Combined Portfolio Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {overlapItems.map((item) => (
                  <tr key={item.symbol} className="hover:bg-gray-50/70 transition-colors">
                    {/* Stock Name & Symbol */}
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-[#111827] font-mono">
                        {item.symbol}
                      </div>
                      <div className="text-[#6B7280] text-[11px] truncate max-w-xs">
                        {item.name}
                      </div>
                    </td>

                    {/* Appearing in Badges */}
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {item.isDirectHolding && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-emerald-50 text-[#10B981] border border-emerald-200 text-[10px] font-medium font-mono">
                            Direct Holding ({item.directWeightPct.toFixed(1)}%)
                          </span>
                        )}
                        {item.etfs.map((e) => (
                          <span
                            key={e.etfSymbol}
                            className="inline-flex items-center px-2 py-0.5 rounded-sm bg-blue-50 text-[#2563EB] border border-blue-100 text-[10px] font-medium font-mono"
                            title={`${e.weightInsideEtfPct}% weight inside ${e.etfName}`}
                          >
                            {e.etfSymbol} ({e.weightInsideEtfPct.toFixed(1)}%)
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Combined Weight & Bar */}
                    <td className="py-3 pl-4 text-right">
                      <div className="font-semibold text-[#111827] font-mono text-sm">
                        {item.combinedWeightPct.toFixed(2)}%
                      </div>
                      <div className="w-24 ml-auto mt-1 bg-gray-100 h-1.5 rounded-sm overflow-hidden">
                        <div
                          className="bg-[#2563EB] h-full rounded-sm"
                          style={{ width: `${Math.min(100, item.combinedWeightPct * 5)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="py-10 text-center text-xs text-[#9CA3AF]">
          {etfsAnalyzed.length < 2
            ? 'Hold at least 2 ETFs (or an ETF plus individual stock positions) to view portfolio overlap.'
            : 'No overlapping constituents found across your held funds.'}
        </div>
      )}
    </section>
  );
};
