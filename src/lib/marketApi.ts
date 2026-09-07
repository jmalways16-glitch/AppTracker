import {
  MarketDataSource,
  ClassificationSource,
  AssetClass,
  MarketQuote,
  SecurityProfile,
  DividendEvent,
  CompanyNewsArticle,
  Position,
  ChartPeriod,
  SymbolSearchResult,
} from '../types';

// Authenticated server backend proxy endpoints
// Secrets (tokens/keys) are securely held on the backend server, keeping client bundle clean
const FINNHUB_PROXY_BASE = '/api/market/finnhub';
const TWELVEDATA_PROXY_BASE = '/api/market/twelvedata';

/**
 * Helper to fetch with an AbortController timeout.
 * Aborts smoothly on timeout, allowing cascaded fallbacks to proceed without blocking.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// In-memory cache for the manual refresh session
const quoteCache = new Map<string, MarketQuote>();
const profileCache = new Map<string, SecurityProfile>();
const fxRatesCache = new Map<string, number>(); // Base EUR: rates for USD, GBP, PLN, CHF, etc.
const candleCache = new Map<string, { date: string; price: number }[]>();

// Forex state tracking & notification for UI alerts
let currentForexSource: 'finnhub' | 'frankfurter' | 'yahoo' | 'hardcoded_fallback' = 'frankfurter';
let currentForexIsStale: boolean = false;
const forexStateListeners = new Set<(isStale: boolean, source: string) => void>();

export function getForexStatus(): { isStale: boolean; source: string } {
  return { isStale: currentForexIsStale, source: currentForexSource };
}

export function subscribeForexStatus(listener: (isStale: boolean, source: string) => void): () => void {
  forexStateListeners.add(listener);
  listener(currentForexIsStale, currentForexSource);
  return () => {
    forexStateListeners.delete(listener);
  };
}

function notifyForexStatus(isStale: boolean, source: 'finnhub' | 'frankfurter' | 'yahoo' | 'hardcoded_fallback'): void {
  currentForexIsStale = isStale;
  currentForexSource = source;
  forexStateListeners.forEach((l) => {
    try {
      l(isStale, source);
    } catch (e) {
      console.error('Error in forex status listener:', e);
    }
  });
}

// Log Finnhub key configuration warning once to prevent console spam
let hasLoggedFinnhubKeyStatus = false;
function logFinnhubWarningOnce(reason: string): void {
  if (!hasLoggedFinnhubKeyStatus) {
    hasLoggedFinnhubKeyStatus = true;
    console.warn(`[Finnhub] Não configurado ou indisponível (${reason}). O Johnfolio está a usar automaticamente a cascata Yahoo Finance / Frankfurter para cotações e taxas cambiais em tempo real.`);
  }
}

export function clearCandleCache(): void {
  candleCache.clear();
}

/**
 * Normalizes symbols from XTB format (e.g. "AAPL.US", "VWCE.DE", "MSFT")
 */
export function normalizeSymbol(rawSymbol: string): {
  original: string;
  usClean: string;       // e.g. "AAPL"
  yahooSymbol: string;   // e.g. "VWCE.DE", "CSPX.L"
  twelveDataSymbol: string;
} {
  const sym = rawSymbol.trim().toUpperCase();
  const usClean = sym.replace(/\.US$/, '');
  
  // Convert UK to .L for Yahoo if needed
  let yahoo = sym;
  if (sym.endsWith('.UK')) {
    yahoo = sym.replace(/\.UK$/, '.L');
  }

  const twelveData = usClean.split('.')[0];

  return {
    original: sym,
    usClean,
    yahooSymbol: yahoo,
    twelveDataSymbol: twelveData,
  };
}

/**
 * Explicit ticker suffix to trading currency mapping
 */
export const TICKER_SUFFIX_CURRENCY_MAP: Record<string, string> = {
  // UK / London
  '.L': 'GBP',
  '.UK': 'GBP',
  // Switzerland
  '.SW': 'CHF',
  '.VX': 'CHF',
  // Canada
  '.TO': 'CAD',
  '.V': 'CAD',
  '.CN': 'CAD',
  '.NE': 'CAD',
  // Poland
  '.PL': 'PLN',
  '.WA': 'PLN',
  // Eurozone
  '.DE': 'EUR',
  '.PA': 'EUR',
  '.AS': 'EUR',
  '.MI': 'EUR',
  '.MC': 'EUR',
  '.LS': 'EUR',
  '.BR': 'EUR',
  '.VI': 'EUR',
  '.AT': 'EUR',
  '.IR': 'EUR',
  '.HE': 'EUR',
  // Scandinavia
  '.CO': 'DKK',
  '.ST': 'SEK',
  '.OL': 'NOK',
  // Asia / Pacific
  '.HK': 'HKD',
  '.T': 'JPY',
  '.AX': 'AUD',
  '.NZ': 'NZD',
  '.SG': 'SGD',
  // US
  '.US': 'USD',
};

/**
 * Accurately infers currency from ticker suffix with explicit market mapping
 */
export function inferCurrencyFromSymbol(symbol: string): string {
  if (!symbol) return 'EUR';
  const upper = symbol.toUpperCase().trim();

  // 1. Check explicit suffix matches (e.g. .UK, .L, .SW, .TO, .PL, .DE)
  for (const [suffix, currency] of Object.entries(TICKER_SUFFIX_CURRENCY_MAP)) {
    if (upper.endsWith(suffix)) {
      return currency;
    }
  }

  // 2. Tickers without a dot or explicitly ending in .US are US securities (USD)
  if (!upper.includes('.') || upper.endsWith('.US')) {
    return 'USD';
  }

  // 3. Default fallback for unknown exchange suffixes
  return 'EUR';
}

/**
 * Fetches EUR FX exchange rates with real cascaded fallbacks:
 * 1. Finnhub Forex API (/forex/rates?base=EUR)
 * 2. Frankfurter API (https://api.frankfurter.dev/v1/latest?base=EUR - Free, official ECB daily rates, no API key required)
 * 3. Yahoo Finance FX Quotes (/api/yahoo/v8/finance/chart/EURUSD=X, etc.)
 * 4. Hardcoded emergency fallback (Marks status as stale and notifies UI)
 */
export async function getForexRates(): Promise<Record<string, number>> {
  if (fxRatesCache.size > 0) {
    return Object.fromEntries(fxRatesCache.entries());
  }

  // 1. First Attempt: Finnhub Forex
  try {
    const res = await fetchWithTimeout(
      `${FINNHUB_PROXY_BASE}/forex/rates?base=EUR`,
      {},
      4000
    );
    if (res.ok) {
      const data = await res.json();
      if (data && data.error) {
        // Backend proxy returned a clear error body (e.g. missing/invalid token)
        logFinnhubWarningOnce(`forex/rates: ${data.error}`);
      } else if (data && data.quote && typeof data.quote.USD === 'number') {
        Object.entries(data.quote).forEach(([curr, rate]) => {
          if (typeof rate === 'number' && rate > 0) {
            fxRatesCache.set(curr.toUpperCase(), rate);
          }
        });
        fxRatesCache.set('EUR', 1.0);
        notifyForexStatus(false, 'finnhub');
        return Object.fromEntries(fxRatesCache.entries());
      } else {
        logFinnhubWarningOnce('forex/rates: resposta sem dados de câmbio (plano Finnhub pode não incluir forex)');
      }
    } else {
      // Non-2xx: surface the exact status so a missing/invalid key is obvious
      logFinnhubWarningOnce(`forex/rates: HTTP ${res.status}${res.status === 401 || res.status === 403 ? ' — chave Finnhub em falta ou inválida' : ''}`);
    }
  } catch (e: any) {
    // Network error, timeout, or proxy unreachable — this was previously swallowed silently
    logFinnhubWarningOnce(`forex/rates: falha de rede (${e?.message || 'erro desconhecido'})`);
  }

  // 2. Second Attempt: Frankfurter API (Free, reliable, no key needed, backed by European Central Bank)
  const frankfurterEndpoints = [
    'https://api.frankfurter.dev/v1/latest?base=EUR',
    'https://api.frankfurter.app/latest?from=EUR',
  ];

  for (const url of frankfurterEndpoints) {
    try {
      const res = await fetchWithTimeout(url, {}, 5000);
      if (res.ok) {
        const data = await res.json();
        if (data && data.rates && typeof data.rates.USD === 'number') {
          Object.entries(data.rates).forEach(([curr, rate]) => {
            if (typeof rate === 'number' && rate > 0) {
              fxRatesCache.set(curr.toUpperCase(), rate);
            }
          });
          fxRatesCache.set('EUR', 1.0);
          notifyForexStatus(false, 'frankfurter');
          return Object.fromEntries(fxRatesCache.entries());
        }
      }
    } catch (err) {
      // Try next endpoint or Yahoo fallback
    }
  }

  // 3. Third Attempt: Yahoo Finance Forex Quotes for primary pairs (EUR/USD, EUR/GBP, EUR/CHF, EUR/PLN, EUR/CAD)
  try {
    const yahooPairs: { symbol: string; currency: string }[] = [
      { symbol: 'EURUSD=X', currency: 'USD' },
      { symbol: 'EURGBP=X', currency: 'GBP' },
      { symbol: 'EURCHF=X', currency: 'CHF' },
      { symbol: 'EURPLN=X', currency: 'PLN' },
      { symbol: 'EURCAD=X', currency: 'CAD' },
      { symbol: 'EURJPY=X', currency: 'JPY' },
    ];

    const pairPromises = yahooPairs.map(async ({ symbol, currency }) => {
      try {
        const res = await fetchWithTimeout(`/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`, {}, 4000);
        if (res.ok) {
          const json = await res.json();
          const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (typeof price === 'number' && price > 0) {
            return { currency, rate: price };
          }
        }
      } catch (err) {
        // Individual pair fail
      }
      return null;
    });

    const results = await Promise.all(pairPromises);
    const validResults = results.filter((r): r is { currency: string; rate: number } => r !== null);

    if (validResults.length > 0) {
      validResults.forEach(({ currency, rate }) => {
        fxRatesCache.set(currency, rate);
      });
      fxRatesCache.set('EUR', 1.0);
      notifyForexStatus(false, 'yahoo');
      return Object.fromEntries(fxRatesCache.entries());
    }
  } catch (err) {
    // Proceed to hardcoded emergency fallback
  }

  // 4. Last Resort: Hardcoded emergency fallback values
  // Only reached if ALL live sources (Finnhub, Frankfurter, Yahoo) fail
  const emergencyRates: Record<string, number> = {
    EUR: 1.0,
    USD: 1.08,
    GBP: 0.85,
    PLN: 4.30,
    CHF: 0.95,
    CAD: 1.48,
    JPY: 165.0,
    AUD: 1.62,
  };

  console.warn('[Forex] Todas as fontes de câmbio em tempo real falharam (Finnhub, Frankfurter, Yahoo). A utilizar taxas de emergência.');
  Object.entries(emergencyRates).forEach(([c, r]) => fxRatesCache.set(c, r));
  notifyForexStatus(true, 'hardcoded_fallback');
  return emergencyRates;
}

/**
 * Converts an amount from source currency into EUR
 */
export function convertToEur(
  amount: number,
  currency: string,
  rates: Record<string, number>
): number {
  if (!amount) return 0;
  const curr = (currency || 'EUR').toUpperCase();
  if (curr === 'EUR') return amount;

  const rate = rates[curr] || fxRatesCache.get(curr);
  if (rate && rate > 0) {
    // If rate is EUR/USD = 1.08, 1 EUR = 1.08 USD, so 1 USD = (1 / 1.08) EUR
    return amount / rate;
  }

  // Fallback direct conversions
  if (curr === 'USD') return amount / 1.08;
  if (curr === 'GBP') return amount / 0.85;
  if (curr === 'PLN') return amount / 4.30;
  if (curr === 'CHF') return amount / 0.95;

  return amount;
}

// -------------------------------------------------------------
// 1. FINNHUB CLIENT
// -------------------------------------------------------------
async function fetchFinnhubQuote(symbol: string): Promise<MarketQuote | null> {
  const { usClean, original } = normalizeSymbol(symbol);
  
  // Try US-cleaned ticker first, then original
  const candidateSymbols = [usClean, original];

  for (const sym of candidateSymbols) {
    try {
      const res = await fetchWithTimeout(
        `${FINNHUB_PROXY_BASE}/quote?symbol=${encodeURIComponent(sym)}`
      );
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          logFinnhubWarningOnce(`quote ${sym}: HTTP ${res.status} — chave Finnhub não configurada ou sem autorização`);
        } else {
          logFinnhubWarningOnce(`quote ${sym}: HTTP ${res.status}`);
        }
        continue;
      }
      const data = await res.json();

      if (data && data.error) {
        logFinnhubWarningOnce(`quote ${sym}: ${data.error}`);
        continue;
      }

      // Finnhub returns c=0 when no data found
      if (data && typeof data.c === 'number' && data.c > 0) {
        const prevClose = typeof data.pc === 'number' && data.pc > 0 ? data.pc : undefined;
        return {
          symbol: original,
          price: data.c,
          currency: inferCurrencyFromSymbol(original),
          source: 'finnhub',
          timestamp: data.t ? data.t * 1000 : Date.now(),
          previousClose: prevClose,
          dayChange: data.d,
          dayChangePct: data.dp,
        };
      }
    } catch (e: any) {
      // Previously silent — this hides the real cause when the proxy is unreachable entirely
      logFinnhubWarningOnce(`quote ${sym}: falha de rede (${e?.message || 'erro desconhecido'})`);
    }
  }

  return null;
}

async function fetchFinnhubProfile(symbol: string): Promise<SecurityProfile | null> {
  const { usClean, original } = normalizeSymbol(symbol);
  const candidateSymbols = [usClean, original];

  for (const sym of candidateSymbols) {
    try {
      const res = await fetchWithTimeout(
        `${FINNHUB_PROXY_BASE}/stock/profile2?symbol=${encodeURIComponent(sym)}`
      );
      if (!res.ok) continue;
      const data = await res.json();

      if (data && data.name) {
        return {
          symbol: original,
          name: data.name,
          sector: data.finnhubIndustry || 'General',
          country: data.country || 'Global',
          assetClass: 'stock',
          marketCap: data.marketCapitalization ? data.marketCapitalization * 1000000 : null,
          logo: data.logo,
          source: 'finnhub',
        };
      }
    } catch (e) {
      // Continue
    }
  }
  return null;
}

// -------------------------------------------------------------
// 2. YAHOO FINANCE FALLBACK
// -------------------------------------------------------------
async function fetchYahooQuote(symbol: string): Promise<MarketQuote | null> {
  const { yahooSymbol, usClean, original } = normalizeSymbol(symbol);
  const tickersToTry = [yahooSymbol, usClean];

  for (const t of tickersToTry) {
    try {
      // First attempt via /api/yahoo proxy (works in Vite dev & full-stack)
      let res: Response | null = null;
      try {
        res = await fetchWithTimeout(`/api/yahoo/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=5d`);
      } catch (err) {
        // Dev proxy might not be reachable in some static environments, try CORS proxy fallback
      }

      if (!res || !res.ok) {
        // Fallback to public CORS proxy
        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=5d`;
        res = await fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`);
      }

      if (res && res.ok) {
        const json = await res.json();
        const result = json?.chart?.result?.[0];
        if (result) {
          const meta = result.meta;
          const price = meta.regularMarketPrice || meta.chartPreviousClose;
          if (price && price > 0) {
            const prevClose = meta.chartPreviousClose || price;
            const change = price - prevClose;
            const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
            const currency = meta.currency || inferCurrencyFromSymbol(original);

            return {
              symbol: original,
              price,
              currency,
              source: 'yahoo',
              timestamp: (meta.regularMarketTime || Math.floor(Date.now() / 1000)) * 1000,
              previousClose: prevClose > 0 ? prevClose : undefined,
              dayChange: change,
              dayChangePct: changePct,
            };
          }
        }
      }
    } catch (e) {
      // Ignore and continue
    }
  }

  return null;
}

// -------------------------------------------------------------
// 3. TWELVEDATA FALLBACK
// -------------------------------------------------------------
async function fetchTwelveDataQuote(symbol: string): Promise<MarketQuote | null> {
  const { twelveDataSymbol, original } = normalizeSymbol(symbol);

  try {
    const res = await fetchWithTimeout(
      `${TWELVEDATA_PROXY_BASE}/quote?symbol=${encodeURIComponent(twelveDataSymbol)}`
    );
    if (!res.ok) return null;
    const data = await res.json();

    if (data && data.close && !data.code) {
      const price = parseFloat(data.close);
      const change = parseFloat(data.change || '0');
      const changePct = parseFloat(data.percent_change || '0');
      const prevClose = parseFloat(data.previous_close || '0');

      if (!isNaN(price) && price > 0) {
        return {
          symbol: original,
          price,
          currency: data.currency || inferCurrencyFromSymbol(original),
          source: 'twelvedata',
          timestamp: data.timestamp ? data.timestamp * 1000 : Date.now(),
          previousClose: !isNaN(prevClose) && prevClose > 0 ? prevClose : undefined,
          dayChange: isNaN(change) ? 0 : change,
          dayChangePct: isNaN(changePct) ? 0 : changePct,
        };
      }
    }
  } catch (e) {
    // Ignore
  }

  return null;
}

export async function fetchTwelveDataProfile(symbol: string): Promise<SecurityProfile | null> {
  const { twelveDataSymbol, original } = normalizeSymbol(symbol);

  try {
    const res = await fetchWithTimeout(
      `${TWELVEDATA_PROXY_BASE}/profile?symbol=${encodeURIComponent(twelveDataSymbol)}`
    );
    if (!res.ok) return null;
    const data = await res.json();

    if (data && data.name && !data.code) {
      const isEtf = (data.type || '').toLowerCase().includes('etf') ||
                    (data.name || '').toLowerCase().includes('etf') ||
                    (data.name || '').toLowerCase().includes('ucits') ||
                    (data.name || '').toLowerCase().includes('ishares') ||
                    (data.name || '').toLowerCase().includes('vanguard');

      return {
        symbol: original,
        name: data.name,
        sector: data.sector || (isEtf ? 'Broad Index / ETF' : 'General'),
        country: data.country || 'Global',
        assetClass: isEtf ? 'etf' : 'stock',
        source: 'twelvedata',
      };
    }
  } catch (e) {
    // Ignore
  }

  return null;
}

// -------------------------------------------------------------
// CASCADE RUNNER (Finnhub -> TwelveData -> Yahoo)
// -------------------------------------------------------------

/**
 * Resolves a single quote following the 3-step priority cascade.
 */
export async function getCascadedQuote(symbol: string): Promise<MarketQuote> {
  if (quoteCache.has(symbol)) {
    return quoteCache.get(symbol)!;
  }

  // 1. Finnhub (primary)
  let quote = await fetchFinnhubQuote(symbol);

  // 2. TwelveData (fallback #1)
  if (!quote) {
    quote = await fetchTwelveDataQuote(symbol);
  }

  // 3. Yahoo Finance (fallback #2)
  if (!quote) {
    quote = await fetchYahooQuote(symbol);
  }

  // Graceful fallback if unavailable in all 3 sources
  const finalQuote: MarketQuote = quote || {
    symbol,
    price: 0,
    currency: 'EUR',
    source: 'unavailable',
    timestamp: Date.now(),
  };

  quoteCache.set(symbol, finalQuote);
  return finalQuote;
}

/**
 * Resolves security classification & profile following priority cascade.
 * TwelveData is prioritized for ETFs classification per requirements.
 */
export async function getCascadedProfile(
  symbol: string,
  instrumentName?: string
): Promise<SecurityProfile> {
  if (profileCache.has(symbol)) {
    return profileCache.get(symbol)!;
  }

  const nameToCheck = (instrumentName || symbol).toLowerCase();
  const isLikelyEtf =
    nameToCheck.includes('etf') ||
    nameToCheck.includes('ucits') ||
    nameToCheck.includes('ishares') ||
    nameToCheck.includes('vanguard') ||
    nameToCheck.includes('spdr') ||
    nameToCheck.includes('invesco') ||
    nameToCheck.includes('xtrackers') ||
    symbol.startsWith('VWCE') ||
    symbol.startsWith('CSPX') ||
    symbol.startsWith('IWDA') ||
    symbol.startsWith('VUSA');

  // If ETF, check TwelveData first for classification as requested
  if (isLikelyEtf) {
    const tdProfile = await fetchTwelveDataProfile(symbol);
    if (tdProfile) {
      tdProfile.assetClass = 'etf';
      profileCache.set(symbol, tdProfile);
      return tdProfile;
    }
  }

  // Finnhub primary for stocks
  const fhProfile = await fetchFinnhubProfile(symbol);
  if (fhProfile) {
    profileCache.set(symbol, fhProfile);
    return fhProfile;
  }

  // TwelveData fallback
  const tdProfile = await fetchTwelveDataProfile(symbol);
  if (tdProfile) {
    profileCache.set(symbol, tdProfile);
    return tdProfile;
  }

  // Default fallback profile
  const fallbackProfile: SecurityProfile = {
    symbol,
    name: instrumentName || symbol,
    sector: isLikelyEtf ? 'Index / Fund' : 'Not classified',
    country: symbol.includes('.US') ? 'United States' : (symbol.includes('.DE') ? 'Germany' : 'Global'),
    assetClass: isLikelyEtf ? 'etf' : 'stock',
    source: 'none',
  };

  profileCache.set(symbol, fallbackProfile);
  return fallbackProfile;
}

/**
 * Fetches historical candle / chart series for a given symbol
 */
export async function getHistoricalPrices(
  symbol: string,
  period: ChartPeriod | number = '1Y'
): Promise<{ date: string; price: number }[]> {
  const cacheKey = `${symbol.toUpperCase()}__${period}`;
  if (candleCache.has(cacheKey)) {
    return candleCache.get(cacheKey)!;
  }

  const { usClean, yahooSymbol, twelveDataSymbol } = normalizeSymbol(symbol);
  const now = Math.floor(Date.now() / 1000);
  
  let days = 365;
  let finnhubResolution = 'D';
  let yahooRange = '1y';
  let yahooInterval = '1d';
  let twelveInterval = '1day';
  let twelveOutputSize = 90;

  if (typeof period === 'number') {
    days = period;
  } else {
    switch (period) {
      case '1D':
        days = 2; // cover recent session
        finnhubResolution = '15';
        yahooRange = '1d';
        yahooInterval = '15m';
        twelveInterval = '15min';
        twelveOutputSize = 32;
        break;
      case '1W':
        days = 7;
        finnhubResolution = '60';
        yahooRange = '5d';
        yahooInterval = '60m';
        twelveInterval = '1day';
        twelveOutputSize = 7;
        break;
      case '2W':
        days = 14;
        finnhubResolution = 'D';
        yahooRange = '1mo';
        yahooInterval = '1d';
        twelveInterval = '1day';
        twelveOutputSize = 14;
        break;
      case '1M':
        days = 30;
        finnhubResolution = 'D';
        yahooRange = '1mo';
        yahooInterval = '1d';
        twelveInterval = '1day';
        twelveOutputSize = 30;
        break;
      case '3M':
        days = 90;
        finnhubResolution = 'D';
        yahooRange = '3mo';
        yahooInterval = '1d';
        twelveInterval = '1day';
        twelveOutputSize = 90;
        break;
      case 'YTD': {
        const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime();
        days = Math.max(7, Math.ceil((Date.now() - startOfYear) / (86400 * 1000)));
        finnhubResolution = 'D';
        yahooRange = 'ytd';
        yahooInterval = '1d';
        twelveInterval = '1day';
        twelveOutputSize = Math.min(days, 250);
        break;
      }
      case '1Y':
        days = 365;
        finnhubResolution = 'D';
        yahooRange = '1y';
        yahooInterval = '1d';
        twelveInterval = '1day';
        twelveOutputSize = 250;
        break;
      case '3Y':
        days = 1095;
        finnhubResolution = 'W';
        yahooRange = '3y';
        yahooInterval = '1wk';
        twelveInterval = '1week';
        twelveOutputSize = 160;
        break;
      case '5Y':
        days = 1825;
        finnhubResolution = 'W';
        yahooRange = '5y';
        yahooInterval = '1wk';
        twelveInterval = '1week';
        twelveOutputSize = 260;
        break;
      case 'All':
        days = 1825; // 5 years
        finnhubResolution = 'W';
        yahooRange = '5y';
        yahooInterval = '1wk';
        twelveInterval = '1week';
        twelveOutputSize = 260;
        break;
    }
  }

  const from = now - days * 86400;

  // 1. Try Finnhub candle
  try {
    const res = await fetchWithTimeout(
      `${FINNHUB_PROXY_BASE}/stock/candle?symbol=${encodeURIComponent(usClean)}&resolution=${finnhubResolution}&from=${from}&to=${now}`
    );
    if (res.ok) {
      const data = await res.json();
      if (data && data.s === 'ok' && Array.isArray(data.c) && data.c.length > 0) {
        const series = data.t.map((timestamp: number, i: number) => {
          const d = new Date(timestamp * 1000);
          const dateStr = period === '1D' 
            ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : d.toISOString().split('T')[0];
          return {
            date: dateStr,
            price: data.c[i],
          };
        });
        candleCache.set(cacheKey, series);
        return series;
      }
    }
  } catch (e) {
    // Continue
  }

  // 2. Try TwelveData time series
  try {
    const res = await fetchWithTimeout(
      `${TWELVEDATA_PROXY_BASE}/time_series?symbol=${encodeURIComponent(twelveDataSymbol)}&interval=${twelveInterval}&outputsize=${twelveOutputSize}`
    );
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.values)) {
        const series = data.values
          .map((v: any) => ({
            date: period === '1D' ? (v.datetime.split(' ')[1] || v.datetime) : v.datetime.split(' ')[0],
            price: parseFloat(v.close),
          }))
          .reverse();
        if (series.length > 0) {
          candleCache.set(cacheKey, series);
          return series;
        }
      }
    }
  } catch (e) {
    // Continue
  }

  // 3. Try Yahoo Finance chart
  try {
    let res: Response | null = null;
    try {
      res = await fetchWithTimeout(`/api/yahoo/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${yahooInterval}&range=${yahooRange}`);
    } catch (e) {}

    if (!res || !res.ok) {
      const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${yahooInterval}&range=${yahooRange}`;
      res = await fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`);
    }

    if (res && res.ok) {
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      const timestamps = result?.timestamp;
      const quotes = result?.indicators?.quote?.[0]?.close;

      if (Array.isArray(timestamps) && Array.isArray(quotes)) {
        const series: { date: string; price: number }[] = [];
        for (let i = 0; i < timestamps.length; i++) {
          if (quotes[i] !== null && quotes[i] !== undefined) {
            const d = new Date(timestamps[i] * 1000);
            const dateStr = period === '1D'
              ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : d.toISOString().split('T')[0];
            series.push({
              date: dateStr,
              price: quotes[i],
            });
          }
        }
        if (series.length > 0) {
          candleCache.set(cacheKey, series);
          return series;
        }
      }
    }
  } catch (e) {
    // Continue
  }

  return [];
}

/**
 * Fetches dividends from Finnhub for held symbols
 */
export async function getDividendsForHoldings(
  heldPositions: { symbol: string; quantity: number; name: string }[]
): Promise<DividendEvent[]> {
  const events: DividendEvent[] = [];
  const rates = await getForexRates();
  const currentYear = new Date().getFullYear();

  for (const pos of heldPositions) {
    const { usClean, original } = normalizeSymbol(pos.symbol);
    try {
      const from = `${currentYear - 1}-01-01`;
      const to = `${currentYear + 1}-12-31`;
      const res = await fetchWithTimeout(
        `${FINNHUB_PROXY_BASE}/stock/dividend?symbol=${encodeURIComponent(usClean)}&from=${from}&to=${to}`
      );
      if (!res.ok) continue;
      const list = await res.json();

      if (Array.isArray(list)) {
        list.forEach((item: any, idx: number) => {
          const amountPerShare = item.amount || 0;
          const currency = item.currency || inferCurrencyFromSymbol(original);
          const totalRaw = amountPerShare * pos.quantity;
          const totalEur = convertToEur(totalRaw, currency, rates);
          const payDate = item.payDate || item.date;
          const isUpcoming = payDate ? new Date(payDate) >= new Date() : false;

          events.push({
            id: `${pos.symbol}-${item.date}-${idx}`,
            symbol: pos.symbol,
            name: pos.name,
            exDate: item.date,
            payDate: item.payDate || item.date,
            amountPerShare,
            sharesHeld: pos.quantity,
            expectedAmountEur: totalEur,
            currency,
            isUpcoming,
          });
        });
      }
    } catch (e) {
      // Continue gracefully
    }
  }

  // Sort chronologically
  return events.sort((a, b) => new Date(b.payDate).getTime() - new Date(a.payDate).getTime());
}

/**
 * Fetches company news for held symbols ONLY
 */
export async function getHeldSymbolsNews(
  heldSymbols: string[]
): Promise<CompanyNewsArticle[]> {
  const articles: CompanyNewsArticle[] = [];
  const today = new Date().toISOString().split('T')[0];
  const pastMonth = new Date(Date.now() - 30 * 86400 * 1000).toISOString().split('T')[0];

  const uniqueSymbols = Array.from(new Set(heldSymbols)).slice(0, 6);

  for (const sym of uniqueSymbols) {
    const { usClean, original } = normalizeSymbol(sym);
    try {
      const res = await fetchWithTimeout(
        `${FINNHUB_PROXY_BASE}/company-news?symbol=${encodeURIComponent(usClean)}&from=${pastMonth}&to=${today}`
      );
      if (!res.ok) continue;
      const data = await res.json();

      if (Array.isArray(data)) {
        data.slice(0, 4).forEach((item: any) => {
          if (item.headline && item.url) {
            articles.push({
              id: String(item.id || `${sym}-${item.datetime}`),
              symbol: original,
              headline: item.headline,
              source: item.source || 'Market News',
              datetime: item.datetime ? item.datetime * 1000 : Date.now(),
              url: item.url,
              summary: item.summary || '',
              image: item.image,
            });
          }
        });
      }
    } catch (e) {
      // Continue
    }
  }

  // Sort newest first
  return articles.sort((a, b) => b.datetime - a.datetime);
}

/**
 * Clears market quote cache for manual on-demand refresh
 */
export function invalidateMarketCache(): void {
  quoteCache.clear();
  fxRatesCache.clear();
}

/**
 * Updates an array of positions with live market prices, forex rates, and classifications.
 * Runs in batches of 4 concurrent requests to prevent rate-limit throttling while dramatically speeding up imports.
 */
export async function updatePositionsWithLivePrices(
  positions: Position[],
  onProgress?: (completed: number, total: number) => void
): Promise<Position[]> {
  invalidateMarketCache();
  const rates = await getForexRates();

  const total = positions.length;
  let completed = 0;
  const updatedPositions: Position[] = new Array(total);

  const CONCURRENCY = 4;

  const processPosition = async (pos: Position, index: number): Promise<void> => {
    try {
      const quote = await getCascadedQuote(pos.symbol);

      let currentPrice = pos.currentPrice;
      let currentPriceEur = pos.currentPriceEur;
      let priceSource = pos.priceSource;
      let previousClose = pos.previousClose;
      let previousCloseEur = pos.previousCloseEur;

      if (quote.price > 0) {
        currentPrice = quote.price;
        currentPriceEur = convertToEur(quote.price, quote.currency, rates);
        priceSource = quote.source;
      }

      if (quote.previousClose && quote.previousClose > 0) {
        previousClose = quote.previousClose;
        previousCloseEur = convertToEur(quote.previousClose, quote.currency, rates);
      }

      const marketValueEur = pos.quantity * currentPriceEur;
      const unrealizedProfitEur = marketValueEur - pos.costBasisEur;
      const unrealizedProfitPct = pos.costBasisEur > 0 ? (unrealizedProfitEur / pos.costBasisEur) * 100 : 0;

      // Classify if missing or unclassified
      let sector = pos.sector;
      let country = pos.country;
      let assetClass = pos.assetClass;
      let classificationSource = pos.classificationSource;

      if (!sector || sector === 'Not classified' || !country) {
        const profile = await getCascadedProfile(pos.symbol, pos.name);
        if (profile) {
          sector = profile.sector;
          country = profile.country;
          assetClass = profile.assetClass;
          classificationSource = profile.source;
        }
      }

      updatedPositions[index] = {
        ...pos,
        currentPrice,
        currentPriceEur,
        previousClose,
        previousCloseEur,
        priceSource,
        marketValueEur,
        unrealizedProfitEur,
        unrealizedProfitPct,
        sector,
        country,
        assetClass,
        classificationSource,
      };
    } catch (err) {
      console.warn(`Failed to update live price for ${pos.symbol}:`, err);
      updatedPositions[index] = pos;
    } finally {
      completed++;
      if (onProgress) {
        onProgress(completed, total);
      }
    }
  };

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < positions.length; i += CONCURRENCY) {
    const chunk = positions.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map((pos, chunkIdx) => processPosition(pos, i + chunkIdx)));
  }

  return updatedPositions;
}

/**
 * Searches for instruments/tickers with live autocomplete.
 * First queries Finnhub's /search endpoint.
 * If Finnhub returns 0 matches or fails (common for European tickers/UCITS ETFs),
 * falls back to Yahoo Finance search endpoint via configured proxies.
 */
export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
  const clean = query.trim();
  if (clean.length < 2) return [];

  // 1. Try Finnhub Search
  try {
    const res = await fetchWithTimeout(
      `${FINNHUB_PROXY_BASE}/search?q=${encodeURIComponent(clean)}`
    );
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.result) && data.result.length > 0) {
        const finnhubMatches: SymbolSearchResult[] = data.result
          .filter((item: any) => item && (item.symbol || item.displaySymbol) && item.description)
          .slice(0, 10)
          .map((item: any) => {
            const sym = (item.displaySymbol || item.symbol || '').trim().toUpperCase();
            return {
              symbol: sym,
              displaySymbol: sym,
              description: item.description || sym,
              type: item.type || 'Stock',
              source: 'finnhub' as const,
            };
          });

        if (finnhubMatches.length > 0) {
          return finnhubMatches;
        }
      }
    }
  } catch (err) {
    console.warn('Finnhub symbol search error, falling back to Yahoo:', err);
  }

  // 2. Fallback to Yahoo Finance Search
  try {
    let res: Response | null = null;
    try {
      res = await fetchWithTimeout(
        `/api/yahoo/v1/finance/search?q=${encodeURIComponent(clean)}&quotesCount=10&newsCount=0`
      );
    } catch {
      // Dev proxy not available, will use CORS proxy
    }

    if (!res || !res.ok) {
      const targetUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(clean)}&quotesCount=10&newsCount=0`;
      res = await fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`);
    }

    if (res && res.ok) {
      const data = await res.json();
      const quotes = data?.quotes || [];
      const yahooMatches: SymbolSearchResult[] = quotes
        .filter((q: any) => q && q.symbol && (q.shortname || q.longname || q.symbol))
        .slice(0, 10)
        .map((q: any) => {
          const sym = q.symbol.trim().toUpperCase();
          const desc = q.longname || q.shortname || sym;
          return {
            symbol: sym,
            displaySymbol: sym,
            description: desc,
            type: q.typeDisp || q.quoteType || 'Instrument',
            source: 'yahoo' as const,
          };
        });

      return yahooMatches;
    }
  } catch (err) {
    console.warn('Yahoo symbol search error:', err);
  }

  return [];
}

