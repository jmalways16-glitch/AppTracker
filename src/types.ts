export type MarketDataSource = 'finnhub' | 'yahoo' | 'twelvedata' | 'xtb' | 'unavailable';
export type ClassificationSource = 'finnhub' | 'yahoo' | 'twelvedata' | 'none';
export type AssetClass = 'stock' | 'etf' | 'crypto' | 'commodity' | 'unknown';

export interface PositionLot {
  id: string;
  type: 'buy' | 'sell';
  quantity: number;
  price: number;        // preço na moeda nativa do instrumento
  priceEur: number;      // preço convertido para EUR à taxa de câmbio ATUAL (aproximação, não histórica)
  currency: string;
  date: string;           // ISO 8601
  valueEur: number;       // quantity * priceEur
  source: 'getquin' | 'xtb' | 'manual';
}

export interface Position {
  id: string;
  symbol: string;           // E.g. "VWCE.DE", "AAPL.US", "NVDA"
  displaySymbol: string;    // Clean display ticker without exchange suffix if needed
  name: string;
  quantity: number;
  openPrice: number;        // In asset currency
  currency: string;         // E.g. "EUR", "USD", "GBP"
  openTime: string;         // ISO string YYYY-MM-DDTHH:mm:ss
  
  // Mandatory lots array
  lots: PositionLot[];

  // EUR converted values (single source of truth for portfolio metrics)
  openPriceEur: number;
  currentPrice: number;     // In asset currency
  currentPriceEur: number;  // In EUR
  previousClose?: number;   // In asset currency
  previousCloseEur?: number;// In EUR
  marketValueEur: number;   // quantity * currentPriceEur
  costBasisEur: number;     // derived from lots
  unrealizedProfitEur: number; // marketValueEur - costBasisEur
  unrealizedProfitPct: number; // ((marketValueEur - costBasisEur) / costBasisEur) * 100

  // Metadata & Sources
  priceSource: MarketDataSource;
  classificationSource: ClassificationSource;
  assetClass: AssetClass;
  sector: string;
  country: string;
  marketCap?: number | null;
  dayChangePct?: number;
}

export type ChartPeriod = '1D' | '1W' | '2W' | '1M' | '3M' | 'YTD' | '1Y' | '3Y' | '5Y' | 'All';

export interface MarketQuote {
  symbol: string;
  price: number;
  currency: string;
  source: MarketDataSource;
  timestamp: number;
  previousClose?: number;
  dayChange?: number;
  dayChangePct?: number;
}

export interface EtfConstituent {
  symbol: string;
  name: string;
  weightPct: number; // percentage inside the ETF, e.g. 3.8 for 3.8%
}

export interface EtfOverlapItem {
  symbol: string;
  name: string;
  combinedWeightPct: number;
  directWeightPct: number;
  isDirectHolding: boolean;
  etfs: {
    etfSymbol: string;
    etfName: string;
    weightInsideEtfPct: number;
    contributionPct: number;
  }[];
}

export interface SecurityProfile {
  symbol: string;
  name: string;
  sector: string;
  country: string;
  assetClass: AssetClass;
  marketCap?: number | null;
  logo?: string;
  source: ClassificationSource;
}

export interface DividendEvent {
  id: string;
  symbol: string;
  name: string;
  exDate: string;
  payDate: string;
  amountPerShare: number;
  sharesHeld: number;
  expectedAmountEur: number;
  currency: string;
  isUpcoming: boolean;
}

export interface CompanyNewsArticle {
  id: string;
  symbol: string;
  headline: string;
  source: string;
  datetime: number;
  url: string;
  summary: string;
  image?: string;
}

export interface PortfolioHistoryPoint {
  date: string;          // YYYY-MM-DD
  timestamp: number;
  portfolioValueEur: number;
  costBasisEur: number;
  gainPct: number;
  isPurchase?: boolean;
  purchaseSymbol?: string;
  purchaseGainPct?: number;
  purchaseAmountEur?: number;
}

export interface PerformanceMetrics {
  xirr: number;          // Annualized money-weighted return in %
  twr: number;           // Time-weighted return in %
  annualizedVolatility: number; // %
  maxDrawdown: number;   // %
  totalInvestedEur: number;
  currentValueEur: number;
  totalReturnEur: number;
  totalReturnPct: number;
  bestPosition: { symbol: string; name: string; profitPct: number } | null;
  worstPosition: { symbol: string; name: string; profitPct: number } | null;
}

export interface BenchmarkComparisonPoint {
  date: string;
  portfolioPct: number;
  benchmarkPct: number;
}

// A single chart point carrying the portfolio's cumulative % plus one dynamic
// key per active benchmark (e.g. "SPY": 3.09, "QQQ": 7.2), so any number of
// benchmarks can be plotted together on the same axis.
export interface MultiBenchmarkPoint {
  date: string;
  portfolioPct: number;
  [benchmarkKey: string]: number | string;
}

export interface PortfolioHistoryResult {
  points: PortfolioHistoryPoint[];
  hasMissingData: boolean;
  missingSymbols: string[];
}

export type BenchmarkKey = 'SPY' | 'VWCE' | 'QQQ';

export interface ColumnMapping {
  symbolCol: string;
  nameCol?: string;
  quantityCol: string;
  openPriceCol: string;
  openTimeCol: string;
  currentPriceCol?: string;
  profitCol?: string;
  currencyCol?: string;
}

export interface RawParsedRow {
  rowIndex: number;
  raw: Record<string, any>;
  symbol: string;
  name: string;
  quantity: number;
  openPrice: number;
  openTime: string;
  currentPrice?: number;
  currency: string;
  isValid: boolean;
  warning?: string;
  skip?: boolean;
}

export interface CloudPortfolioRecord {
  positions: Position[];
  updatedAt: string;
  importedAt?: string;
  lastMarketRefresh?: string;
}

export interface SymbolSearchResult {
  symbol: string;
  displaySymbol?: string;
  description: string;
  type?: string;
  source: 'finnhub' | 'yahoo';
}

