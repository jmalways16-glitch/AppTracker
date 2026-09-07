import { Position, EtfConstituent, EtfOverlapItem } from '../types';
import { fetchWithTimeout } from './marketApi';

// Authenticated backend proxy for TwelveData (keeps API secret on the server)
const TWELVEDATA_PROXY_BASE = '/api/market/twelvedata';

// In-memory cache for ETF holdings
const etfHoldingsCache = new Map<string, EtfConstituent[]>();

/**
 * Curated top constituents fallback for major global and European UCITS ETFs.
 * Used if TwelveData API endpoint is unavailable, rate-limited, or lacks composition for specific regional tickers.
 */
const KNOWN_ETF_CONSTITUENTS: Record<string, EtfConstituent[]> = {
  // Vanguard FTSE All-World UCITS ETF (VWCE, VWRL, VGWL)
  VWCE: [
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 3.8 },
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 3.7 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 3.1 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', weightPct: 2.3 },
    { symbol: 'META', name: 'Meta Platforms Inc.', weightPct: 1.4 },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Cl A)', weightPct: 1.3 },
    { symbol: 'GOOG', name: 'Alphabet Inc. (Cl C)', weightPct: 1.2 },
    { symbol: 'BRK.B', name: 'Berkshire Hathaway', weightPct: 1.0 },
    { symbol: 'TSM', name: 'Taiwan Semiconductor', weightPct: 0.9 },
    { symbol: 'LLY', name: 'Eli Lilly & Co.', weightPct: 0.9 },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weightPct: 0.9 },
    { symbol: 'TSLA', name: 'Tesla Inc.', weightPct: 0.8 },
    { symbol: 'JPM', name: 'JPMorgan Chase & Co.', weightPct: 0.8 },
  ],
  VWRL: [
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 3.8 },
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 3.7 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 3.1 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', weightPct: 2.3 },
    { symbol: 'META', name: 'Meta Platforms Inc.', weightPct: 1.4 },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Cl A)', weightPct: 1.3 },
    { symbol: 'TSM', name: 'Taiwan Semiconductor', weightPct: 0.9 },
    { symbol: 'LLY', name: 'Eli Lilly & Co.', weightPct: 0.9 },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weightPct: 0.9 },
    { symbol: 'TSLA', name: 'Tesla Inc.', weightPct: 0.8 },
  ],
  // iShares Core S&P 500 UCITS ETF (CSPX, SXR8, VUSA, VUAA, SPY, VOO)
  CSPX: [
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 6.9 },
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 6.5 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 6.1 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', weightPct: 3.6 },
    { symbol: 'META', name: 'Meta Platforms Inc.', weightPct: 2.4 },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Cl A)', weightPct: 2.1 },
    { symbol: 'GOOG', name: 'Alphabet Inc. (Cl C)', weightPct: 1.8 },
    { symbol: 'BRK.B', name: 'Berkshire Hathaway', weightPct: 1.7 },
    { symbol: 'LLY', name: 'Eli Lilly & Co.', weightPct: 1.5 },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weightPct: 1.4 },
    { symbol: 'TSLA', name: 'Tesla Inc.', weightPct: 1.3 },
    { symbol: 'JPM', name: 'JPMorgan Chase & Co.', weightPct: 1.3 },
  ],
  SXR8: [
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 6.9 },
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 6.5 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 6.1 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', weightPct: 3.6 },
    { symbol: 'META', name: 'Meta Platforms Inc.', weightPct: 2.4 },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Cl A)', weightPct: 2.1 },
    { symbol: 'LLY', name: 'Eli Lilly & Co.', weightPct: 1.5 },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weightPct: 1.4 },
    { symbol: 'TSLA', name: 'Tesla Inc.', weightPct: 1.3 },
  ],
  VUSA: [
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 6.9 },
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 6.5 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 6.1 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', weightPct: 3.6 },
    { symbol: 'META', name: 'Meta Platforms Inc.', weightPct: 2.4 },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Cl A)', weightPct: 2.1 },
    { symbol: 'LLY', name: 'Eli Lilly & Co.', weightPct: 1.5 },
    { symbol: 'TSLA', name: 'Tesla Inc.', weightPct: 1.3 },
  ],
  SPY: [
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 6.9 },
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 6.5 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 6.1 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', weightPct: 3.6 },
    { symbol: 'META', name: 'Meta Platforms Inc.', weightPct: 2.4 },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Cl A)', weightPct: 2.1 },
    { symbol: 'LLY', name: 'Eli Lilly & Co.', weightPct: 1.5 },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weightPct: 1.4 },
    { symbol: 'TSLA', name: 'Tesla Inc.', weightPct: 1.3 },
  ],
  // iShares S&P 500 Information Technology / Tech UCITS ETF (QDVE, IUIT)
  QDVE: [
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 18.2 },
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 17.4 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 16.1 },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weightPct: 5.2 },
    { symbol: 'CSCO', name: 'Cisco Systems', weightPct: 2.3 },
    { symbol: 'ACN', name: 'Accenture Plc', weightPct: 2.1 },
    { symbol: 'AMD', name: 'Advanced Micro Devices', weightPct: 2.0 },
    { symbol: 'ORCL', name: 'Oracle Corp.', weightPct: 1.9 },
    { symbol: 'CRM', name: 'Salesforce Inc.', weightPct: 1.8 },
    { symbol: 'QCOM', name: 'Qualcomm Inc.', weightPct: 1.8 },
  ],
  // Invesco EQQQ / QQQ Nasdaq 100
  QQQ: [
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 8.8 },
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 8.2 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 7.6 },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weightPct: 4.7 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', weightPct: 4.6 },
    { symbol: 'META', name: 'Meta Platforms Inc.', weightPct: 4.2 },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Cl A)', weightPct: 2.6 },
    { symbol: 'TSLA', name: 'Tesla Inc.', weightPct: 2.7 },
    { symbol: 'COST', name: 'Costco Wholesale', weightPct: 2.4 },
    { symbol: 'AMD', name: 'Advanced Micro Devices', weightPct: 1.8 },
    { symbol: 'NFLX', name: 'Netflix Inc.', weightPct: 1.7 },
  ],
  EQQQ: [
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 8.8 },
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 8.2 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 7.6 },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weightPct: 4.7 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', weightPct: 4.6 },
    { symbol: 'META', name: 'Meta Platforms Inc.', weightPct: 4.2 },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Cl A)', weightPct: 2.6 },
    { symbol: 'TSLA', name: 'Tesla Inc.', weightPct: 2.7 },
  ],
  // iShares Core MSCI World (IWDA, SWDA, EUNL)
  IWDA: [
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 4.5 },
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 4.3 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 3.9 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', weightPct: 2.6 },
    { symbol: 'META', name: 'Meta Platforms Inc.', weightPct: 1.7 },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Cl A)', weightPct: 1.5 },
    { symbol: 'LLY', name: 'Eli Lilly & Co.', weightPct: 1.1 },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weightPct: 1.1 },
    { symbol: 'BRK.B', name: 'Berkshire Hathaway', weightPct: 1.0 },
    { symbol: 'JPM', name: 'JPMorgan Chase & Co.', weightPct: 0.9 },
    { symbol: 'TSLA', name: 'Tesla Inc.', weightPct: 0.9 },
  ],
  SWDA: [
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 4.5 },
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 4.3 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 3.9 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', weightPct: 2.6 },
    { symbol: 'META', name: 'Meta Platforms Inc.', weightPct: 1.7 },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Cl A)', weightPct: 1.5 },
    { symbol: 'LLY', name: 'Eli Lilly & Co.', weightPct: 1.1 },
  ],
};

/**
 * Extracts a normalized root ticker without exchange suffix (e.g. "VWCE.DE" -> "VWCE")
 */
export function getRootSymbol(symbol: string): string {
  const parts = symbol.trim().toUpperCase().split('.');
  return parts[0];
}

/**
 * Fetches ETF underlying holdings via TwelveData API, falling back gracefully to known constituents
 */
export async function fetchEtfHoldings(symbol: string): Promise<EtfConstituent[]> {
  const cleanSymbol = getRootSymbol(symbol);
  
  if (etfHoldingsCache.has(cleanSymbol)) {
    return etfHoldingsCache.get(cleanSymbol)!;
  }

  // 1. Attempt TwelveData API calls
  try {
    // Attempt /etfs/world/composition or /etf/holdings via authenticated backend proxy
    const candidates = [
      `${TWELVEDATA_PROXY_BASE}/etfs/world/composition?symbol=${encodeURIComponent(cleanSymbol)}`,
      `${TWELVEDATA_PROXY_BASE}/etf/holdings?symbol=${encodeURIComponent(cleanSymbol)}`,
    ];

    for (const url of candidates) {
      try {
        const res = await fetchWithTimeout(url);
        if (res.ok) {
          const data = await res.json();
          if (data && !data.code && Array.isArray(data.holdings) && data.holdings.length > 0) {
            const parsed: EtfConstituent[] = data.holdings.map((h: any) => ({
              symbol: h.symbol || h.ticker || 'UNKNOWN',
              name: h.name || h.company_name || h.symbol,
              weightPct: parseFloat(h.weight || h.weight_percentage || h.percentage || '0'),
            })).filter((h: EtfConstituent) => h.weightPct > 0);

            if (parsed.length > 0) {
              etfHoldingsCache.set(cleanSymbol, parsed);
              return parsed;
            }
          }
        }
      } catch (e) {
        // Continue
      }
    }
  } catch (err) {
    // Fail gracefully
  }

  // 2. Check curated constituents database for this ETF root
  if (KNOWN_ETF_CONSTITUENTS[cleanSymbol]) {
    const fallback = KNOWN_ETF_CONSTITUENTS[cleanSymbol];
    etfHoldingsCache.set(cleanSymbol, fallback);
    return fallback;
  }

  // Gracefully return empty array if no holdings available (user requirement: skip gracefully)
  return [];
}

/**
 * Checks if a symbol represents an ETF
 */
export function isEtfPosition(pos: Position): boolean {
  if (pos.assetClass === 'etf') return true;
  const sym = pos.symbol.toUpperCase();
  const name = pos.name.toUpperCase();
  return (
    sym.includes('ETF') ||
    name.includes('ETF') ||
    name.includes('UCITS') ||
    name.includes('ISHARES') ||
    name.includes('VANGUARD') ||
    name.includes('INDEX') ||
    KNOWN_ETF_CONSTITUENTS[getRootSymbol(pos.symbol)] !== undefined
  );
}

/**
 * Calculates ETF overlap across held ETFs and individual stocks
 */
export async function calculatePortfolioOverlap(
  positions: Position[],
  totalPortfolioValueEur: number
): Promise<{
  overlapItems: EtfOverlapItem[];
  etfsAnalyzed: { symbol: string; name: string; portfolioWeightPct: number; holdingsCount: number }[];
  skippedEtfs: string[];
}> {
  if (positions.length === 0 || totalPortfolioValueEur <= 0) {
    return { overlapItems: [], etfsAnalyzed: [], skippedEtfs: [] };
  }

  const etfPositions = positions.filter(isEtfPosition);
  const directStockPositions = positions.filter(p => !isEtfPosition(p));

  const etfsAnalyzed: { symbol: string; name: string; portfolioWeightPct: number; holdingsCount: number }[] = [];
  const skippedEtfs: string[] = [];

  // Map of stock root symbol -> overlap details
  const stockMap = new Map<string, {
    name: string;
    directWeightPct: number;
    isDirectHolding: boolean;
    etfContributions: {
      etfSymbol: string;
      etfName: string;
      weightInsideEtfPct: number;
      contributionPct: number;
    }[];
  }>();

  // 1. Record direct stock holdings
  directStockPositions.forEach(p => {
    const root = getRootSymbol(p.symbol);
    const weightPct = (p.marketValueEur / totalPortfolioValueEur) * 100;

    if (!stockMap.has(root)) {
      stockMap.set(root, {
        name: p.name,
        directWeightPct: weightPct,
        isDirectHolding: true,
        etfContributions: [],
      });
    } else {
      const existing = stockMap.get(root)!;
      existing.directWeightPct += weightPct;
      existing.isDirectHolding = true;
    }
  });

  // 2. Fetch and cross-reference ETF constituents
  for (const etf of etfPositions) {
    const etfWeightInPortfolio = (etf.marketValueEur / totalPortfolioValueEur) * 100;
    const constituents = await fetchEtfHoldings(etf.symbol);

    if (constituents.length === 0) {
      // Gracefully skip ETF without breaking the calculation
      skippedEtfs.push(etf.symbol);
      continue;
    }

    etfsAnalyzed.push({
      symbol: etf.symbol,
      name: etf.name,
      portfolioWeightPct: etfWeightInPortfolio,
      holdingsCount: constituents.length,
    });

    for (const c of constituents) {
      const root = getRootSymbol(c.symbol);
      const contributionPct = (c.weightPct / 100) * etfWeightInPortfolio;

      if (!stockMap.has(root)) {
        stockMap.set(root, {
          name: c.name,
          directWeightPct: 0,
          isDirectHolding: false,
          etfContributions: [{
            etfSymbol: etf.symbol,
            etfName: etf.name,
            weightInsideEtfPct: c.weightPct,
            contributionPct,
          }],
        });
      } else {
        const item = stockMap.get(root)!;
        item.etfContributions.push({
          etfSymbol: etf.symbol,
          etfName: etf.name,
          weightInsideEtfPct: c.weightPct,
          contributionPct,
        });
      }
    }
  }

  // 3. Filter to stocks that repeat across >1 ETF, or appear in an ETF AND are held directly
  const overlapItems: EtfOverlapItem[] = [];

  stockMap.forEach((data, symbol) => {
    const etfCount = data.etfContributions.length;
    const isDirect = data.isDirectHolding;

    // Qualifies if in 2+ ETFs, or in 1+ ETF and held directly
    if (etfCount >= 2 || (etfCount >= 1 && isDirect)) {
      const totalEtfContribution = data.etfContributions.reduce((sum, e) => sum + e.contributionPct, 0);
      const combinedWeightPct = data.directWeightPct + totalEtfContribution;

      overlapItems.push({
        symbol,
        name: data.name,
        combinedWeightPct: Math.round(combinedWeightPct * 100) / 100,
        directWeightPct: Math.round(data.directWeightPct * 100) / 100,
        isDirectHolding: isDirect,
        etfs: data.etfContributions.sort((a, b) => b.contributionPct - a.contributionPct),
      });
    }
  });

  // 4. Sort by combined weight descending
  overlapItems.sort((a, b) => b.combinedWeightPct - a.combinedWeightPct);

  return {
    overlapItems,
    etfsAnalyzed,
    skippedEtfs,
  };
}
