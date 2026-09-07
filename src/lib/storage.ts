import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { getAppFirestore, ensureAnonymousAuth } from './firebase';
import { CloudPortfolioRecord, Position } from '../types';

export interface CloudFetchResult {
  data: CloudPortfolioRecord;
  source: 'firestore';
  userId: string;
}

/**
 * Fetches current portfolio directly from Firestore cloud.
 * Never uses localStorage as source of truth.
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

      return {
        data: {
          positions: parsedPositions,
          updatedAt: data.updatedAt || new Date().toISOString(),
          importedAt: data.importedAt,
          lastMarketRefresh: data.lastMarketRefresh,
        },
        source: 'firestore',
        userId: user.uid,
      };
    } else {
      // New user or empty portfolio
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
    console.error('Firestore direct fetch error:', error);
    throw new Error(
      error?.message || 'Could not connect to Firestore cloud store. Please check network or retry.'
    );
  }
}

/**
 * Persists updated portfolio state directly to Firestore cloud.
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
    console.error('Firestore direct write failed:', error);
    throw new Error(
      error?.message || 'Failed to save portfolio to Firestore. Cloud write rejected.'
    );
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
            onSuccess(parsedPositions);
          } else {
            onSuccess([]);
          }
        },
        (err) => {
          console.error('Firestore snapshot error:', err);
          if (onError) onError(err);
        }
      );
    })
    .catch((authErr) => {
      console.error('Auth error during subscribeToPositions:', authErr);
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
 */
export async function savePositions(
  newPositions: Position[],
  mode: 'replace' | 'merge' = 'replace'
): Promise<void> {
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
}

/**
 * Clears all positions from the cloud portfolio.
 */
export async function clearAllPositions(): Promise<void> {
  await savePortfolioToFirestore([]);
}
