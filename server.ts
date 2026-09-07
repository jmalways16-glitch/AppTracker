import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Read API keys safely on the server side ONLY (never sent to browser)
  const FINNHUB_TOKEN = process.env.FINNHUB_TOKEN || process.env.VITE_FINNHUB_TOKEN || '';
  const TWELVEDATA_KEY = process.env.TWELVEDATA_KEY || process.env.VITE_TWELVEDATA_KEY || '';

  app.use(express.json());

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      finnhubConfigured: Boolean(FINNHUB_TOKEN),
      twelveDataConfigured: Boolean(TWELVEDATA_KEY),
    });
  });

  // 1. Finnhub Authenticated Proxy
  // Example: /api/market/finnhub/quote?symbol=AAPL
  app.get('/api/market/finnhub/*', async (req, res) => {
    const subPath = req.params[0] || '';
    if (!subPath) {
      return res.status(400).json({ error: 'Missing Finnhub endpoint path' });
    }

    const queryParams = new URLSearchParams(req.query as Record<string, string>);
    if (FINNHUB_TOKEN) {
      queryParams.set('token', FINNHUB_TOKEN);
    }

    const targetUrl = `https://finnhub.io/api/v1/${subPath}?${queryParams.toString()}`;

    try {
      const apiRes = await fetch(targetUrl);
      const contentType = apiRes.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await apiRes.json();
        return res.status(apiRes.status).json(data);
      }
      const text = await apiRes.text();
      return res.status(apiRes.status).send(text);
    } catch (err: any) {
      console.error('Finnhub proxy error:', err);
      return res.status(502).json({ error: 'Failed to contact Finnhub API' });
    }
  });

  // 2. TwelveData Authenticated Proxy
  // Example: /api/market/twelvedata/time_series?symbol=AAPL&interval=1day
  app.get('/api/market/twelvedata/*', async (req, res) => {
    const subPath = req.params[0] || '';
    if (!subPath) {
      return res.status(400).json({ error: 'Missing TwelveData endpoint path' });
    }

    const queryParams = new URLSearchParams(req.query as Record<string, string>);
    if (TWELVEDATA_KEY) {
      queryParams.set('apikey', TWELVEDATA_KEY);
    }

    const targetUrl = `https://api.twelvedata.com/${subPath}?${queryParams.toString()}`;

    try {
      const apiRes = await fetch(targetUrl);
      const contentType = apiRes.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await apiRes.json();
        return res.status(apiRes.status).json(data);
      }
      const text = await apiRes.text();
      return res.status(apiRes.status).send(text);
    } catch (err: any) {
      console.error('TwelveData proxy error:', err);
      return res.status(502).json({ error: 'Failed to contact TwelveData API' });
    }
  });

  // 3. Yahoo Finance Proxy
  // Example: /api/yahoo/v8/finance/chart/AAPL?interval=1d&range=5d
  app.get('/api/yahoo/*', async (req, res) => {
    const subPath = req.params[0] || '';
    const queryParams = new URLSearchParams(req.query as Record<string, string>).toString();
    const targetUrl = `https://query1.finance.yahoo.com/${subPath}${queryParams ? `?${queryParams}` : ''}`;

    try {
      const apiRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });
      const data = await apiRes.json();
      return res.status(apiRes.status).json(data);
    } catch (err: any) {
      console.error('Yahoo proxy error:', err);
      return res.status(502).json({ error: 'Failed to contact Yahoo API' });
    }
  });

  // 4. Vite middleware or production static files
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
