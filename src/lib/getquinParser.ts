import * as XLSX from 'xlsx';
import { Position, RawParsedRow, PositionLot } from '../types';
import { inferCurrencyFromSymbol, convertToEur } from './marketApi';
import { parseDateFlexible, parseNumberFlexible } from './xtbParser';
import { aggregatePositionFromLots } from './lots';

export interface GetquinParseResult {
  isGetquin: boolean;
  positions: Position[];
  parsedRows: RawParsedRow[];
  warnings: string[];
}

/**
 * Checks whether the sheet rows match the Getquin Open Positions format.
 */
export function isGetquinSheet(allRows: any[][]): { isGetquin: boolean; headerRowIndex: number; headers: string[] } {
  for (let r = 0; r < Math.min(25, allRows.length); r++) {
    const row = allRows[r];
    if (!Array.isArray(row)) continue;

    const rowStrings = row.map((cell) => String(cell || '').trim().toLowerCase());
    
    // Check for Getquin signature columns
    const hasTicker = rowStrings.some((h) => h === 'ticker');
    const hasCategory = rowStrings.some((h) => h === 'category');
    const hasType = rowStrings.some((h) => h === 'type');
    const hasVolume = rowStrings.some((h) => h === 'volume' || h === 'shares');
    const hasValue = rowStrings.some((h) => h === 'value');
    const hasNetProfit = rowStrings.some((h) => h.includes('net profit'));

    if (hasTicker && hasCategory && hasType && hasVolume && hasValue && hasNetProfit) {
      return {
        isGetquin: true,
        headerRowIndex: r,
        headers: row.map((cell) => String(cell || '').trim()),
      };
    }
  }

  return { isGetquin: false, headerRowIndex: -1, headers: [] };
}

/**
 * Parses Getquin "Open Positions" hierarchical table.
 * - Summary rows define the position symbol and expected summary metrics.
 * - Child trade lot rows have Category empty and Type filled (BUY / SELL).
 * - Aggregated position metrics are derived strictly via aggregatePositionFromLots().
 */
export function parseGetquinOpenPositions(
  allRows: any[][],
  forexRates?: Record<string, number>
): GetquinParseResult {
  const { isGetquin, headerRowIndex, headers } = isGetquinSheet(allRows);

  if (!isGetquin || headerRowIndex === -1) {
    return { isGetquin: false, positions: [], parsedRows: [], warnings: [] };
  }

  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

  const getCol = (name: string): number => {
    return lowerHeaders.findIndex((h) => h === name.toLowerCase());
  };

  const tickerIdx = getCol('ticker');
  const instrumentIdx = lowerHeaders.findIndex((h) => h.includes('instrument') || h.includes('position'));
  const categoryIdx = getCol('category');
  const typeIdx = getCol('type');
  const volumeIdx = getCol('volume') !== -1 ? getCol('volume') : getCol('shares');
  const valueIdx = getCol('value');
  const openPriceIdx = getCol('open price');
  const currentPriceIdx = getCol('current price');
  const netProfitIdx = lowerHeaders.findIndex((h) => h === 'net profit' || (h.includes('net profit') && !h.includes('%')));
  const openTimeIdx = lowerHeaders.findIndex((h) => h.includes('open time') || h.includes('time (utc)'));

  const rowsAfterHeader = allRows.slice(headerRowIndex + 1);
  const positions: Position[] = [];
  const parsedRows: RawParsedRow[] = [];
  const warnings: string[] = [];

  let currentSummaryRowIndex = -1;
  let currentSummaryRow: any[] | null = null;
  let currentChildRows: any[][] = [];

  const finalizeGroup = () => {
    if (!currentSummaryRow || currentSummaryRowIndex === -1) return;

    const row = currentSummaryRow;
    const symbolRaw = tickerIdx !== -1 ? String(row[tickerIdx] || '').trim() : '';
    const nameRaw = instrumentIdx !== -1 ? String(row[instrumentIdx] || '').trim() : '';
    const categoryRaw = categoryIdx !== -1 ? String(row[categoryIdx] || '').trim() : '';
    const volumeCell = volumeIdx !== -1 ? row[volumeIdx] : undefined;
    const valueCell = valueIdx !== -1 ? row[valueIdx] : undefined;
    const netProfitCell = netProfitIdx !== -1 ? row[netProfitIdx] : undefined;
    const openPriceCell = openPriceIdx !== -1 ? row[openPriceIdx] : undefined;
    const currentPriceCell = currentPriceIdx !== -1 ? row[currentPriceIdx] : undefined;

    let isValid = true;
    const rowWarnings: string[] = [];

    // Validation: Symbol not empty
    if (!symbolRaw) {
      isValid = false;
      rowWarnings.push('Missing ticker/symbol');
    }

    const summaryQty = volumeCell !== undefined ? parseNumberFlexible(volumeCell) : 0;
    const summaryValueEur = valueCell !== undefined ? parseNumberFlexible(valueCell) : 0;
    const summaryNetProfitEur = netProfitCell !== undefined ? parseNumberFlexible(netProfitCell) : 0;
    const summaryCostBasisEur = summaryValueEur - summaryNetProfitEur;

    // Currency inferred via explicit suffix map
    const currency = inferCurrencyFromSymbol(symbolRaw);

    // 1. Construct lots from child rows (or summary fallback if no child rows)
    const lots: PositionLot[] = [];

    if (currentChildRows.length > 0) {
      currentChildRows.forEach((cRow, idx) => {
        const cTypeRaw = typeIdx !== -1 ? String(cRow[typeIdx] || '').trim().toLowerCase() : 'buy';
        const type: 'buy' | 'sell' = cTypeRaw.includes('sell') ? 'sell' : 'buy';
        const qty = volumeIdx !== -1 ? parseNumberFlexible(cRow[volumeIdx]) : 0;
        const price = openPriceIdx !== -1 ? parseNumberFlexible(cRow[openPriceIdx]) : 0;
        const rawDate = openTimeIdx !== -1 ? String(cRow[openTimeIdx] || '') : '';
        const date = parseDateFlexible(rawDate);
        const priceEur = convertToEur(price, currency, forexRates || {});
        const valueEur = Number((qty * priceEur).toFixed(4));

        if (qty > 0) {
          lots.push({
            id: `lot-getquin-${symbolRaw}-${idx}-${Date.now()}`,
            type,
            quantity: qty,
            price,
            priceEur,
            currency,
            date,
            valueEur,
            source: 'getquin',
          });
        }
      });
    }

    // If no valid child lots were parsed, construct 1 buy lot from the summary line
    if (lots.length === 0 && summaryQty > 0) {
      const openPrice = openPriceCell !== undefined 
        ? parseNumberFlexible(openPriceCell) 
        : (summaryQty > 0 ? summaryCostBasisEur / summaryQty : 0);
      const priceEur = convertToEur(openPrice, currency, forexRates || {});
      lots.push({
        id: `lot-getquin-${symbolRaw}-summary-${Date.now()}`,
        type: 'buy',
        quantity: summaryQty,
        price: openPrice,
        priceEur,
        currency,
        date: new Date().toISOString(),
        valueEur: Number((summaryQty * priceEur).toFixed(4)),
        source: 'getquin',
      });
    }

    // 2. Current prices
    let currentPrice = currentPriceCell !== undefined ? parseNumberFlexible(currentPriceCell) : 0;
    let currentPriceEur = summaryQty > 0 ? summaryValueEur / summaryQty : 0;
    if (currentPrice === 0 && currentPriceEur > 0) {
      currentPrice = currency === 'EUR' ? currentPriceEur : currentPriceEur * 1.08;
    }
    if (currentPriceEur === 0 && currentPrice > 0) {
      currentPriceEur = convertToEur(currentPrice, currency, forexRates || {});
    }

    // 3. Aggregate position fields strictly from lots
    const aggregated = aggregatePositionFromLots(lots, currentPriceEur, currentPrice, 'xtb');

    if (aggregated.quantity <= 0) {
      isValid = false;
      rowWarnings.push('Calculated quantity is 0 or invalid');
    }

    // 4. Validate / log discrepancy against summary line
    if (summaryCostBasisEur > 0 && Math.abs(aggregated.costBasisEur - summaryCostBasisEur) > 5) {
      console.warn(
        `[Getquin Parser] Discrepancy for ${symbolRaw}: Calculated cost basis (${aggregated.costBasisEur.toFixed(2)} €) differs from summary line (${summaryCostBasisEur.toFixed(2)} €)`
      );
    }

    const catLower = categoryRaw.toLowerCase();
    const assetClass = catLower === 'etf' ? 'etf' : 'stock';
    const isUs = symbolRaw.endsWith('.US') || (!symbolRaw.includes('.') && currency === 'USD');

    const warningText = rowWarnings.join('; ');
    if (warningText) {
      warnings.push(`[${symbolRaw || `Row ${currentSummaryRowIndex}`}] ${warningText}`);
    }

    const rawObj: Record<string, any> = {};
    headers.forEach((h, idx) => {
      rawObj[h || `Col_${idx}`] = row[idx];
    });

    const position: Position = {
      id: `pos-${symbolRaw}-${Date.now()}-${positions.length}`,
      symbol: symbolRaw,
      displaySymbol: symbolRaw.replace(/\.US$/, ''),
      name: nameRaw || symbolRaw,
      quantity: aggregated.quantity,
      openPrice: aggregated.openPrice,
      currency,
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
      assetClass,
      sector: assetClass === 'etf' ? 'Index / Fund' : 'General',
      country: isUs ? 'United States' : (symbolRaw.includes('.DE') ? 'Germany' : 'Global'),
    };

    if (isValid) {
      positions.push(position);
    }

    parsedRows.push({
      rowIndex: currentSummaryRowIndex,
      raw: rawObj,
      symbol: symbolRaw,
      name: nameRaw || symbolRaw,
      quantity: aggregated.quantity,
      openPrice: aggregated.openPriceEur,
      openTime: aggregated.openTime,
      currentPrice: aggregated.currentPriceEur,
      currency,
      isValid,
      warning: warningText || undefined,
      skip: !isValid,
    });
  };

  // Iterate rows and identify Summary vs Child rows
  for (let r = 0; r < rowsAfterHeader.length; r++) {
    const row = rowsAfterHeader[r];
    if (!row || row.length === 0) continue;

    const categoryCell = categoryIdx !== -1 ? String(row[categoryIdx] || '').trim() : '';
    const typeCell = typeIdx !== -1 ? String(row[typeIdx] || '').trim() : '';
    const tickerCell = tickerIdx !== -1 ? String(row[tickerIdx] || '').trim() : '';

    // Summary row: Category filled and Type empty (and has ticker)
    const isSummaryRow = categoryCell !== '' && typeCell === '' && tickerCell !== '';

    // Child row: Category empty and Type filled (or trade lot row under a summary)
    const isChildRow = categoryCell === '' && typeCell !== '';

    if (isSummaryRow) {
      // Finalize preceding position group
      finalizeGroup();

      // Start new position group
      currentSummaryRow = row;
      currentSummaryRowIndex = headerRowIndex + 1 + r;
      currentChildRows = [];
    } else if (isChildRow) {
      currentChildRows.push(row);
    } else {
      // Check if it's an end-of-table summary or unrecognized row
      if (tickerCell === '' && categoryCell === '' && typeCell === '') {
        continue;
      }
      if (currentSummaryRow && volumeIdx !== -1 && row[volumeIdx]) {
        currentChildRows.push(row);
      }
    }
  }

  // Finalize last group
  finalizeGroup();

  return {
    isGetquin: true,
    positions,
    parsedRows,
    warnings,
  };
}
