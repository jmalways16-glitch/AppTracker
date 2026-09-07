const functions = require('firebase-functions');
const fetch = require('node-fetch');

/**
 * Cloud Function: Authenticated Proxy for Finnhub
 * Secrets are configured in Firebase Functions environment (FINNHUB_TOKEN)
 */
exports.finnhubProxy = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).send('');
  }

  const token = process.env.FINNHUB_TOKEN || (functions.config().finnhub && functions.config().finnhub.token);
  const endpoint = req.query.endpoint || req.path.replace(/^\//, '');
  
  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint parameter' });
  }

  // Fail fast and loud instead of silently forwarding a tokenless request to Finnhub
  // (which returns a generic 401 that's hard to distinguish from other auth issues).
  if (!token) {
    console.error('[finnhubProxy] FINNHUB_TOKEN não está configurado nas variáveis de ambiente / functions config.');
    return res.status(401).json({ error: 'Finnhub token não configurado no servidor (FINNHUB_TOKEN em falta)' });
  }

  const params = new URLSearchParams(req.query);
  params.delete('endpoint');
  params.set('token', token);

  const targetUrl = `https://finnhub.io/api/v1/${endpoint}?${params.toString()}`;

  try {
    const apiRes = await fetch(targetUrl);
    const data = await apiRes.json();
    return res.status(apiRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Finnhub proxy error' });
  }
});

/**
 * Cloud Function: Authenticated Proxy for TwelveData
 * Secrets are configured in Firebase Functions environment (TWELVEDATA_KEY)
 */
exports.twelveDataProxy = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).send('');
  }

  const apikey = process.env.TWELVEDATA_KEY || (functions.config().twelvedata && functions.config().twelvedata.key);
  const endpoint = req.query.endpoint || req.path.replace(/^\//, '');

  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint parameter' });
  }

  const params = new URLSearchParams(req.query);
  params.delete('endpoint');
  if (apikey) {
    params.set('apikey', apikey);
  }

  const targetUrl = `https://api.twelvedata.com/${endpoint}?${params.toString()}`;

  try {
    const apiRes = await fetch(targetUrl);
    const data = await apiRes.json();
    return res.status(apiRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'TwelveData proxy error' });
  }
});
