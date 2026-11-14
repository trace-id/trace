const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'content-encoding',
  'proxy-authorization',
  'te',
  'trailer',
]);

function apiUrl(): string {
  const url = process.env.API_URL ?? 'http://localhost:8080';
  return url.replace(/\/+$/, '');
}

/**
 * Forwards /api/auth/* and /v1/* to the server so session cookies are first-party on the
 * dashboard's origin. Read at request time, so one built image works for any API_URL.
 * Origin and cookies pass through unchanged: the server does the CSRF check.
 */
export async function proxy(req: Request): Promise<Response> {
  const incoming = new URL(req.url);
  const target = `${apiUrl()}${incoming.pathname}${incoming.search}`;
  const headers = new Headers();
  req.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name.toLowerCase())) headers.set(name, value);
  });
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ error: { code: 'upstream_unavailable', message: 'API server unreachable' } }, { status: 502 });
  }
  const out = new Headers();
  upstream.headers.forEach((value, name) => {
    const n = name.toLowerCase();
    if (!HOP_BY_HOP.has(n) && n !== 'set-cookie') out.set(name, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);
  return new Response(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: out });
}
