import React, { useState, useMemo } from 'react';
import { Position } from '../types';
import { HoldingDetailModal } from './HoldingDetailModal';
import { ManualPositionModal } from './ManualPositionModal';
import { DeletePositionDialog } from './DeletePositionDialog';
import { ManualPositionInput, EditPositionInput } from '../lib/positionManager';
import { 
  ArrowUpDown, 
  Search, 
  Info, 
  ExternalLink,
  ChevronRight,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Edit2,
  Trash2,
  FileSpreadsheet
} from 'lucide-react';

interface HoldingsViewProps {
  positions: Position[];
  totalPortfolioValueEur: number;
  onAddOrMergePosition?: (input: ManualPositionInput) => Promise<void>;
  onEditPosition?: (input: EditPositionInput) => Promise<void>;
  onDeletePosition?: (id: string) => Promise<void>;
  onOpenImport?: () => void;
}

type SortField = 'symbol' | 'name' | 'quantity' | 'openPriceEur' | 'currentPriceEur' | 'marketValueEur' | 'unrealizedProfitEur' | 'unrealizedProfitPct' | 'weight';
type SortOrder = 'asc' | 'desc';

export const HoldingsView: React.FC<HoldingsViewProps> = ({
  positions,
  totalPortfolioValueEur,
  onAddOrMergePosition,
  onEditPosition,
  onDeletePosition,
  onOpenImport,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('marketValueEur');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);

  // Manual Position Management State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [positionBeingEdited, setPositionBeingEdited] = useState<Position | null>(null);
  const [positionToDelete, setPositionToDelete] = useState<Position | null>(null);

  const formatEur = (val: number) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  // Filtered and sorted holdings
  const processedPositions = useMemo(() => {
    let list = [...positions];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.symbol.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          (p.sector && p.sector.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => {
      let valA: any = a[sortField as keyof Position];
      let valB: any = b[sortField as keyof Position];

      if (sortField === 'weight') {
        valA = totalPortfolioValueEur > 0 ? (a.marketValueEur / totalPortfolioValueEur) : 0;
        valB = totalPortfolioValueEur > 0 ? (b.marketValueEur / totalPortfolioValueEur) : 0;
      }

      if (typeof valA === 'string') {
        return sortOrder === 'asc'
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }

      const numA = Number(valA || 0);
      const numB = Number(valB || 0);
      return sortOrder === 'asc' ? numA - numB : numB - numA;
    });

    return list;
  }, [positions, searchQuery, sortField, sortOrder, totalPortfolioValueEur]);

  // Source badge renderer
  const renderSourceBadge = (source: string) => {
    switch (source) {
      case 'finnhub':
        return (
          <span 
            title="Market quote source: Finnhub API (Primary)"
            className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-medium bg-blue-50 text-[#2563EB] border border-blue-200/80"
          >
            FH
          </span>
        );
      case 'yahoo':
        return (
          <span 
            title="Market quote source: Yahoo Finance (Fallback #1)"
            className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-medium bg-indigo-50 text-indigo-700 border border-indigo-200/80"
          >
            YF
          </span>
        );
      case 'twelvedata':
        return (
          <span 
            title="Market quote source: TwelveData (Fallback #2)"
            className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-medium bg-sky-50 text-sky-700 border border-sky-200/80"
          >
            12D
          </span>
        );
      case 'xtb':
        return (
          <span 
            title="Market price from XTB report snapshot"
            className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-medium bg-gray-100 text-[#6B7280] border border-[#E5E7EB]"
          >
            XTB
          </span>
        );
      default:
        return (
          <span 
            title="Market price unavailable across all sources"
            className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-medium bg-gray-100 text-[#9CA3AF]"
          >
            N/A
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 pb-16">
      
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light text-[#111827] mb-1 tracking-tight">
            Holdings
          </h1>
          <p className="text-sm text-[#6B7280]">
            {positions.length} active position{positions.length === 1 ? '' : 's'} • Live EUR valuation &amp; Firestore cloud sync
          </p>
        </div>

        {/* Action Buttons & Search Bar */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              setPositionBeingEdited(null);
              setIsAddModalOpen(true);
            }}
            className="px-3.5 py-1.5 bg-[#2563EB] hover:bg-blue-700 text-white rounded-sm font-semibold text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer whitespace-nowrap"
            title="Manually add a holding or merge into existing position"
          >
            <Plus className="w-4 h-4" />
            <span>Add position</span>
          </button>

          {onOpenImport && (
            <button
              onClick={onOpenImport}
              className="px-3 py-1.5 bg-white border border-[#E5E7EB] hover:bg-gray-50 text-[#111827] rounded-sm font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              title="Import XTB open positions report"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#6B7280]" />
              <span className="hidden md:inline">Import XTB</span>
            </button>
          )}

          {/* Search Bar */}
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
            <input
              type="text"
              placeholder="Search symbol, name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-white border border-[#E5E7EB] rounded-sm text-xs text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>
        </div>
      </div>

      {/* 1. Mobile Holdings List (< sm: iPhone Pro Max ~430px) */}
      <div className="sm:hidden space-y-2">
        {processedPositions.length > 0 ? (
          <div className="divide-y divide-[#F3F4F6] bg-white rounded-sm border border-[#E5E7EB]/60">
            {processedPositions.map((pos) => {
              const isProfit = pos.unrealizedProfitEur >= 0;
              const isUs = pos.currency === 'USD' || pos.symbol.endsWith('.US');
              const ticker = pos.displaySymbol || pos.symbol.replace(/\.(US|DE|UK|PA|AS|MC|L)$/i, '');

              return (
                <div
                  key={pos.id}
                  onClick={() => setSelectedPosition(pos)}
                  className="p-4 active:bg-gray-50/80 transition-colors cursor-pointer"
                >
                  {/* Line 1: Logo/Ticker + Name (Left) | Market Value EUR (Right) */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Avatar / Ticker Badge */}
                      <div className="w-10 h-10 rounded-sm bg-[#F3F4F6] text-[#111827] flex items-center justify-center font-bold text-xs shrink-0 tracking-tight">
                        {ticker.slice(0, 4)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-sm text-[#111827] tracking-tight">
                            {ticker}
                          </span>
                          <span className="text-[10px] uppercase font-mono text-[#9CA3AF]">
                            {pos.symbol}
                          </span>
                        </div>
                        <p className="text-xs text-[#6B7280] truncate max-w-[190px]">
                          {pos.name || pos.symbol}
                        </p>
                      </div>
                    </div>

                    {/* Market Value in EUR (Bold & Big) */}
                    <div className="text-right shrink-0">
                      <div className="text-base font-bold text-[#111827] tabular-nums tracking-tight">
                        {formatEur(pos.marketValueEur)}
                      </div>
                      <div className="text-[11px] text-[#9CA3AF] tabular-nums">
                        {pos.currentPrice > 0 ? (
                          <>
                            {formatEur(pos.currentPriceEur)}
                            {pos.currency !== 'EUR' && (
                              <span className="ml-1">({pos.currentPrice.toFixed(2)} {pos.currency})</span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Line 2: Qty + Avg Buy (Left) | P&L % and EUR with ▲▼ (Right) */}
                  <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-[#F3F4F6]/80 text-xs">
                    <div className="text-[#6B7280] text-[11px] flex items-center gap-1.5 tabular-nums">
                      <span>{pos.quantity} shares</span>
                      <span>•</span>
                      <span>Avg {formatEur(pos.openPriceEur)}</span>
                      <span className="ml-1">{renderSourceBadge(pos.priceSource)}</span>
                    </div>

                    <div className={`text-right font-medium tabular-nums flex items-center gap-1 ${isProfit ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                      <span>{isProfit ? '▲' : '▼'}</span>
                      <span>{isProfit ? '+' : ''}{formatEur(pos.unrealizedProfitEur)}</span>
                      <span className="text-[11px] font-normal">
                        ({isProfit ? '+' : ''}{pos.unrealizedProfitPct.toFixed(2)}%)
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white border border-[#E5E7EB] rounded-sm p-8 text-center text-[#6B7280]">
            <p className="text-sm font-medium text-[#111827]">
              {positions.length === 0 ? 'No holdings in portfolio' : 'No holdings found'}
            </p>
            <p className="text-xs text-[#9CA3AF] mt-1">
              {positions.length === 0
                ? 'Add your holdings manually or import an XTB report.'
                : 'Try clearing your search query.'}
            </p>
          </div>
        )}
      </div>

      {/* 2. Desktop Table Container (>= sm) */}
      <div className="hidden sm:block bg-white border border-[#E5E7EB] rounded-sm shadow-xs overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-250px)]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#F9FAFB] text-[#6B7280] uppercase tracking-wider font-semibold text-[11px] border-b border-[#E5E7EB] sticky top-0 z-10">
              <tr>
                <th 
                  onClick={() => handleSort('symbol')}
                  className="px-4 py-3 cursor-pointer hover:text-[#111827] select-none whitespace-nowrap"
                >
                  <div className="flex items-center gap-1">
                    <span>Symbol</span>
                    <ArrowUpDown className="w-3 h-3 text-[#9CA3AF]" />
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('name')}
                  className="px-4 py-3 cursor-pointer hover:text-[#111827] select-none whitespace-nowrap hidden sm:table-cell"
                >
                  <div className="flex items-center gap-1">
                    <span>Name</span>
                    <ArrowUpDown className="w-3 h-3 text-[#9CA3AF]" />
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('quantity')}
                  className="px-4 py-3 text-right cursor-pointer hover:text-[#111827] select-none whitespace-nowrap"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Qty</span>
                    <ArrowUpDown className="w-3 h-3 text-[#9CA3AF]" />
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('openPriceEur')}
                  className="px-4 py-3 text-right cursor-pointer hover:text-[#111827] select-none whitespace-nowrap hidden md:table-cell"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Avg Buy</span>
                    <ArrowUpDown className="w-3 h-3 text-[#9CA3AF]" />
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('currentPriceEur')}
                  className="px-4 py-3 text-right cursor-pointer hover:text-[#111827] select-none whitespace-nowrap"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Price</span>
                    <ArrowUpDown className="w-3 h-3 text-[#9CA3AF]" />
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('marketValueEur')}
                  className="px-4 py-3 text-right cursor-pointer hover:text-[#111827] select-none whitespace-nowrap"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Value</span>
                    <ArrowUpDown className="w-3 h-3 text-[#9CA3AF]" />
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('unrealizedProfitEur')}
                  className="px-4 py-3 text-right cursor-pointer hover:text-[#111827] select-none whitespace-nowrap"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>P&amp;L (€ / %)</span>
                    <ArrowUpDown className="w-3 h-3 text-[#9CA3AF]" />
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('weight')}
                  className="px-4 py-3 text-right cursor-pointer hover:text-[#111827] select-none whitespace-nowrap hidden lg:table-cell"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Weight</span>
                    <ArrowUpDown className="w-3 h-3 text-[#9CA3AF]" />
                  </div>
                </th>
                <th className="px-3 py-3 text-center whitespace-nowrap">
                  <span>Src</span>
                </th>
                <th className="px-3 py-3 text-center whitespace-nowrap">
                  <span>Actions</span>
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#F3F4F6] text-[#111827] font-mono">
              {processedPositions.length > 0 ? (
                processedPositions.map((pos) => {
                  const weight = totalPortfolioValueEur > 0 
                    ? (pos.marketValueEur / totalPortfolioValueEur) * 100 
                    : 0;
                  const isProfit = pos.unrealizedProfitEur >= 0;

                  return (
                    <tr
                      key={pos.id}
                      onClick={() => setSelectedPosition(pos)}
                      className="hover:bg-gray-50/70 cursor-pointer transition-colors group"
                    >
                      {/* Symbol */}
                      <td className="px-4 py-3 font-semibold text-[#111827] whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{pos.symbol}</span>
                          <span className="text-[10px] text-[#9CA3AF] font-normal uppercase hidden sm:inline">
                            {pos.assetClass}
                          </span>
                        </div>
                      </td>

                      {/* Name */}
                      <td className="px-4 py-3 font-sans text-[#6B7280] text-[11px] truncate max-w-xs hidden sm:table-cell">
                        {pos.name}
                      </td>

                      {/* Quantity */}
                      <td className="px-4 py-3 text-right whitespace-nowrap text-[#111827]">
                        {pos.quantity}
                      </td>

                      {/* Avg Buy Price (EUR) */}
                      <td className="px-4 py-3 text-right whitespace-nowrap text-[#6B7280] hidden md:table-cell">
                        <div>{formatEur(pos.openPriceEur)}</div>
                        {pos.currency !== 'EUR' && (
                          <div className="text-[10px] text-[#9CA3AF] font-sans">
                            {pos.openPrice.toFixed(2)} {pos.currency}
                          </div>
                        )}
                      </td>

                      {/* Current Price (EUR) */}
                      <td className="px-4 py-3 text-right whitespace-nowrap font-medium text-[#111827]">
                        {pos.currentPrice > 0 ? (
                          <>
                            <div>{formatEur(pos.currentPriceEur)}</div>
                            {pos.currency !== 'EUR' && (
                              <div className="text-[10px] text-[#9CA3AF] font-sans">
                                {pos.currentPrice.toFixed(2)} {pos.currency}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-[#9CA3AF] text-xs font-sans">Unavailable</span>
                        )}
                      </td>

                      {/* Market Value (EUR) */}
                      <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-[#111827]">
                        {formatEur(pos.marketValueEur)}
                      </td>

                      {/* P&L (€ and %) */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className={isProfit ? 'text-[#10B981]' : 'text-[#EF4444]'}>
                          {isProfit ? '+' : ''}
                          {formatEur(pos.unrealizedProfitEur)}
                        </div>
                        <div className={`text-[10px] ${isProfit ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                          {isProfit ? '+' : ''}
                          {pos.unrealizedProfitPct.toFixed(2)}%
                        </div>
                      </td>

                      {/* Portfolio Weight */}
                      <td className="px-4 py-3 text-right whitespace-nowrap text-[#6B7280] hidden lg:table-cell">
                        {weight.toFixed(1)}%
                      </td>

                      {/* Data Source Indicator */}
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {renderSourceBadge(pos.priceSource)}
                      </td>

                      {/* Actions: Edit & Delete (minimum 44x44px touch areas) */}
                      <td 
                        className="px-3 py-3 text-center whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPositionBeingEdited(pos);
                              setIsAddModalOpen(true);
                            }}
                            className="w-8 h-8 flex items-center justify-center text-[#6B7280] hover:text-[#2563EB] hover:bg-blue-50 rounded-sm transition-colors cursor-pointer"
                            title={`Edit ${pos.symbol}`}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPositionToDelete(pos);
                            }}
                            className="w-8 h-8 flex items-center justify-center text-[#6B7280] hover:text-red-600 hover:bg-red-50 rounded-sm transition-colors cursor-pointer"
                            title={`Delete ${pos.symbol}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center text-[#6B7280] font-sans">
                    <div className="max-w-sm mx-auto space-y-3">
                      <p className="text-sm font-medium text-[#111827]">
                        {positions.length === 0 
                          ? 'No holdings currently in portfolio' 
                          : 'No holdings match your search query'}
                      </p>
                      <p className="text-xs text-[#9CA3AF]">
                        {positions.length === 0
                          ? 'Add your holdings manually using the button below or import an existing XTB report.'
                          : 'Try clearing your search query to see all your active positions.'}
                      </p>
                      {positions.length === 0 && (
                        <div className="flex items-center justify-center gap-2 pt-2">
                          <button
                            onClick={() => {
                              setPositionBeingEdited(null);
                              setIsAddModalOpen(true);
                            }}
                            className="px-3.5 py-1.5 bg-[#2563EB] hover:bg-blue-700 text-white rounded-sm font-semibold text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add First Position</span>
                          </button>
                          {onOpenImport && (
                            <button
                              onClick={onOpenImport}
                              className="px-3.5 py-1.5 bg-white border border-[#E5E7EB] hover:bg-gray-50 text-[#111827] rounded-sm font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5 text-[#6B7280]" />
                              <span>Import XTB</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Holding Detail Modal */}
      {selectedPosition && (
        <HoldingDetailModal
          position={selectedPosition}
          onClose={() => setSelectedPosition(null)}
          onEdit={(pos) => {
            setPositionBeingEdited(pos);
            setIsAddModalOpen(true);
          }}
          onDelete={(pos) => {
            setPositionToDelete(pos);
          }}
        />
      )}

      {/* Manual Position Add / Edit Modal */}
      <ManualPositionModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setPositionBeingEdited(null);
        }}
        onSaveAdd={async (input) => {
          if (onAddOrMergePosition) {
            await onAddOrMergePosition(input);
          }
        }}
        onSaveEdit={async (input) => {
          if (onEditPosition) {
            await onEditPosition(input);
          }
        }}
        existingPositions={positions}
        positionToEdit={positionBeingEdited}
      />

      {/* Delete Position Lightweight Confirmation Dialog */}
      <DeletePositionDialog
        isOpen={Boolean(positionToDelete)}
        position={positionToDelete}
        onClose={() => setPositionToDelete(null)}
        onConfirmDelete={async (id) => {
          if (onDeletePosition) {
            await onDeletePosition(id);
          }
        }}
      />

    </div>
  );
};
