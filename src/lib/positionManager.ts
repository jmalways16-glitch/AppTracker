import { Position, PositionLot } from '../types';
import { 
  normalizeSymbol, 
  getForexRates, 
  convertToEur, 
  getCascadedQuote, 
  getCascadedProfile 
} from './marketApi';
import { aggregatePositionFromLots } from './lots';
import { savePositions } from './storage';

export interface ManualPositionInput {
  symbol: string;
  quantity: number;
  purchasePrice: number;
  purchaseCurrency: string;
  purchaseDate: string; // YYYY-MM-DD
}

export interface EditPositionInput {
  id: string;
  lotId?: string;
  action?: 'update' | 'delete_lot';
  quantity: number;
  purchasePrice: number;
  purchaseCurrency: string;
  purchaseDate: string; // YYYY-MM-DD
}

export const COMMON_CURRENCIES = [
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'CHF', symbol: 'Fr', name: 'Swiss Franc' },
  { code: 'PLN', symbol: 'zł', name: 'Polish Zloty' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'AU$', name: 'Australian Dollar' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
  { code: 'SEK', symbol: 'kr', name: 'Swedish Krona' },
  { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone' },
];

/**
 * Checks if a symbol already exists in the positions list
 */
export function findExistingPosition(positions: Position[], symbolToCheck: string): Position | null {
  const clean = symbolToCheck.trim().toUpperCase();
  if (!clean) return null;
  const cleanNormalized = normalizeSymbol(clean);

  for (const pos of positions) {
    if (pos.symbol.trim().toUpperCase() === clean) {
      return pos;
    }
    const posNorm = normalizeSymbol(pos.symbol);
    if (posNorm.usClean.toUpperCase() === cleanNormalized.usClean.toUpperCase() ||
        posNorm.original.toUpperCase() === clean) {
      return pos;
    }
  }

  return null;
}

/**
 * Adds a new position or merges automatically if the symbol already exists.
 * Recalculates weighted-average purchase price across both, storing/displaying in EUR.
 * Saves straight to Firestore.
 */
export async function addOrMergeManualPosition(
  currentPositions: Position[],
  input: ManualPositionInput
): Promise<Position[]> {
  const cleanSymbol = input.symbol.trim().toUpperCase();
  const normalized = normalizeSymbol(cleanSymbol);
  const rates = await getForexRates();

  // Convert input purchase price to EUR
  const purchasePriceEur = convertToEur(input.purchasePrice, input.purchaseCurrency, rates);

  // Check if position already exists
  const existingPos = findExistingPosition(currentPositions, cleanSymbol);

  let updatedList: Position[];

  if (existingPos) {
    // 2) MERGING WITH EXISTING POSITION:
    // Create a new PositionLot (source='manual') with the entered data and push to existing lots array.
    // Call aggregatePositionFromLots to recalculate all aggregated fields. Previous lot history is preserved.
    const newLot: PositionLot = {
      id: `lot-manual-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type: 'buy',
      quantity: input.quantity,
      price: input.purchasePrice,
      priceEur: purchasePriceEur,
      currency: input.purchaseCurrency.toUpperCase(),
      date: `${input.purchaseDate}T12:00:00.000Z`,
      valueEur: Number((input.quantity * purchasePriceEur).toFixed(4)),
      source: 'manual',
    };

    const currentLots: PositionLot[] = existingPos.lots && existingPos.lots.length > 0
      ? [...existingPos.lots, newLot]
      : [
          {
            id: `lot-prev-${existingPos.id}`,
            type: 'buy',
            quantity: existingPos.quantity,
            price: existingPos.openPrice,
            priceEur: existingPos.openPriceEur,
            currency: existingPos.currency,
            date: existingPos.openTime || new Date().toISOString(),
            valueEur: Number((existingPos.quantity * existingPos.openPriceEur).toFixed(4)),
            source: 'manual',
          },
          newLot,
        ];

    const aggregated = aggregatePositionFromLots(
      currentLots,
      existingPos.currentPriceEur,
      existingPos.currentPrice,
      existingPos.priceSource
    );

    const mergedPosition: Position = {
      ...existingPos,
      quantity: aggregated.quantity,
      openPrice: aggregated.openPrice,
      currency: existingPos.currency,
      openPriceEur: aggregated.openPriceEur,
      costBasisEur: aggregated.costBasisEur,
      marketValueEur: aggregated.marketValueEur,
      unrealizedProfitEur: aggregated.unrealizedProfitEur,
      unrealizedProfitPct: aggregated.unrealizedProfitPct,
      openTime: aggregated.openTime,
      lots: aggregated.lots,
    };

    updatedList = currentPositions.map((p) => (p.id === existingPos.id ? mergedPosition : p));
  } else {
    // Brand new position: Fetch live quote & profile
    const quote = await getCascadedQuote(cleanSymbol);
    const profile = await getCascadedProfile(cleanSymbol);

    let currentPrice = quote.price > 0 ? quote.price : input.purchasePrice;
    let currentPriceEur = quote.price > 0 ? convertToEur(quote.price, quote.currency, rates) : purchasePriceEur;
    let previousClose = quote.previousClose;
    let previousCloseEur = quote.previousClose ? convertToEur(quote.previousClose, quote.currency, rates) : undefined;

    const firstLot: PositionLot = {
      id: `lot-manual-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type: 'buy',
      quantity: input.quantity,
      price: input.purchasePrice,
      priceEur: purchasePriceEur,
      currency: input.purchaseCurrency.toUpperCase(),
      date: `${input.purchaseDate}T12:00:00.000Z`,
      valueEur: Number((input.quantity * purchasePriceEur).toFixed(4)),
      source: 'manual',
    };

    const aggregated = aggregatePositionFromLots(
      [firstLot],
      currentPriceEur,
      currentPrice,
      quote.source
    );

    const isEtf = profile.assetClass === 'etf' || 
                  cleanSymbol.startsWith('VWCE') || 
                  cleanSymbol.startsWith('CSPX') || 
                  cleanSymbol.startsWith('VUSA') || 
                  cleanSymbol.startsWith('IWDA') ||
                  (profile.name || '').toLowerCase().includes('etf') ||
                  (profile.name || '').toLowerCase().includes('ucits');

    const newPosition: Position = {
      id: `pos-manual-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      symbol: cleanSymbol,
      displaySymbol: normalized.usClean || cleanSymbol,
      name: profile.name || cleanSymbol,
      quantity: aggregated.quantity,
      openPrice: aggregated.openPrice,
      currency: input.purchaseCurrency.toUpperCase(),
      openTime: aggregated.openTime,
      lots: aggregated.lots,
      openPriceEur: aggregated.openPriceEur,
      currentPrice: aggregated.currentPrice,
      currentPriceEur: aggregated.currentPriceEur,
      previousClose,
      previousCloseEur,
      marketValueEur: aggregated.marketValueEur,
      costBasisEur: aggregated.costBasisEur,
      unrealizedProfitEur: aggregated.unrealizedProfitEur,
      unrealizedProfitPct: aggregated.unrealizedProfitPct,
      priceSource: quote.source,
      classificationSource: profile.source,
      assetClass: isEtf ? 'etf' : (profile.assetClass || 'stock'),
      sector: profile.sector || (isEtf ? 'Index / Fund' : 'General'),
      country: profile.country || 'Global',
    };

    updatedList = [newPosition, ...currentPositions];
  }

  // Persist directly to Firestore
  await savePositions(updatedList, 'replace');
  return updatedList;
}

/**
 * Edits an existing position directly in the portfolio.
 * If position has only 1 lot: edits that lot.
 * If position has multiple lots: accepts an optional lotId to edit or remove that specific lot.
 * Saves straight to Firestore.
 */
export async function editManualPosition(
  currentPositions: Position[],
  input: EditPositionInput
): Promise<Position[]> {
  const rates = await getForexRates();
  const openPriceEur = convertToEur(input.purchasePrice, input.purchaseCurrency, rates);

  const updatedList: Position[] = [];

  for (const pos of currentPositions) {
    if (pos.id !== input.id) {
      updatedList.push(pos);
      continue;
    }

    let lots = pos.lots ? [...pos.lots] : [];
    if (lots.length === 0) {
      lots = [{
        id: `lot-${pos.id}`,
        type: 'buy',
        quantity: pos.quantity,
        price: pos.openPrice,
        priceEur: pos.openPriceEur,
        currency: pos.currency,
        date: pos.openTime || new Date().toISOString(),
        valueEur: Number((pos.quantity * pos.openPriceEur).toFixed(4)),
        source: 'manual',
      }];
    }

    if (input.action === 'delete_lot' && input.lotId) {
      lots = lots.filter((l) => l.id !== input.lotId);
      if (lots.length === 0) {
        // If all lots deleted, position itself is omitted
        continue;
      }
    } else {
      let targetLotIndex = -1;
      if (input.lotId) {
        targetLotIndex = lots.findIndex((l) => l.id === input.lotId);
      }
      if (targetLotIndex === -1) {
        // Default to most recent lot (last in array)
        targetLotIndex = lots.length - 1;
      }

      if (targetLotIndex >= 0 && targetLotIndex < lots.length) {
        const existingLot = lots[targetLotIndex];
        lots[targetLotIndex] = {
          ...existingLot,
          quantity: input.quantity,
          price: input.purchasePrice,
          priceEur: openPriceEur,
          currency: input.purchaseCurrency.toUpperCase(),
          date: `${input.purchaseDate}T12:00:00.000Z`,
          valueEur: Number((input.quantity * openPriceEur).toFixed(4)),
        };
      }
    }

    const aggregated = aggregatePositionFromLots(
      lots,
      pos.currentPriceEur,
      pos.currentPrice,
      pos.priceSource
    );

    const updatedPos: Position = {
      ...pos,
      quantity: aggregated.quantity,
      openPrice: aggregated.openPrice,
      currency: lots[0]?.currency || pos.currency,
      openPriceEur: aggregated.openPriceEur,
      costBasisEur: aggregated.costBasisEur,
      marketValueEur: aggregated.marketValueEur,
      unrealizedProfitEur: aggregated.unrealizedProfitEur,
      unrealizedProfitPct: aggregated.unrealizedProfitPct,
      openTime: aggregated.openTime,
      lots: aggregated.lots,
    };

    updatedList.push(updatedPos);
  }

  // Persist directly to Firestore
  await savePositions(updatedList, 'replace');
  return updatedList;
}

/**
 * Deletes a position by ID from the portfolio.
 * Saves straight to Firestore.
 */
export async function deletePositionById(
  currentPositions: Position[],
  idToDelete: string
): Promise<Position[]> {
  const updatedList = currentPositions.filter((p) => p.id !== idToDelete);
  await savePositions(updatedList, 'replace');
  return updatedList;
}
