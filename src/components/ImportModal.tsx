import React, { useState, useRef } from 'react';
import { 
  ColumnMapping, 
  RawParsedRow, 
  Position,
  PositionLot 
} from '../types';
import { 
  parseXtbFile, 
  evaluateRowsWithMapping 
} from '../lib/xtbParser';
import { aggregatePositionFromLots } from '../lib/lots';
import { getForexRates, convertToEur, inferCurrencyFromSymbol } from '../lib/marketApi';
import { 
  X, 
  UploadCloud, 
  FileSpreadsheet, 
  AlertTriangle, 
  CheckCircle2, 
  HelpCircle,
  FileText,
  Sparkles,
  ArrowRight,
  Loader2
} from 'lucide-react';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmImport: (
    positions: Position[],
    mode: 'replace' | 'merge',
    onProgress?: (current: number, total: number) => void,
    onStatusChange?: (status: 'fetching_prices' | 'saving_firestore') => void
  ) => Promise<void>;
  existingPositionsCount: number;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onConfirmImport,
  existingPositionsCount,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<any[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    symbolCol: '',
    quantityCol: '',
    openPriceCol: '',
    openTimeCol: '',
  });
  const [parsedRows, setParsedRows] = useState<RawParsedRow[]>([]);
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const [importStage, setImportStage] = useState<'idle' | 'fetching_prices' | 'saving_firestore' | 'success'>('idle');
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [isGetquin, setIsGetquin] = useState<boolean>(false);
  const [getquinPositions, setGetquinPositions] = useState<Position[] | null>(null);
  const [selectedSheetName, setSelectedSheetName] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFile = async (f: File) => {
    setErrorMsg(null);
    setFile(f);
    setFileName(f.name);

    try {
      const buffer = await f.arrayBuffer();
      const parsed = parseXtbFile(buffer);
      setHeaders(parsed.headers);
      setRawRows(parsed.rawRows);
      setMapping(parsed.inferredMapping);
      setIsGetquin(!!parsed.isGetquin);
      setSelectedSheetName(parsed.selectedSheetName || '');

      if (parsed.isGetquin && parsed.getquinParsedRows && parsed.getquinPositions) {
        setParsedRows(parsed.getquinParsedRows);
        setGetquinPositions(parsed.getquinPositions);
      } else {
        setGetquinPositions(null);
        const evaluated = evaluateRowsWithMapping(
          parsed.rawRows,
          parsed.headers,
          parsed.inferredMapping
        );
        setParsedRows(evaluated);
      }
    } catch (err: any) {
      console.error('File parsing error:', err);
      setErrorMsg(err?.message || 'Failed to read file. Please ensure it is a valid .csv or .xlsx export.');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  // Re-evaluate when user alters a mapping dropdown
  const handleMappingChange = (field: keyof ColumnMapping, value: string) => {
    const updated = { ...mapping, [field]: value };
    setMapping(updated);
    if (rawRows.length > 0 && headers.length > 0) {
      const evaluated = evaluateRowsWithMapping(rawRows, headers, updated);
      setParsedRows(evaluated);
    }
  };

  // Toggle skip on a row
  const toggleRowSkip = (rowIndex: number) => {
    setParsedRows((prev) =>
      prev.map((r) => (r.rowIndex === rowIndex ? { ...r, skip: !r.skip } : r))
    );
  };

  // Sample XTB data loader for quick validation
  const loadSampleXtbData = () => {
    const sampleCsv = `Position;Symbol;Type;Volume;Open time;Open price;Current price;Profit;Net P/L
1001;VWCE.DE;Buy;25.0;15.01.2024 10:20:00;104,50;121,80;432,50;432,50
1002;AAPL.US;Buy;12.0;20.02.2024 15:45:00;182,30;228,50;554,40;554,40
1003;MSFT.US;Buy;8.0;10.03.2024 16:10:00;402,00;448,20;369,60;369,60
1004;QDVE.DE;Buy;30.0;05.04.2024 11:00:00;22,40;27,10;141,00;141,00
1005;CSPX.UK;Buy;15.0;18.05.2024 09:30:00;485,00;540,20;828,00;828,00
1006;NVDA.US;Buy;10.0;01.06.2024 16:30:00;115,00;128,40;134,00;134,00
`;
    const blob = new Blob([sampleCsv], { type: 'text/csv' });
    const sampleFile = new File([blob], 'XTB_Open_Positions_Sample.csv', { type: 'text/csv' });
    handleFile(sampleFile);
  };

  const handleConfirm = async () => {
    const validRows = parsedRows.filter((r) => r.isValid && !r.skip);
    if (validRows.length === 0) {
      setErrorMsg('No valid rows selected for import.');
      return;
    }

    setImportStage('fetching_prices');
    setImportProgress({ current: 0, total: validRows.length });
    setErrorMsg(null);

    try {
      let positionsToSave: Position[];

      if (isGetquin && getquinPositions && getquinPositions.length > 0) {
        // Match user's skip toggles on parsedRows with getquinPositions
        const skippedIndices = new Set(
          parsedRows.filter((r) => r.skip || !r.isValid).map((r) => r.rowIndex)
        );
        positionsToSave = getquinPositions.filter((_, idx) => !skippedIndices.has(idx));
      } else {
        const rates = await getForexRates();
        const rowsBySymbol = new Map<string, typeof validRows>();
        for (const r of validRows) {
          const sym = r.symbol.trim().toUpperCase();
          if (!rowsBySymbol.has(sym)) {
            rowsBySymbol.set(sym, []);
          }
          rowsBySymbol.get(sym)!.push(r);
        }

        positionsToSave = Array.from(rowsBySymbol.entries()).map(([sym, rows], symIdx) => {
          const firstRow = rows[0];
          const isUs = sym.endsWith('.US') || (!sym.includes('.') && firstRow.currency === 'USD');
          const curr = firstRow.currency || inferCurrencyFromSymbol(sym);

          const lots: PositionLot[] = rows.map((r, lotIdx) => {
            const openPrice = r.openPrice;
            const priceEur = convertToEur(openPrice, curr, rates);
            return {
              id: `lot-xtb-${sym}-${Date.now()}-${lotIdx}`,
              type: 'buy',
              quantity: r.quantity,
              price: openPrice,
              priceEur,
              currency: curr,
              date: r.openTime || new Date().toISOString(),
              valueEur: Number((r.quantity * priceEur).toFixed(4)),
              source: 'xtb',
            };
          });

          const currentPrice = firstRow.currentPrice || firstRow.openPrice;
          const currentPriceEur = convertToEur(currentPrice, curr, rates);

          const aggregated = aggregatePositionFromLots(lots, currentPriceEur, currentPrice, 'xtb');

          const isEtf =
            sym.startsWith('VWCE') ||
            sym.startsWith('CSPX') ||
            sym.startsWith('QDVE') ||
            sym.startsWith('VUSA');

          return {
            id: `pos-${sym}-${Date.now()}-${symIdx}`,
            symbol: sym,
            displaySymbol: sym.replace(/\.US$/, ''),
            name: firstRow.name || sym,
            quantity: aggregated.quantity,
            openPrice: aggregated.openPrice,
            currency: curr,
            openTime: aggregated.openTime,
            lots: aggregated.lots,
            openPriceEur: aggregated.openPriceEur,
            currentPrice: aggregated.currentPrice,
            currentPriceEur: aggregated.currentPriceEur,
            marketValueEur: aggregated.marketValueEur,
            costBasisEur: aggregated.costBasisEur,
            unrealizedProfitEur: aggregated.unrealizedProfitEur,
            unrealizedProfitPct: aggregated.unrealizedProfitPct,
            priceSource: 'xtb',
            classificationSource: 'none',
            assetClass: isEtf ? 'etf' : 'stock',
            sector: isEtf ? 'Index / Fund' : 'General',
            country: isUs ? 'United States' : (sym.includes('.DE') ? 'Germany' : 'Global'),
          };
        });
      }

      await onConfirmImport(
        positionsToSave, 
        importMode,
        (current, total) => {
          setImportProgress({ current, total });
        },
        (stage) => {
          setImportStage(stage);
        }
      );

      setImportStage('success');
      setTimeout(() => {
        setImportStage('idle');
        onClose();
      }, 1500);
    } catch (err: any) {
      setImportStage('idle');
      setErrorMsg(err?.message || 'Falha ao guardar posições importadas. Por favor, tente novamente.');
    }
  };

  const validCount = parsedRows.filter((r) => r.isValid && !r.skip).length;
  const invalidCount = parsedRows.filter((r) => !r.isValid).length;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto"
      onClick={() => {
        if (importStage === 'idle') onClose();
      }}
    >
      <div 
        className="relative w-full max-w-3xl bg-white rounded-sm shadow-xl border border-[#E5E7EB] overflow-hidden my-8 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between shrink-0 bg-white">
          <div>
            <h2 className="text-base font-semibold text-[#111827]">
              Import XTB Open Positions
            </h2>
            <p className="text-xs text-[#6B7280] mt-0.5">
              SheetJS parses both .xlsx and .csv exports from xStation 5 with column auto-matching
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={importStage !== 'idle'}
            className="p-1.5 text-[#9CA3AF] hover:text-[#111827] hover:bg-gray-100 rounded-sm transition-colors cursor-pointer disabled:opacity-25 disabled:pointer-events-none"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {importStage !== 'idle' && (
            <div className={`p-4 rounded-sm border transition-all ${
              importStage === 'success' 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                : 'bg-blue-50 border-blue-200 text-blue-900'
            }`}>
              <div className="flex items-center gap-3">
                {importStage === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                ) : (
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
                )}
                <div className="flex-1">
                  <div className="text-xs font-semibold">
                    {importStage === 'fetching_prices' && `A obter cotações de mercado (${importProgress?.current || 0}/${importProgress?.total || validCount})...`}
                    {importStage === 'saving_firestore' && 'A persistir e sincronizar posições...'}
                    {importStage === 'success' && 'Importação concluída com sucesso!'}
                  </div>
                  <div className="text-[11px] opacity-80 mt-0.5">
                    {importStage === 'fetching_prices' && 'A atualizar preços reais via Yahoo Finance / Finnhub'}
                    {importStage === 'saving_firestore' && 'A guardar registos e a consolidar no seu portfólio'}
                    {importStage === 'success' && 'A fechar e a carregar métricas atualizadas da carteira...'}
                  </div>
                </div>
              </div>
              
              {/* Progress Bar */}
              {importStage !== 'success' && (
                <div className="w-full bg-blue-200/60 rounded-full h-1.5 mt-3 overflow-hidden">
                  <div 
                    className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                    style={{
                      width: importStage === 'saving_firestore'
                        ? '92%'
                        : `${Math.min(90, Math.max(10, ((importProgress?.current || 0) / (importProgress?.total || validCount || 1)) * 100))}%`
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-sm text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Upload Area (Safari iOS/macOS optimized) */}
          {!rawRows.length ? (
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-sm p-8 sm:p-12 text-center cursor-pointer transition-colors ${
                  dragActive
                    ? 'border-[#2563EB] bg-blue-50/20'
                    : 'border-[#E5E7EB] hover:border-[#2563EB] bg-[#F9FAFB]'
                }`}
              >
                {/* Safari-compatible input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  id="xtb-file-input"
                  accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="w-12 h-12 rounded-sm bg-white shadow-xs border border-[#E5E7EB] flex items-center justify-center mx-auto text-[#2563EB] mb-3">
                  <FileSpreadsheet className="w-6 h-6 text-[#2563EB]" />
                </div>
                <p className="text-sm font-semibold text-[#111827]">
                  Select your XTB Open Positions file
                </p>
                <p className="text-xs text-[#6B7280] mt-1 max-w-sm mx-auto">
                  Drag &amp; drop or tap to browse your device (.xlsx or .csv from xStation 5)
                </p>
                <span className="inline-block mt-4 px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-sm text-xs font-medium text-[#111827] shadow-2xs hover:bg-gray-50">
                  Choose File
                </span>
              </div>

              {/* Sample test button */}
              <div className="text-center pt-2">
                <button
                  onClick={loadSampleXtbData}
                  className="inline-flex items-center space-x-1.5 text-xs text-[#6B7280] hover:text-[#2563EB] font-medium py-1 px-3 rounded-sm hover:bg-gray-100 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#2563EB]" />
                  <span>Or test with a sample XTB Open Positions file</span>
                </button>
              </div>
            </div>
          ) : (
            /* Preview & Mapping Screen */
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-[#F9FAFB] rounded-sm border border-[#E5E7EB]">
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-[#2563EB]" />
                  <span className="text-xs font-semibold text-[#111827] truncate">
                    {fileName || 'XTB Export File'}
                  </span>
                  <span className="text-[11px] text-[#6B7280]">
                    ({parsedRows.length} rows parsed)
                  </span>
                </div>
                <button
                  onClick={() => {
                    setFile(null);
                    setRawRows([]);
                    setParsedRows([]);
                  }}
                  className="text-xs text-[#2563EB] hover:underline self-start sm:self-auto cursor-pointer"
                >
                  Upload different file
                </button>
              </div>

              {/* Getquin Detection Badge */}
              {isGetquin && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-sm text-xs text-blue-800 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-blue-900">
                      Exportação Getquin detetada (Folha: {selectedSheetName || 'Open Positions'})
                    </p>
                    <p className="text-blue-700 mt-0.5">
                      As posições abertas foram identificadas e agrupadas a partir das linhas-resumo, calculando automaticamente preço médio, custo total e data da primeira ordem a partir das transações individuais.
                    </p>
                  </div>
                </div>
              )}

              {/* Column Mapping Selectors */}
              <div>
                <h3 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span>Detected Column Mapping</span>
                  <span className="text-[10px] text-[#9CA3AF] lowercase font-normal">
                    (review or correct)
                  </span>
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-3.5 rounded-sm border border-[#E5E7EB] text-xs">
                  <div>
                    <label className="block text-[#6B7280] mb-1 font-medium">Symbol *</label>
                    <select
                      value={mapping.symbolCol}
                      onChange={(e) => handleMappingChange('symbolCol', e.target.value)}
                      className="w-full p-1.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-sm text-xs text-[#111827] font-mono focus:border-[#2563EB] focus:outline-none"
                    >
                      <option value="">-- Select --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[#6B7280] mb-1 font-medium">Quantity / Vol *</label>
                    <select
                      value={mapping.quantityCol}
                      onChange={(e) => handleMappingChange('quantityCol', e.target.value)}
                      className="w-full p-1.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-sm text-xs text-[#111827] font-mono focus:border-[#2563EB] focus:outline-none"
                    >
                      <option value="">-- Select --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[#6B7280] mb-1 font-medium">Open / Buy Price *</label>
                    <select
                      value={mapping.openPriceCol}
                      onChange={(e) => handleMappingChange('openPriceCol', e.target.value)}
                      className="w-full p-1.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-sm text-xs text-[#111827] font-mono focus:border-[#2563EB] focus:outline-none"
                    >
                      <option value="">-- Select --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[#6B7280] mb-1 font-medium">Open Time / Date *</label>
                    <select
                      value={mapping.openTimeCol}
                      onChange={(e) => handleMappingChange('openTimeCol', e.target.value)}
                      className="w-full p-1.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-sm text-xs text-[#111827] font-mono focus:border-[#2563EB] focus:outline-none"
                    >
                      <option value="">-- Select --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Rows Table Preview */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
                    Rows Preview &amp; Validation
                  </h3>
                  <div className="text-xs space-x-2">
                    <span className="text-[#10B981] font-medium">
                      ✓ {validCount} valid
                    </span>
                    {invalidCount > 0 && (
                      <span className="text-[#EF4444] font-medium">
                        ⚠ {invalidCount} flagged
                      </span>
                    )}
                  </div>
                </div>

                <div className="border border-[#E5E7EB] rounded-sm overflow-hidden max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse font-mono">
                    <thead className="bg-[#F9FAFB] text-[#6B7280] font-semibold text-[10.5px] border-b border-[#E5E7EB] sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-center w-10">Import</th>
                        <th className="px-3 py-2">Symbol</th>
                        <th className="px-3 py-2 text-right">Quantity</th>
                        <th className="px-3 py-2 text-right">Open Price</th>
                        <th className="px-3 py-2">Open Time</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {parsedRows.map((row) => (
                        <tr
                          key={row.rowIndex}
                          className={`hover:bg-[#F9FAFB] ${
                            !row.isValid ? 'bg-red-50/40' : row.skip ? 'opacity-40' : ''
                          }`}
                        >
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={!row.skip}
                              onChange={() => toggleRowSkip(row.rowIndex)}
                              className="rounded-sm border-[#E5E7EB] text-[#2563EB] focus:ring-[#2563EB]"
                            />
                          </td>
                          <td className="px-3 py-2 font-semibold text-[#111827]">
                            {row.symbol || '—'}
                          </td>
                          <td className="px-3 py-2 text-right">{row.quantity}</td>
                          <td className="px-3 py-2 text-right">{row.openPrice.toFixed(2)}</td>
                          <td className="px-3 py-2 text-[#6B7280]">
                            {row.openTime.split('T')[0]}
                          </td>
                          <td className="px-3 py-2 font-sans">
                            {row.isValid ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-[#10B981]">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Valid
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] text-[#EF4444]">
                                <AlertTriangle className="w-3.5 h-3.5" /> {row.warning}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Merge vs Replace Options (if existing data) */}
              {existingPositionsCount > 0 && (
                <div className="p-4 bg-[#F9FAFB] rounded-sm border border-[#E5E7EB] text-xs">
                  <span className="font-semibold text-[#111827] block mb-2">
                    Import Mode (You currently have {existingPositionsCount} position{existingPositionsCount === 1 ? '' : 's'} in Firestore)
                  </span>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="radio"
                        name="importMode"
                        value="replace"
                        checked={importMode === 'replace'}
                        onChange={() => setImportMode('replace')}
                        className="text-[#2563EB] focus:ring-[#2563EB]"
                      />
                      <span><strong>Replace all:</strong> overwrite existing cloud portfolio</span>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="radio"
                        name="importMode"
                        value="merge"
                        checked={importMode === 'merge'}
                        onChange={() => setImportMode('merge')}
                        className="text-[#2563EB] focus:ring-[#2563EB]"
                      />
                      <span><strong>Merge:</strong> combine with existing positions</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-[#F9FAFB] border-t border-[#E5E7EB] flex items-center justify-between shrink-0 text-xs">
          <button
            onClick={onClose}
            disabled={importStage !== 'idle'}
            className="px-4 py-2 bg-white border border-[#E5E7EB] text-[#111827] font-medium rounded-sm hover:bg-gray-50 disabled:opacity-50 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          {rawRows.length > 0 && (
            <button
              onClick={handleConfirm}
              disabled={importStage !== 'idle' || validCount === 0}
              className="inline-flex items-center space-x-2 px-5 py-2 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-sm transition-colors shadow-xs cursor-pointer"
            >
              {importStage === 'fetching_prices' && (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                  <span>
                    A obter cotações de mercado ({importProgress?.current || 0}/{importProgress?.total || validCount})...
                  </span>
                </>
              )}
              {importStage === 'saving_firestore' && (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                  <span>A guardar no Firestore...</span>
                </>
              )}
              {importStage === 'success' && (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                  <span>Concluído com Sucesso!</span>
                </>
              )}
              {importStage === 'idle' && (
                <>
                  <span>Confirm Import ({validCount} Positions)</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
