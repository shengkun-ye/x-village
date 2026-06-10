#!/usr/bin/env node
/**
 * Audience Craft — local server + Monid proxy.
 *
 * Serves the static artifact and proxies data requests to monid.ai so the
 * API key never reaches the browser.
 *
 * Usage:
 *   MONID_API_KEY=mk_... node server.js [port]
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const MONID_API_KEY = process.env.MONID_API_KEY || '';
const MONID_BASE = process.env.MONID_API_BASE_URL || 'https://api.monid.ai';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function monidRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(MONID_BASE + urlPath);
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(url, {
      method,
      headers: {
        Authorization: `Bearer ${MONID_API_KEY}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, json: { error: { message: data.slice(0, 500) } } }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start a Monid run and poll it to completion. */
async function runEndpoint(provider, endpoint, input) {
  const start = await monidRequest('POST', '/v1/run', { provider, endpoint, input });
  if (start.status >= 400) {
    throw new Error(start.json?.error?.message || start.json?.message || `Monid run failed (HTTP ${start.status})`);
  }
  let run = start.json;
  const deadline = Date.now() + 120000;
  while (run.status === 'RUNNING' || run.status === 'PENDING') {
    if (Date.now() > deadline) throw new Error('Monid run timed out');
    await sleep(1500);
    const poll = await monidRequest('GET', `/v1/runs/${encodeURIComponent(run.runId)}`);
    if (poll.status >= 400) throw new Error(poll.json?.error?.message || `Polling failed (HTTP ${poll.status})`);
    run = poll.json;
  }
  if (run.status !== 'COMPLETED') {
    const detail = run.providerResponse?.error?.detail?.message || run.error?.message || run.status;
    throw new Error(`Monid run ${run.status}: ${detail}`);
  }
  return { output: run.output, cost: run.cost };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === '/api/health') {
    return send(200, { proxy: true, hasKey: Boolean(MONID_API_KEY) });
  }

  if (url.pathname === '/api/run' && req.method === 'POST') {
    if (!MONID_API_KEY) return send(503, { error: 'Server started without MONID_API_KEY' });
    try {
      const { provider, endpoint, input } = await readBody(req);
      if (!provider || !endpoint) return send(400, { error: 'provider and endpoint are required' });
      const result = await runEndpoint(provider, endpoint, input);
      return send(200, result);
    } catch (e) {
      return send(502, { error: String(e.message || e) });
    }
  }

  // Static files
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const abs = path.join(__dirname, filePath);
  if (!abs.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Audience Craft running at http://localhost:${PORT}`);
  console.log(MONID_API_KEY
    ? 'Monid proxy enabled — live audience fetching is available.'
    : 'No MONID_API_KEY set — demo mode and in-browser key entry only.');
});
