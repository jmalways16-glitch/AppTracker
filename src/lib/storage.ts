import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { getAppFirestore, ensureAnonymousAuth } from './firebase';
import { CloudPortfolioRecord, Position } from '../types';

export interface CloudFetchResult {
  data: CloudPortfolioRecord;
  source: 'firestore';
  userId: string;
}

const LOCAL_CACHE_KEY = 'xtb_portfolio_local_cache';

function getLocalCache(): CloudPortfolioRecord | null {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setLocalCache(record: CloudPortfolioRecord): void {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(record));
  } catch {
    // Ignore quota errors
  }
}

/**
 * Fetches current portfolio directly from Firestore cloud with local cache fallback.
 */
export async function fetchPortfolioFromFirestore(): Promise<CloudFetchResult> {
  try {
    const user = await ensureAnonymousAuth();
    const db = getAppFirestore();
    const portfolioDocRef = doc(db, 'portfolios', user.uid);
    
    // Attempt Firestore getDoc
    const docSnap = await getDoc(portfolioDocRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      const parsedPositions: Position[] = typeof data.positions === 'string' 
        ? JSON.parse(data.positions) 
        : (data.positions || []);

      const record: CloudPortfolioRecord = {
        positions: parsedPositions,
        updatedAt: data.updatedAt || new Date().toISOString(),
        importedAt: data.importedAt,
        lastMarketRefresh: data.lastMarketRefresh,
      };
      setLocalCache(record);

      return {
        data: record,
        source: 'firestore',
        userId: user.uid,
      };
    } else {
      // Check local cache if cloud doc doesn't exist yet
      const local = getLocalCache();
      if (local && local.positions.length > 0) {
        return {
          data: local,
          source: 'firestore',
          userId: user.uid,
        };
      }

      return {
        data: {
          positions: [],
          updatedAt: new Date().toISOString(),
        },
        source: 'firestore',
        userId: user.uid,
      };
    }
  } catch (error: any) {
    console.warn('Firestore direct fetch notice (using cache fallback):', error?.message || error);
    const local = getLocalCache();
    return {
      data: local || {
        positions: [],
        updatedAt: new Date().toISOString(),
      },
      source: 'firestore',
      userId: 'offline_user',
    };
  }
}

/**
 * Persists updated portfolio state directly to Firestore cloud and local mirror.
 */
export async function savePortfolioToFirestore(
  positions: Position[],
  meta?: { importedAt?: string; lastMarketRefresh?: string }
): Promise<CloudPortfolioRecord> {
  const updatedAt = new Date().toISOString();
  const record: CloudPortfolioRecord = {
    positions,
    updatedAt,
    importedAt: meta?.importedAt,
    lastMarketRefresh: meta?.lastMarketRefresh,
  };

  // Always mirror immediately to local cache for instant zero-loss recovery
  setLocalCache(record);

  try {
    const user = await ensureAnonymousAuth();
    const db = getAppFirestore();
    const portfolioDocRef = doc(db, 'portfolios', user.uid);

    await setDoc(portfolioDocRef, {
      userId: user.uid,
      positions: JSON.stringify(positions),
      updatedAt,
      importedAt: meta?.importedAt || null,
      lastMarketRefresh: meta?.lastMarketRefresh || null,
    }, { merge: true });

    return record;
  } catch (error: any) {
    console.warn('Firestore write warning, persisted to local cache:', error?.message || error);
    return record;
  }
}

/**
 * Subscribes to the user's positions in Firestore in real-time.
 * Returns an unsubscribe callback.
 */
export function subscribeToPositions(
  onSuccess: (positions: Position[]) => void,
  onError?: (error: any) => void
): () => void {
  let isUnsubscribed = false;
  let unsubscribeSnapshot: (() => void) | null = null;

  // Immediate prime from local cache for instant rendering
  const localCached = getLocalCache();
  if (localCached && localCached.positions.length > 0) {
    onSuccess(localCached.positions);
  }

  ensureAnonymousAuth()
    .then((user) => {
      if (isUnsubscribed) return;
      const db = getAppFirestore();
      const portfolioDocRef = doc(db, 'portfolios', user.uid);

      unsubscribeSnapshot = onSnapshot(
        portfolioDocRef,
        (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            const parsedPositions: Position[] = typeof data.positions === 'string'
              ? JSON.parse(data.positions)
              : (data.positions || []);
            setLocalCache({
              positions: parsedPositions,
              updatedAt: data.updatedAt || new Date().toISOString(),
              importedAt: data.importedAt,
              lastMarketRefresh: data.lastMarketRefresh,
            });
            onSuccess(parsedPositions);
          } else {
            // Only set to empty if local cache doesn't have existing user positions
            const local = getLocalCache();
            if (!local || local.positions.length === 0) {
              onSuccess([]);
            }
          }
        },
        (err) => {
          console.warn('Firestore snapshot subscription notice:', err?.message || err);
          if (onError) onError(err);
        }
      );
    })
    .catch((authErr) => {
      console.warn('Auth subscription notice:', authErr?.message || authErr);
      if (onError) onError(authErr);
    });

  return () => {
    isUnsubscribed = true;
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
    }
  };
}

/**
 * Loads current positions from cloud storage once.
 */
export async function loadPositions(): Promise<Position[]> {
  const result = await fetchPortfolioFromFirestore();
  return result.data.positions;
}

/**
 * Saves positions to cloud storage (replace or merge).
 * Returns the final consolidated positions list.
 */
export async function savePositions(
  newPositions: Position[],
  mode: 'replace' | 'merge' = 'replace'
): Promise<Position[]> {
  let finalPositions = newPositions;

  if (mode === 'merge') {
    const existing = await loadPositions();
    const existingMap = new Map<string, Position>();
    existing.forEach((p) => existingMap.set(p.symbol, p));

    newPositions.forEach((p) => {
      if (existingMap.has(p.symbol)) {
        // Average the position quantities
        const curr = existingMap.get(p.symbol)!;
        const totalQty = curr.quantity + p.quantity;
        const totalCostEur = curr.costBasisEur + p.costBasisEur;
        const avgBuyEur = totalQty > 0 ? totalCostEur / totalQty : curr.openPriceEur;
        
        existingMap.set(p.symbol, {
          ...p,
          quantity: totalQty,
          openPriceEur: avgBuyEur,
          costBasisEur: totalCostEur,
          marketValueEur: totalQty * p.currentPriceEur,
          unrealizedProfitEur: (totalQty * p.currentPriceEur) - totalCostEur,
          unrealizedProfitPct: totalCostEur > 0 ? (((totalQty * p.currentPriceEur) - totalCostEur) / totalCostEur) * 100 : 0,
        });
      } else {
        existingMap.set(p.symbol, p);
      }
    });

    finalPositions = Array.from(existingMap.values());
  }

  await savePortfolioToFirestore(finalPositions, {
    importedAt: new Date().toISOString(),
  });

  return finalPositions;
}

/**
 * Clears all positions from the cloud portfolio.
 */
export async function clearAllPositions(): Promise<Position[]> {
  await savePortfolioToFirestore([]);
  return [];
}
