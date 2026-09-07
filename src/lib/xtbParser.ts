import * as XLSX from 'xlsx';
import { ColumnMapping, RawParsedRow, Position } from '../types';
import { parseGetquinOpenPositions, isGetquinSheet } from './getquinParser';

// Synonym matching dictionaries for XTB xStation exports
const SYNONYMS: Record<keyof ColumnMapping, string[]> = {
  symbolCol: [
    'symbol', 'instrument', 'ticker', 'security', 'asset', 'item', 'code', 'pos'
  ],
  nameCol: [
    'name', 'instrument name', 'security name', 'description', 'company'
  ],
  quantityCol: [
    'volume', 'quantity', 'qty', 'units', 'shares', 'vol', 'size', 'amount', 'lots'
  ],
  openPriceCol: [
    'open price', 'purchase price', 'buy price', 'price', 'opening price', 'avg price', 'open_price', 'entry price'
  ],
  openTimeCol: [
    'open time', 'opening time', 'open date', 'date', 'time', 'execution time', 'opened', 'timestamp', 'created'
  ],
  currentPriceCol: [
    'market price', 'current price', 'close price', 'last price', 'last', 'price eur', 'current_price'
  ],
  profitCol: [
    'profit', 'gross p/l', 'p/l', 'net p/l', 'gross profit', 'profit/loss', 'unrealized p/l', 'pl'
  ],
  currencyCol: [
    'currency', 'curr', 'nominal currency', 'instrument currency', 'ccy'
  ]
};

// Words that indicate fees/commissions to explicitly ignore
const IGNORED_COLUMN_TERMS = ['commission', 'fee', 'swap', 'rollover', 'spread', 'margin'];

/**
 * Parses numeric values handling both comma and dot decimal separators,
 * spaces/apostrophes as thousand separators, currency symbols, and negative signs.
 */
export function parseNumberFlexible(val: any): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;

  let str = String(val).trim();
  // Strip currency symbols and whitespace
  str = str.replace(/[€$£¥\s\u00A0]/g, '');

  if (!str) return 0;

  // Handle German/European number format: "1.234,56" or simple "123,45"
  if (str.includes(',') && str.includes('.')) {
    if (str.indexOf('.') < str.indexOf(',')) {
      // 1.234,56 -> 1234.56
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // 1,234.56 -> 1234.56
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    // 123,45 -> 123.45
    str = str.replace(',', '.');
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Safari-safe date parser for DD.MM.YYYY, DD/MM/YYYY, ISO, and Excel serial numbers.
 */
export function parseDateFlexible(val: any): string {
  if (!val) return new Date().toISOString();

  // Excel serial number (e.g. 45000.5)
  if (typeof val === 'number') {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (parsed) {
      const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0));
      return d.toISOString();
    }
  }

  const str = String(val).trim();

  // Match European formats: DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY with optional HH:mm:ss
  const euroMatch = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (euroMatch) {
    const day = parseInt(euroMatch[1], 10);
    const month = parseInt(euroMatch[2], 10);
    const year = parseInt(euroMatch[3], 10);
    const hours = euroMatch[4] ? parseInt(euroMatch[4], 10) : 12;
    const minutes = euroMatch[5] ? parseInt(euroMatch[5], 10) : 0;
    const seconds = euroMatch[6] ? parseInt(euroMatch[6], 10) : 0;

    const dateObj = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
    if (!isNaN(dateObj.getTime())) {
      return dateObj.toISOString();
    }
  }

  // Fallback ISO or standard format
  const parsedTs = Date.parse(str);
  if (!isNaN(parsedTs)) {
    return new Date(parsedTs).toISOString();
  }

  return new Date().toISOString();
}

/**
 * Inspects parsed sheet 2D array and auto-detects the header row.
 */
export function findHeaderRow(rows: any[][]): { headerRowIndex: number; headers: string[] } {
  let bestScore = -1;
  let bestRowIndex = 0;
  let bestHeaders: string[] = [];

  const maxScanRows = Math.min(rows.length, 25);

  for (let r = 0; r < maxScanRows; r++) {
    const row = rows[r];
    if (!row || !Array.isArray(row)) continue;

    const rowStrings = row.map(cell => (cell !== null && cell !== undefined ? String(cell).trim() : ''));
    const nonEmptyCount = rowStrings.filter(Boolean).length;
    if (nonEmptyCount < 2) continue;

    let score = 0;
    const lowerHeaders = rowStrings.map(h => h.toLowerCase());

    for (const key of Object.keys(SYNONYMS) as (keyof ColumnMapping)[]) {
      const candidates = SYNONYMS[key];
      const match = lowerHeaders.some(h => candidates.some(c => h.includes(c)));
      if (match) score += 2;
    }

    // Give extra weight if it contains both symbol and price/volume
    if (lowerHeaders.some(h => h.includes('symbol') || h.includes('instrument'))) score += 3;
    if (lowerHeaders.some(h => h.includes('price') || h.includes('open'))) score += 2;
    if (lowerHeaders.some(h => h.includes('volume') || h.includes('quantity'))) score += 2;

    if (score > bestScore) {
      bestScore = score;
      bestRowIndex = r;
      bestHeaders = rowStrings;
    }
  }

  return {
    headerRowIndex: bestRowIndex,
    headers: bestHeaders,
  };
}

/**
 * Infers initial column mapping using synonym dictionaries.
 */
export function inferColumnMapping(headers: string[]): ColumnMapping {
  const mapping: Partial<ColumnMapping> = {};
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());

  const findBestCol = (synonyms: string[]): string => {
    for (const synonym of synonyms) {
      const idx = lowerHeaders.findIndex((h) => {
        // Skip ignored columns like commission/fees
        if (IGNORED_COLUMN_TERMS.some(term => h.includes(term))) return false;
        return h === synonym || h.startsWith(synonym) || h.includes(synonym);
      });
      if (idx !== -1) {
        return headers[idx];
      }
    }
    return '';
  };

  mapping.symbolCol = findBestCol(SYNONYMS.symbolCol);
  mapping.quantityCol = findBestCol(SYNONYMS.quantityCol);
  mapping.openPriceCol = findBestCol(SYNONYMS.openPriceCol);
  mapping.openTimeCol = findBestCol(SYNONYMS.openTimeCol);
  mapping.nameCol = findBestCol(SYNONYMS.nameCol);
  mapping.currentPriceCol = findBestCol(SYNONYMS.currentPriceCol);
  mapping.profitCol = findBestCol(SYNONYMS.profitCol);
  mapping.currencyCol = findBestCol(SYNONYMS.currencyCol);

  return mapping as ColumnMapping;
}

/**
 * Parses raw ArrayBuffer or File using SheetJS for both .csv and .xlsx
 */
export interface ParsedFileResult {
  headers: string[];
  inferredMapping: ColumnMapping;
  rawRows: any[][];
  headerRowIndex: number;
  isGetquin?: boolean;
  getquinPositions?: Position[];
  getquinParsedRows?: RawParsedRow[];
  selectedSheetName?: string;
}

/**
 * Safely invokes XLSX.read while intercepting spurious ZIP descriptor warnings
 * ("Bad uncompressed size") emitted by SheetJS for brokerage exports where the
 * local file header has size 0 and the actual size is in the central directory.
 */
function safeXlsxRead(fileData: ArrayBuffer | Uint8Array, options: XLSX.ParsingOptions): XLSX.WorkBook {
  const origError = console.error;
  const origWarn = console.warn;
  try {
    console.error = (...args: any[]) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      if (msg.includes('Bad uncompressed size')) return;
      origError.apply(console, args);
    };
    console.warn = (...args: any[]) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      if (msg.includes('Bad uncompressed size')) return;
      origWarn.apply(console, args);
    };
    return XLSX.read(fileData, options);
  } finally {
    console.error = origError;
    console.warn = origWarn;
  }
}

export function parseXtbFile(fileData: ArrayBuffer | Uint8Array): ParsedFileResult {
  const workbook = safeXlsxRead(fileData, {
    type: 'array',
    cellDates: true,
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('The uploaded file contains no readable worksheets.');
  }

  // 1. Explicitly search for a sheet containing "open position" (case-insensitive, trimmed)
  let selectedSheetName = workbook.SheetNames.find((name) =>
    name.toLowerCase().trim().includes('open position')
  );

  // 2. If not found by "open position", filter out forbidden sheets (closed positions, cash operations)
  if (!selectedSheetName) {
    const isIgnoredSheet = (name: string) => {
      const lower = name.toLowerCase().trim();
      return lower.includes('closed position') || lower.includes('cash operation');
    };

    const eligibleSheets = workbook.SheetNames.filter((name) => !isIgnoredSheet(name));

    if (eligibleSheets.length === 0) {
      throw new Error(
        "Não foi encontrada uma folha 'Open Positions' neste ficheiro. As folhas de posições fechadas ou operações de caixa não contêm ativos em carteira."
      );
    }

    // Fallback to first eligible sheet for backward compatibility with classic XTB single-sheet exports
    selectedSheetName = eligibleSheets[0];
    console.warn(
      `[Parser] Nenhuma folha 'Open Positions' identificada explicitamente. Usando a folha '${selectedSheetName}' como fallback.`
    );
  }

  const worksheet = workbook.Sheets[selectedSheetName];
  if (!worksheet) {
    throw new Error(`Não foi possível ler os dados da folha '${selectedSheetName}'.`);
  }

  const allRows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  if (allRows.length === 0) {
    throw new Error(`A folha '${selectedSheetName}' está vazia.`);
  }

  // Check if this sheet matches Getquin Open Positions format
  const getquinCheck = isGetquinSheet(allRows);
  if (getquinCheck.isGetquin) {
    const getquinResult = parseGetquinOpenPositions(allRows);
    return {
      headers: getquinCheck.headers,
      inferredMapping: {
        symbolCol: 'Ticker',
        nameCol: 'Instrument/Position',
        quantityCol: 'Volume',
        openPriceCol: 'Open price',
        openTimeCol: 'Open time (UTC)',
        currentPriceCol: 'Current price',
        profitCol: 'Net Profit',
        currencyCol: '',
      },
      rawRows: allRows.slice(getquinCheck.headerRowIndex + 1),
      headerRowIndex: getquinCheck.headerRowIndex,
      isGetquin: true,
      getquinPositions: getquinResult.positions,
      getquinParsedRows: getquinResult.parsedRows,
      selectedSheetName,
    };
  }

  const { headerRowIndex, headers } = findHeaderRow(allRows);
  const inferredMapping = inferColumnMapping(headers);

  return {
    headers,
    inferredMapping,
    rawRows: allRows.slice(headerRowIndex + 1),
    headerRowIndex,
    isGetquin: false,
    selectedSheetName,
  };
}

/**
 * Transforms raw sheet rows into structured ParsedRows using the active column mapping.
 * Flags any incomplete or invalid rows without crashing.
 */
export function evaluateRowsWithMapping(
  rawRows: any[][],
  headers: string[],
  mapping: ColumnMapping
): RawParsedRow[] {
  const getColIndex = (colName?: string): number => {
    if (!colName) return -1;
    return headers.indexOf(colName);
  };

  const symbolIdx = getColIndex(mapping.symbolCol);
  const qtyIdx = getColIndex(mapping.quantityCol);
  const openPriceIdx = getColIndex(mapping.openPriceCol);
  const openTimeIdx = getColIndex(mapping.openTimeCol);
  const nameIdx = getColIndex(mapping.nameCol);
  const currentPriceIdx = getColIndex(mapping.currentPriceCol);
  const currencyIdx = getColIndex(mapping.currencyCol);

  return rawRows.map((row, idx) => {
    const rawObj: Record<string, any> = {};
    headers.forEach((h, hIdx) => {
      rawObj[h || `Col_${hIdx}`] = row[hIdx];
    });

    const symbolRaw = symbolIdx !== -1 ? String(row[symbolIdx] || '').trim() : '';
    const qtyRaw = qtyIdx !== -1 ? row[qtyIdx] : 0;
    const openPriceRaw = openPriceIdx !== -1 ? row[openPriceIdx] : 0;
    const openTimeRaw = openTimeIdx !== -1 ? row[openTimeIdx] : '';
    const nameRaw = nameIdx !== -1 ? String(row[nameIdx] || '').trim() : '';
    const currentPriceRaw = currentPriceIdx !== -1 ? row[currentPriceIdx] : undefined;
    const currencyRaw = currencyIdx !== -1 ? String(row[currencyIdx] || '').trim().toUpperCase() : 'EUR';

    const quantity = parseNumberFlexible(qtyRaw);
    const openPrice = parseNumberFlexible(openPriceRaw);
    const currentPrice = currentPriceRaw !== undefined ? parseNumberFlexible(currentPriceRaw) : undefined;
    const openTime = parseDateFlexible(openTimeRaw);

    let isValid = true;
    let warning = '';

    if (!symbolRaw) {
      isValid = false;
      warning = 'Missing symbol';
    } else if (quantity <= 0) {
      isValid = false;
      warning = 'Quantity must be greater than 0';
    } else if (openPrice <= 0) {
      isValid = false;
      warning = 'Open price must be greater than 0';
    }

    return {
      rowIndex: idx,
      raw: rawObj,
      symbol: symbolRaw,
      name: nameRaw || symbolRaw,
      quantity,
      openPrice,
      openTime,
      currentPrice,
      currency: currencyRaw || 'EUR',
      isValid,
      warning: warning || undefined,
      skip: !isValid,
    };
  });
}
