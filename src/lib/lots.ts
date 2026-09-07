import { PositionLot, MarketDataSource } from '../types';

export interface AggregatedLotPosition {
  quantity: number;
  costBasisEur: number;
  openPrice: number;
  openPriceEur: number;
  openTime: string;
  currentPrice: number;
  currentPriceEur: number;
  marketValueEur: number;
  unrealizedProfitEur: number;
  unrealizedProfitPct: number;
  priceSource: MarketDataSource;
  lots: PositionLot[];
}

/**
 * Central helper to aggregate Position fields from its lots using average cost.
 *
 * Rules:
 * - quantity = sum(buy.quantity) - sum(sell.quantity)
 * - costBasisEur: calculated sequentially chronologically using average cost:
 *   - 'buy': adds valueEur (quantity * priceEur)
 *   - 'sell': subtracts sold_quantity * accumulated average cost per unit
 * - openTime: date of the earliest 'buy' lot
 * - openPriceEur: costBasisEur / quantity
 * - openPrice: native weighted average price (native cost basis / quantity)
 * - marketValueEur: quantity * currentPriceEur
 * - unrealizedProfitEur: marketValueEur - costBasisEur
 * - unrealizedProfitPct: (unrealizedProfitEur / costBasisEur) * 100
 */
export function aggregatePositionFromLots(
  lots: PositionLot[],
  currentPriceEur: number,
  currentPrice: number,
  priceSource: MarketDataSource = 'finnhub'
): AggregatedLotPosition {
  if (!lots || lots.length === 0) {
    return {
      quantity: 0,
      costBasisEur: 0,
      openPrice: 0,
      openPriceEur: 0,
      openTime: new Date().toISOString(),
      currentPrice,
      currentPriceEur,
      marketValueEur: 0,
      unrealizedProfitEur: 0,
      unrealizedProfitPct: 0,
      priceSource,
      lots: [],
    };
  }

  // Sort chronologically ascending
  const sortedLots = [...lots].sort((a, b) => {
    const timeA = new Date(a.date).getTime() || 0;
    const timeB = new Date(b.date).getTime() || 0;
    return timeA - timeB;
  });

  let runningQty = 0;
  let runningCostBasisEur = 0;
  let runningCostBasisNative = 0;

  for (const lot of sortedLots) {
    const lotQty = Math.max(0, lot.quantity || 0);
    const lotPriceEur = lot.priceEur ?? (lot.price || 0);
    const lotPriceNative = lot.price || 0;
    const lotValueEur = lot.valueEur ?? (lotQty * lotPriceEur);
    const lotValueNative = lotQty * lotPriceNative;

    if (lot.type === 'buy') {
      runningQty += lotQty;
      runningCostBasisEur += lotValueEur;
      runningCostBasisNative += lotValueNative;
    } else if (lot.type === 'sell') {
      if (runningQty > 0) {
        const avgCostEur = runningCostBasisEur / runningQty;
        const avgCostNative = runningCostBasisNative / runningQty;
        const reductionEur = Math.min(runningCostBasisEur, lotQty * avgCostEur);
        const reductionNative = Math.min(runningCostBasisNative, lotQty * avgCostNative);

        runningQty = Math.max(0, runningQty - lotQty);
        runningCostBasisEur = Math.max(0, runningCostBasisEur - reductionEur);
        runningCostBasisNative = Math.max(0, runningCostBasisNative - reductionNative);
      } else {
        runningQty = Math.max(0, runningQty - lotQty);
      }
    }
  }

  const finalQuantity = Number(runningQty.toFixed(8));
  const finalCostBasisEur = Number(runningCostBasisEur.toFixed(4));

  let openPriceEur = 0;
  let openPrice = 0;
  if (finalQuantity > 0) {
    openPriceEur = Number((finalCostBasisEur / finalQuantity).toFixed(4));
    openPrice = Number((runningCostBasisNative / finalQuantity).toFixed(4));
  }

  // Earliest buy lot date
  const buyLots = sortedLots.filter((l) => l.type === 'buy');
  const openTime = buyLots.length > 0 ? buyLots[0].date : sortedLots[0].date;

  const marketValueEur = Number((finalQuantity * currentPriceEur).toFixed(4));
  const unrealizedProfitEur = Number((marketValueEur - finalCostBasisEur).toFixed(4));
  const unrealizedProfitPct = finalCostBasisEur > 0
    ? Number(((unrealizedProfitEur / finalCostBasisEur) * 100).toFixed(4))
    : 0;

  return {
    quantity: finalQuantity,
    costBasisEur: finalCostBasisEur,
    openPrice,
    openPriceEur,
    openTime,
    currentPrice,
    currentPriceEur,
    marketValueEur,
    unrealizedProfitEur,
    unrealizedProfitPct,
    priceSource,
    lots: sortedLots,
  };
}
