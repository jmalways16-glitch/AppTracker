import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Position, SymbolSearchResult } from '../types';
import { 
  COMMON_CURRENCIES, 
  findExistingPosition, 
  ManualPositionInput, 
  EditPositionInput 
} from '../lib/positionManager';
import { searchSymbols } from '../lib/marketApi';
import { X, AlertCircle, RefreshCw, Layers, Search, CheckCircle2, Loader2, Trash2 } from 'lucide-react';

interface ManualPositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveAdd: (input: ManualPositionInput) => Promise<void>;
  onSaveEdit: (input: EditPositionInput) => Promise<void>;
  existingPositions: Position[];
  positionToEdit?: Position | null;
}

export const ManualPositionModal: React.FC<ManualPositionModalProps> = ({
  isOpen,
  onClose,
  onSaveAdd,
  onSaveEdit,
  existingPositions,
  positionToEdit,
}) => {
  const isEditMode = Boolean(positionToEdit);

  const [symbol, setSymbol] = useState('');
  const [quantity, setQuantity] = useState<string>('');
  const [purchasePrice, setPurchasePrice] = useState<string>('');
  const [purchaseCurrency, setPurchaseCurrency] = useState<string>('EUR');
  const [purchaseDate, setPurchaseDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [customCurrency, setCustomCurrency] = useState('');
  const [showCustomCurrency, setShowCustomCurrency] = useState(false);
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Autocomplete state
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [matchedCompanyName, setMatchedCompanyName] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Debounced autocomplete search
  useEffect(() => {
    if (isEditMode) return;
    const clean = symbol.trim();
    if (clean.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      setShowDropdown(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchSymbols(clean);
        setSearchResults(results);
        setShowDropdown(true);
      } catch (e) {
        console.error('Search symbols failed:', e);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [symbol, isEditMode]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Initialize form when opened or when positionToEdit changes
  useEffect(() => {
    if (!isOpen) return;

    if (positionToEdit) {
      setSymbol(positionToEdit.symbol);
      const lots = positionToEdit.lots || [];
      const targetLot = lots.length > 0 ? lots[lots.length - 1] : null;
      setSelectedLotId(targetLot ? targetLot.id : null);

      const qty = targetLot ? targetLot.quantity : positionToEdit.quantity;
      const price = targetLot ? targetLot.price : positionToEdit.openPrice;
      const curr = (targetLot ? targetLot.currency : positionToEdit.currency || 'EUR').toUpperCase();
      const dateStr = targetLot?.date 
        ? targetLot.date.split('T')[0] 
        : (positionToEdit.openTime ? positionToEdit.openTime.split('T')[0] : new Date().toISOString().split('T')[0]);

      setQuantity(String(qty));
      setPurchasePrice(String(price));
      
      const isCommon = COMMON_CURRENCIES.some((c) => c.code === curr);
      if (isCommon) {
        setPurchaseCurrency(curr);
        setShowCustomCurrency(false);
      } else {
        setPurchaseCurrency('OTHER');
        setCustomCurrency(curr);
        setShowCustomCurrency(true);
      }

      setPurchaseDate(dateStr);
      setMatchedCompanyName(null);
      setShowDropdown(false);
    } else {
      // Add mode defaults
      setSymbol('');
      setQuantity('');
      setPurchasePrice('');
      setPurchaseCurrency('EUR');
      setShowCustomCurrency(false);
      setCustomCurrency('');
      setSelectedLotId(null);
      setPurchaseDate(new Date().toISOString().split('T')[0]);
      setSearchResults([]);
      setShowDropdown(false);
      setMatchedCompanyName(null);
    }
    setError(null);
  }, [isOpen, positionToEdit]);

  const selectLot = (lotId: string) => {
    if (!positionToEdit || !positionToEdit.lots) return;
    const lot = positionToEdit.lots.find((l) => l.id === lotId);
    if (!lot) return;
    setSelectedLotId(lotId);
    setQuantity(String(lot.quantity));
    setPurchasePrice(String(lot.price));
    const curr = (lot.currency || 'EUR').toUpperCase();
    const isCommon = COMMON_CURRENCIES.some((c) => c.code === curr);
    if (isCommon) {
      setPurchaseCurrency(curr);
      setShowCustomCurrency(false);
    } else {
      setPurchaseCurrency('OTHER');
      setCustomCurrency(curr);
      setShowCustomCurrency(true);
    }
    setPurchaseDate(lot.date ? lot.date.split('T')[0] : new Date().toISOString().split('T')[0]);
  };

  const handleDeleteLot = async (lotId: string) => {
    if (!positionToEdit) return;
    if (!window.confirm('Tem a certeza que deseja remover este lote de transação?')) return;
    setIsSubmitting(true);
    try {
      await onSaveEdit({
        id: positionToEdit.id,
        lotId,
        action: 'delete_lot',
        quantity: 0,
        purchasePrice: 0,
        purchaseCurrency: 'EUR',
        purchaseDate: '',
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to remove lot');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if entered symbol already exists in portfolio (in Add mode)
  const existingMatch = useMemo(() => {
    if (isEditMode || !symbol.trim()) return null;
    return findExistingPosition(existingPositions, symbol);
  }, [isEditMode, symbol, existingPositions]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol) {
      setError('Please enter a symbol or ticker.');
      return;
    }

    const numQty = parseFloat(quantity);
    if (isNaN(numQty) || numQty <= 0) {
      setError('Please enter a valid quantity greater than 0.');
      return;
    }

    const numPrice = parseFloat(purchasePrice);
    if (isNaN(numPrice) || numPrice < 0) {
      setError('Please enter a valid non-negative purchase price.');
      return;
    }

    const finalCurrency = (showCustomCurrency && customCurrency.trim() 
      ? customCurrency.trim() 
      : purchaseCurrency
    ).toUpperCase();

    if (!finalCurrency) {
      setError('Please select or specify a purchase currency.');
      return;
    }

    if (!purchaseDate) {
      setError('Please select a purchase date.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditMode && positionToEdit) {
        await onSaveEdit({
          id: positionToEdit.id,
          lotId: selectedLotId || undefined,
          quantity: numQty,
          purchasePrice: numPrice,
          purchaseCurrency: finalCurrency,
          purchaseDate,
        });
      } else {
        await onSaveAdd({
          symbol: cleanSymbol,
          quantity: numQty,
          purchasePrice: numPrice,
          purchaseCurrency: finalCurrency,
          purchaseDate,
        });
      }
      onClose();
    } catch (err: any) {
      console.error('Save position error:', err);
      setError(err?.message || 'Failed to save position to Firestore. Please retry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div 
        className="relative w-full max-w-lg bg-white rounded-sm shadow-xl border border-[#E5E7EB] my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between bg-[#F9FAFB]/70 rounded-t-sm">
          <div>
            <h2 className="text-base font-semibold text-[#111827]">
              {isEditMode ? `Edit Position: ${positionToEdit?.symbol}` : 'Add Position'}
            </h2>
            <p className="text-xs text-[#6B7280] mt-0.5">
              {isEditMode 
                ? 'Update your holding details. Changes sync directly to Firestore.'
                : 'Enter holding details. Existing symbols will merge automatically.'}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-[#9CA3AF] hover:text-[#111827] rounded-sm hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-sm text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          {/* Symbol / Ticker with Live Autocomplete */}
          <div className="relative" ref={dropdownRef}>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                Symbol / Ticker
              </label>
              {matchedCompanyName && !isEditMode && (
                <span className="text-[11px] text-[#2563EB] font-medium truncate max-w-[240px] flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-[#2563EB] shrink-0" />
                  <span className="truncate">{matchedCompanyName}</span>
                </span>
              )}
            </div>

            <div className="relative">
              <input
                type="text"
                required
                disabled={isEditMode || isSubmitting}
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value.toUpperCase());
                  setMatchedCompanyName(null);
                }}
                onFocus={() => {
                  if (searchResults.length > 0 && symbol.trim().length >= 2) {
                    setShowDropdown(true);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setShowDropdown(false);
                  }
                }}
                placeholder="e.g. AAPL, VWCE.DE, MSFT, CSPX.L"
                className={`w-full px-3 py-2 pr-9 text-sm font-mono bg-white border border-[#E5E7EB] rounded-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] ${
                  isEditMode ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''
                }`}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center pointer-events-none">
                {isSearching ? (
                  <Loader2 className="w-4 h-4 text-[#2563EB] animate-spin" />
                ) : (
                  <Search className="w-4 h-4 text-[#9CA3AF]" />
                )}
              </div>
            </div>

            {/* Selected company confirmation label */}
            {matchedCompanyName && !isEditMode && (
              <p className="text-[11px] text-[#2563EB] mt-1 font-sans">
                Matched: <span className="font-semibold text-[#111827]">{symbol}</span> — {matchedCompanyName}
              </p>
            )}

            {isEditMode && positionToEdit && (
              <p className="text-[11px] text-[#6B7280] mt-1 font-sans">
                {positionToEdit.name}
              </p>
            )}

            {/* Dropdown Menu for Autocomplete */}
            {showDropdown && !isEditMode && symbol.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#E5E7EB] rounded-sm shadow-lg z-50 max-h-56 overflow-y-auto divide-y divide-[#F3F4F6]">
                {searchResults.length > 0 ? (
                  searchResults.map((item, index) => (
                    <button
                      key={`${item.symbol}-${index}`}
                      type="button"
                      onClick={() => {
                        setSymbol(item.symbol);
                        setMatchedCompanyName(item.description);
                        setShowDropdown(false);
                      }}
                      className="w-full px-3.5 py-2.5 text-left hover:bg-blue-50/70 transition-colors flex items-center justify-between gap-3 cursor-pointer group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-[#111827] group-hover:text-[#2563EB]">
                            {item.symbol}
                          </span>
                          {item.type && (
                            <span className="text-[10px] text-[#6B7280] uppercase tracking-wider font-mono">
                              {item.type}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#4B5563] truncate mt-0.5 font-sans">
                          {item.description}
                        </p>
                      </div>

                      {/* Source badge */}
                      <div className="shrink-0">
                        {item.source === 'yahoo' ? (
                          <span className="text-[10px] font-medium text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded-xs border border-purple-200">
                            Yahoo
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium text-[#6B7280] bg-gray-50 px-1.5 py-0.5 rounded-xs border border-[#E5E7EB]">
                            Finnhub
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                ) : !isSearching ? (
                  <div className="px-3.5 py-3 text-xs text-[#6B7280] text-center">
                    No matching instruments found. You can still type the ticker and submit directly.
                  </div>
                ) : null}
              </div>
            )}

            {/* Merge notice if symbol already exists */}
            {existingMatch && (
              <div className="mt-2 p-2.5 bg-blue-50/70 border border-blue-200 rounded-sm text-xs text-blue-900 flex items-start gap-2">
                <Layers className="w-4 h-4 text-[#2563EB] shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Auto-merge detected: </span>
                  You already hold <span className="font-mono font-medium">{existingMatch.quantity} shares</span> of {existingMatch.symbol}.
                  Saving will add your new quantity as a new transaction lot and recalculate the position metrics without creating a duplicate row.
                </div>
              </div>
            )}
          </div>

          {/* Multi-lot manager if editing position with multiple lots */}
          {isEditMode && positionToEdit?.lots && positionToEdit.lots.length > 1 && (
            <div className="p-3 bg-[#F9FAFB] rounded-sm border border-[#E5E7EB] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#374151] flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#2563EB]" />
                  Lotes Desta Posição ({positionToEdit.lots.length})
                </span>
                <span className="text-[10px] text-[#6B7280]">
                  Clica num lote para editar os seus valores ou remover
                </span>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {positionToEdit.lots.map((lot) => {
                  const isSelected = selectedLotId === lot.id;
                  return (
                    <div
                      key={lot.id}
                      onClick={() => selectLot(lot.id)}
                      className={`p-2 rounded-xs border text-xs flex items-center justify-between cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-[#2563EB] bg-blue-50/60 font-medium'
                          : 'border-[#E5E7EB] bg-white hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${lot.type === 'sell' ? 'bg-[#EF4444]' : 'bg-[#10B981]'}`} />
                        <span className="font-mono text-[11px] text-[#6B7280]">
                          {lot.date ? lot.date.split('T')[0] : 'N/A'}
                        </span>
                        <span className="font-semibold text-[#111827]">
                          {lot.quantity} unid.
                        </span>
                        <span className="text-[#6B7280]">
                          @ {lot.price.toFixed(2)} {lot.currency}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isSelected && (
                          <span className="text-[10px] text-[#2563EB] font-medium bg-blue-100 px-1.5 py-0.5 rounded-xs">
                            Selecionado
                          </span>
                        )}
                        <button
                          type="button"
                          title="Remover este lote"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteLot(lot.id);
                          }}
                          className="text-[#9CA3AF] hover:text-[#EF4444] p-1 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quantity and Purchase Price Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Quantity */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
                Quantity
              </label>
              <input
                type="number"
                step="any"
                min="0.000001"
                required
                disabled={isSubmitting}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 10"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-[#E5E7EB] rounded-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
              />
            </div>

            {/* Purchase Price */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
                Purchase Price
              </label>
              <input
                type="number"
                step="any"
                min="0"
                required
                disabled={isSubmitting}
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="e.g. 150.00"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-[#E5E7EB] rounded-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
              />
            </div>
          </div>

          {/* Purchase Currency & Purchase Date Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Purchase Currency Dropdown */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
                Purchase Currency
              </label>
              <select
                disabled={isSubmitting}
                value={showCustomCurrency ? 'OTHER' : purchaseCurrency}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'OTHER') {
                    setShowCustomCurrency(true);
                  } else {
                    setShowCustomCurrency(false);
                    setPurchaseCurrency(val);
                  }
                }}
                className="w-full px-3 py-2 text-xs font-medium bg-white border border-[#E5E7EB] rounded-sm text-[#111827] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
              >
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} ({c.symbol}) — {c.name}
                  </option>
                ))}
                <option value="OTHER">Other Currency...</option>
              </select>

              {showCustomCurrency && (
                <input
                  type="text"
                  maxLength={4}
                  disabled={isSubmitting}
                  placeholder="Code (e.g. SGD)"
                  value={customCurrency}
                  onChange={(e) => setCustomCurrency(e.target.value.toUpperCase())}
                  className="w-full mt-2 px-3 py-1.5 text-xs uppercase font-mono bg-white border border-[#E5E7EB] rounded-sm text-[#111827] focus:outline-none focus:border-[#2563EB]"
                />
              )}
              <p className="text-[10px] text-[#9CA3AF] mt-1">
                Converted to EUR automatically for portfolio totals &amp; charts.
              </p>
            </div>

            {/* Purchase Date */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
                Purchase Date
              </label>
              <input
                type="date"
                required
                disabled={isSubmitting}
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-[#E5E7EB] rounded-sm text-[#111827] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
              />
              <p className="text-[10px] text-[#9CA3AF] mt-1">
                Used for performance history and XIRR/TWR cash outflows.
              </p>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-[#E5E7EB] flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-[#6B7280] hover:text-[#111827] hover:bg-gray-100 rounded-sm transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 text-xs font-semibold bg-[#2563EB] text-white hover:bg-blue-700 rounded-sm shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {isSubmitting
                  ? 'Saving to Firestore...'
                  : isEditMode
                  ? 'Save Changes'
                  : existingMatch
                  ? 'Merge into Portfolio'
                  : 'Add Position'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

