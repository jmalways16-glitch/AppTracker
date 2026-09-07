/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Position, PerformanceMetrics } from './types';
import { 
  subscribeToPositions, 
  savePositions, 
  clearAllPositions,
  loadPositions
} from './lib/storage';
import { updatePositionsWithLivePrices, clearCandleCache, subscribeForexStatus } from './lib/marketApi';
import { calculatePerformanceMetrics } from './lib/calculations';
import { 
  ManualPositionInput, 
  EditPositionInput, 
  addOrMergeManualPosition, 
  editManualPosition, 
  deletePositionById 
} from './lib/positionManager';
import { Navigation, NavTab } from './components/Navigation';
import { DashboardView } from './components/DashboardView';
import { HoldingsView } from './components/HoldingsView';
import { AllocationView } from './components/AllocationView';
import { DividendsView } from './components/DividendsView';
import { NewsView } from './components/NewsView';
import { ImportModal } from './components/ImportModal';
import { PwaInstallModal } from './components/PwaInstallModal';
import { RefreshCw, AlertCircle } from 'lucide-react';

export default function App() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isPwaGuideOpen, setIsPwaGuideOpen] = useState(false);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<string>('');
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);
  const [isLoadingStorage, setIsLoadingStorage] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [isForexStale, setIsForexStale] = useState<boolean>(false);

  // Subscribe to forex rate status (to alert if hardcoded emergency fallback is being used)
  useEffect(() => {
    const unsub = subscribeForexStatus((stale) => {
      setIsForexStale(stale);
    });
    return () => unsub();
  }, []);

  // Capture PWA install prompt for supported browsers
  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  // Listen to Firestore positions in real-time
  useEffect(() => {
    setIsLoadingStorage(true);
    const unsubscribe = subscribeToPositions(
      (loaded) => {
        setPositions(loaded);
        setIsLoadingStorage(false);
      },
      (err) => {
        console.error('Firestore subscription error:', err);
        setStorageError('Could not sync with Firestore. Please check your network.');
        setIsLoadingStorage(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  // Total Portfolio Value in EUR
  const totalPortfolioValueEur = useMemo(() => {
    return positions.reduce((sum, p) => sum + p.marketValueEur, 0);
  }, [positions]);

  // Performance calculations
  const metrics: PerformanceMetrics = useMemo(() => {
    return calculatePerformanceMetrics(positions);
  }, [positions]);

  // Held symbols array for news and dividends
  const heldSymbols = useMemo(() => {
    return Array.from(new Set(positions.map((p) => p.symbol)));
  }, [positions]);

  // Manual Market Data Refresh
  const handleRefreshMarketData = useCallback(async () => {
    if (positions.length === 0 || isRefreshingPrices) return;
    setIsRefreshingPrices(true);
    setStorageError(null);

    try {
      clearCandleCache();
      const updated = await updatePositionsWithLivePrices(positions);
      setPositions(updated);
      await savePositions(updated, 'replace');
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastRefreshTime(timeStr);
    } catch (err: any) {
      console.warn('Market price update error:', err);
      setStorageError(err?.message || 'Failed to update live market data or sync with cloud.');
    } finally {
      setIsRefreshingPrices(false);
    }
  }, [positions, isRefreshingPrices]);

  // Import handler
  const handleConfirmImport = async (
    imported: Position[],
    mode: 'replace' | 'merge',
    onProgress?: (current: number, total: number) => void,
    onStatusChange?: (status: 'fetching_prices' | 'saving_firestore') => void
  ) => {
    setIsRefreshingPrices(true);
    setStorageError(null);
    try {
      clearCandleCache();
      if (onStatusChange) onStatusChange('fetching_prices');
      // Enrich with live prices from Finnhub / Yahoo / TwelveData with limited concurrency
      const enriched = await updatePositionsWithLivePrices(imported, onProgress);
      
      if (onStatusChange) onStatusChange('saving_firestore');
      await savePositions(enriched, mode);
      setLastRefreshTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err: any) {
      console.error('Save positions error:', err);
      setStorageError(err?.message || 'Failed to save imported positions to Firestore cloud.');
      throw err;
    } finally {
      setIsRefreshingPrices(false);
    }
  };

  // Demo sample loader
  const handleLoadSampleData = async () => {
    const samplePositions: Position[] = [
      {
        id: 'pos-vwce-sample',
        symbol: 'VWCE.DE',
        displaySymbol: 'VWCE',
        name: 'Vanguard FTSE All-World UCITS ETF (USD) Accumulating',
        quantity: 35,
        openPrice: 104.5,
        currency: 'EUR',
        openTime: '2024-01-15T10:20:00.000Z',
        lots: [
          {
            id: 'lot-vwce-1',
            type: 'buy',
            quantity: 35,
            price: 104.5,
            priceEur: 104.5,
            currency: 'EUR',
            date: '2024-01-15T10:20:00.000Z',
            valueEur: 35 * 104.5,
            source: 'manual',
          },
        ],
        openPriceEur: 104.5,
        currentPrice: 122.3,
        currentPriceEur: 122.3,
        marketValueEur: 35 * 122.3,
        costBasisEur: 35 * 104.5,
        unrealizedProfitEur: 35 * (122.3 - 104.5),
        unrealizedProfitPct: ((122.3 - 104.5) / 104.5) * 100,
        priceSource: 'finnhub',
        classificationSource: 'twelvedata',
        assetClass: 'etf',
        sector: 'Index / Fund',
        country: 'Global',
      },
      {
        id: 'pos-aapl-sample',
        symbol: 'AAPL.US',
        displaySymbol: 'AAPL',
        name: 'Apple Inc.',
        quantity: 18,
        openPrice: 178.5,
        currency: 'USD',
        openTime: '2024-02-20T15:45:00.000Z',
        lots: [
          {
            id: 'lot-aapl-1',
            type: 'buy',
            quantity: 18,
            price: 178.5,
            priceEur: 178.5 / 1.08,
            currency: 'USD',
            date: '2024-02-20T15:45:00.000Z',
            valueEur: 18 * (178.5 / 1.08),
            source: 'manual',
          },
        ],
        openPriceEur: 178.5 / 1.08,
        currentPrice: 228.4,
        currentPriceEur: 228.4 / 1.08,
        marketValueEur: 18 * (228.4 / 1.08),
        costBasisEur: 18 * (178.5 / 1.08),
        unrealizedProfitEur: 18 * ((228.4 - 178.5) / 1.08),
        unrealizedProfitPct: ((228.4 - 178.5) / 178.5) * 100,
        priceSource: 'finnhub',
        classificationSource: 'finnhub',
        assetClass: 'stock',
        sector: 'Technology',
        country: 'United States',
      },
      {
        id: 'pos-msft-sample',
        symbol: 'MSFT.US',
        displaySymbol: 'MSFT',
        name: 'Microsoft Corporation',
        quantity: 10,
        openPrice: 395.0,
        currency: 'USD',
        openTime: '2024-03-12T16:10:00.000Z',
        lots: [
          {
            id: 'lot-msft-1',
            type: 'buy',
            quantity: 10,
            price: 395.0,
            priceEur: 395.0 / 1.08,
            currency: 'USD',
            date: '2024-03-12T16:10:00.000Z',
            valueEur: 10 * (395.0 / 1.08),
            source: 'manual',
          },
        ],
        openPriceEur: 395.0 / 1.08,
        currentPrice: 442.5,
        currentPriceEur: 442.5 / 1.08,
        marketValueEur: 10 * (442.5 / 1.08),
        costBasisEur: 10 * (395.0 / 1.08),
        unrealizedProfitEur: 10 * ((442.5 - 395.0) / 1.08),
        unrealizedProfitPct: ((442.5 - 395.0) / 395.0) * 100,
        priceSource: 'finnhub',
        classificationSource: 'finnhub',
        assetClass: 'stock',
        sector: 'Technology',
        country: 'United States',
      },
      {
        id: 'pos-nvda-sample',
        symbol: 'NVDA.US',
        displaySymbol: 'NVDA',
        name: 'NVIDIA Corporation',
        quantity: 25,
        openPrice: 95.2,
        currency: 'USD',
        openTime: '2024-04-18T14:30:00.000Z',
        lots: [
          {
            id: 'lot-nvda-1',
            type: 'buy',
            quantity: 25,
            price: 95.2,
            priceEur: 95.2 / 1.08,
            currency: 'USD',
            date: '2024-04-18T14:30:00.000Z',
            valueEur: 25 * (95.2 / 1.08),
            source: 'manual',
          },
        ],
        openPriceEur: 95.2 / 1.08,
        currentPrice: 126.8,
        currentPriceEur: 126.8 / 1.08,
        marketValueEur: 25 * (126.8 / 1.08),
        costBasisEur: 25 * (95.2 / 1.08),
        unrealizedProfitEur: 25 * ((126.8 - 95.2) / 1.08),
        unrealizedProfitPct: ((126.8 - 95.2) / 95.2) * 100,
        priceSource: 'finnhub',
        classificationSource: 'finnhub',
        assetClass: 'stock',
        sector: 'Semiconductors',
        country: 'United States',
      },
      {
        id: 'pos-qdve-sample',
        symbol: 'QDVE.DE',
        displaySymbol: 'QDVE',
        name: 'iShares S&P 500 Information Technology Sector UCITS ETF',
        quantity: 50,
        openPrice: 22.1,
        currency: 'EUR',
        openTime: '2024-05-10T11:00:00.000Z',
        lots: [
          {
            id: 'lot-qdve-1',
            type: 'buy',
            quantity: 50,
            price: 22.1,
            priceEur: 22.1,
            currency: 'EUR',
            date: '2024-05-10T11:00:00.000Z',
            valueEur: 50 * 22.1,
            source: 'manual',
          },
        ],
        openPriceEur: 22.1,
        currentPrice: 27.4,
        currentPriceEur: 27.4,
        marketValueEur: 50 * 27.4,
        costBasisEur: 50 * 22.1,
        unrealizedProfitEur: 50 * (27.4 - 22.1),
        unrealizedProfitPct: ((27.4 - 22.1) / 22.1) * 100,
        priceSource: 'yahoo',
        classificationSource: 'none',
        assetClass: 'etf',
        sector: 'Information Technology',
        country: 'United States',
      },
      {
        id: 'pos-sap-sample',
        symbol: 'SAP.DE',
        displaySymbol: 'SAP',
        name: 'SAP SE',
        quantity: 12,
        openPrice: 168.0,
        currency: 'EUR',
        openTime: '2024-06-05T09:15:00.000Z',
        lots: [
          {
            id: 'lot-sap-1',
            type: 'buy',
            quantity: 12,
            price: 168.0,
            priceEur: 168.0,
            currency: 'EUR',
            date: '2024-06-05T09:15:00.000Z',
            valueEur: 12 * 168.0,
            source: 'manual',
          },
        ],
        openPriceEur: 168.0,
        currentPrice: 198.5,
        currentPriceEur: 198.5,
        marketValueEur: 12 * 198.5,
        costBasisEur: 12 * 168.0,
        unrealizedProfitEur: 12 * (198.5 - 168.0),
        unrealizedProfitPct: ((198.5 - 168.0) / 168.0) * 100,
        priceSource: 'twelvedata',
        classificationSource: 'twelvedata',
        assetClass: 'stock',
        sector: 'Enterprise Software',
        country: 'Germany',
      }
    ];

    try {
      clearCandleCache();
      await savePositions(samplePositions, 'replace');
      setLastRefreshTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err: any) {
      console.error('Save sample data error:', err);
      setStorageError(err?.message || 'Failed to save sample data to Firestore cloud.');
    }
  };

  const handleAddOrMergePosition = async (input: ManualPositionInput) => {
    setIsRefreshingPrices(true);
    try {
      const updated = await addOrMergeManualPosition(positions, input);
      setPositions(updated);
      setLastRefreshTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err: any) {
      console.error('Error adding/merging position:', err);
      setStorageError(err?.message || 'Failed to save position to Firestore cloud.');
      throw err;
    } finally {
      setIsRefreshingPrices(false);
    }
  };

  const handleEditPosition = async (input: EditPositionInput) => {
    setIsRefreshingPrices(true);
    try {
      const updated = await editManualPosition(positions, input);
      setPositions(updated);
      setLastRefreshTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err: any) {
      console.error('Error updating position:', err);
      setStorageError(err?.message || 'Failed to update position in Firestore cloud.');
      throw err;
    } finally {
      setIsRefreshingPrices(false);
    }
  };

  const handleDeletePosition = async (id: string) => {
    setIsRefreshingPrices(true);
    try {
      const updated = await deletePositionById(positions, id);
      setPositions(updated);
      setLastRefreshTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err: any) {
      console.error('Error deleting position:', err);
      setStorageError(err?.message || 'Failed to delete position from Firestore cloud.');
      throw err;
    } finally {
      setIsRefreshingPrices(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-[#111827] flex flex-col font-sans selection:bg-[#2563EB] selection:text-white pb-[calc(5rem+env(safe-area-inset-bottom,0px))]">
      
      {/* Top Header & Navigation */}
      <Navigation
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenImport={() => setIsImportOpen(true)}
        onRefreshMarketData={handleRefreshMarketData}
        isRefreshing={isRefreshingPrices}
        lastRefreshTime={lastRefreshTime}
        onOpenPwaGuide={() => setIsPwaGuideOpen(true)}
        isCloudSynced={!isLoadingStorage && !storageError}
        positionsCount={positions.length}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        
        {storageError && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-sm text-xs text-red-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <span>{storageError}</span>
            </div>
            <button
              onClick={() => setStorageError(null)}
              className="text-red-900 font-medium hover:underline text-[11px] cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {isForexStale && (
          <div className="mb-6 p-3 bg-amber-50 border border-amber-300 rounded-sm text-xs text-amber-900 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Taxas de câmbio desatualizadas:</strong> As fontes em tempo real (Finnhub, Frankfurter, Yahoo) falharam. A utilizar taxas de emergência (EUR/USD=1.08) — os totais e conversões em moeda estrangeira podem estar incorretos.
              </span>
            </div>
            <button
              onClick={() => handleRefreshMarketData()}
              className="ml-3 shrink-0 px-2 py-1 bg-amber-200 hover:bg-amber-300 text-amber-950 font-medium rounded-xs text-[11px] cursor-pointer transition-colors"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Tab Views */}
        {activeTab === 'dashboard' && (
          <DashboardView
            positions={positions}
            metrics={metrics}
            onOpenImport={() => setIsImportOpen(true)}
            onLoadSampleData={handleLoadSampleData}
            lastRefreshTime={lastRefreshTime}
          />
        )}

        {activeTab === 'holdings' && (
          <HoldingsView
            positions={positions}
            totalPortfolioValueEur={totalPortfolioValueEur}
            onAddOrMergePosition={handleAddOrMergePosition}
            onEditPosition={handleEditPosition}
            onDeletePosition={handleDeletePosition}
            onOpenImport={() => setIsImportOpen(true)}
          />
        )}

        {activeTab === 'allocation' && (
          <AllocationView
            positions={positions}
            totalPortfolioValueEur={totalPortfolioValueEur}
          />
        )}

        {activeTab === 'dividends' && (
          <DividendsView
            positions={positions}
            totalPortfolioValueEur={totalPortfolioValueEur}
          />
        )}

        {activeTab === 'news' && (
          <NewsView heldSymbols={heldSymbols} />
        )}

      </main>

      {/* Import Modal */}
      <ImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onConfirmImport={handleConfirmImport}
        existingPositionsCount={positions.length}
      />

      {/* PWA Install Safari Guide Modal */}
      <PwaInstallModal
        isOpen={isPwaGuideOpen}
        onClose={() => setIsPwaGuideOpen(false)}
        deferredPrompt={deferredInstallPrompt}
      />

    </div>
  );
}
