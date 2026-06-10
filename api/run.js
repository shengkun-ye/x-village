/**
 * Vercel serverless function — proxies POST /api/run to monid.ai.
 * Reads MONID_API_KEY from env so the key never reaches the browser.
 */
export default async function handler(req, res) {
  if (req.method === 'GET' && req.url?.includes('health')) {
    return res.json({ proxy: true, hasKey: Boolean(process.env.MONID_API_KEY) });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.MONID_API_KEY;
  if (!key) {
    return res.status(503).json({ error: 'MONID_API_KEY not configured on this deployment' });
  }

  const MONID = 'https://api.monid.ai';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function monidFetch(method, path, body) {
    const r = await fetch(`${MONID}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: await r.json() };
  }

  try {
    const { provider, endpoint, input } = req.body;
    if (!provider || !endpoint) {
      return res.status(400).json({ error: 'provider and endpoint are required' });
    }

    // Start the run
    const start = await monidFetch('POST', '/v1/run', { provider, endpoint, input });
    if (start.status >= 400) {
      return res.status(502).json({ error: start.json?.error?.message || `monid error (HTTP ${start.status})` });
    }

    // Poll to completion (max 90s)
    let run = start.json;
    const deadline = Date.now() + 90000;
    while (run.status === 'RUNNING' || run.status === 'PENDING') {
      if (Date.now() > deadline) return res.status(504).json({ error: 'monid run timed out' });
      await sleep(1500);
      const poll = await monidFetch('GET', `/v1/runs/${encodeURIComponent(run.runId)}`);
      if (poll.status >= 400) return res.status(502).json({ error: `polling failed (HTTP ${poll.status})` });
      run = poll.json;
    }

    if (run.status !== 'COMPLETED') {
      const detail = run.providerResponse?.error?.detail?.message || run.error?.message || run.status;
      return res.status(502).json({ error: `monid run ${run.status}: ${detail}` });
    }

    return res.json({ output: run.output, cost: run.cost });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
