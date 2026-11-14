// Demo "customer site": serves a page that runs the browser SDK, plus a /verify route that
// plays the customer's backend and checks the event with the secret key via sdk-node.
// Usage: PUBLIC_KEY=pk_... SECRET_KEY=sk_... [API_ENDPOINT=http://localhost:8080] npm run demo
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.env.PORT ?? 5173);
const API_ENDPOINT = process.env.API_ENDPOINT ?? 'http://localhost:8080';
const PUBLIC_KEY = process.env.PUBLIC_KEY ?? '';
const SECRET_KEY = process.env.SECRET_KEY ?? '';

if (!PUBLIC_KEY.startsWith('pk_') || !SECRET_KEY.startsWith('sk_')) {
  console.error('Set PUBLIC_KEY (pk_...) and SECRET_KEY (sk_...). Create them with: npm run keys:create -w tbdname-server -- --project demo --origins http://localhost:5173');
  process.exit(1);
}

const { verifyEvent } = await import(new URL('../../packages/sdk-node/dist/verify.js', import.meta.url).href);

const STATIC = {
  '/sdk/': join(root, 'packages/sdk-js/dist'),
  '/signals/': join(root, 'packages/signals/dist'),
};
const TYPES = { '.js': 'text/javascript', '.map': 'application/json', '.html': 'text/html; charset=utf-8' };

async function serveStatic(res, base, rel) {
  const file = normalize(join(base, rel));
  if (!file.startsWith(base + sep)) return send(res, 404, 'text/plain', 'not found');
  try {
    send(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', await readFile(file));
  } catch {
    send(res, 404, 'text/plain', 'not found');
  }
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new Error('too large');
  }
  return JSON.parse(raw);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/') {
    const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
    const config = JSON.stringify({ apiKey: PUBLIC_KEY, endpoint: API_ENDPOINT }).replace(/</g, '\\u003c');
    return send(res, 200, TYPES['.html'], html.replace('__DEMO_CONFIG__', config));
  }
  for (const [prefix, base] of Object.entries(STATIC)) {
    if (req.method === 'GET' && url.pathname.startsWith(prefix)) return serveStatic(res, base, url.pathname.slice(prefix.length));
  }
  if (req.method === 'POST' && url.pathname === '/verify') {
    try {
      const { eventId } = await readJson(req);
      const event = await verifyEvent(String(eventId), { secretKey: SECRET_KEY, endpoint: API_ENDPOINT });
      return send(res, 200, 'application/json', JSON.stringify(event));
    } catch (err) {
      return send(res, 400, 'application/json', JSON.stringify({ code: err.code ?? 'error', message: err.message }));
    }
  }
  send(res, 404, 'text/plain', 'not found');
}).listen(PORT, () => console.log(`demo on http://localhost:${PORT} (server ${API_ENDPOINT})`));
