// In-browser request layer: intercepts fetch('/api/...') and answers from the mock server.
// No real network is used for the API. (A service worker is avoided so the prototype also runs
// inside sandboxed iframes and from file://.)
import { handleRequest } from './kernel';
import { startTicker } from './outbox';

let installed = false;
export function installMockFetch() {
  if (installed) return;
  installed = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith('http') ? new URL(url).pathname : url;
    if (!path.startsWith('/api/')) return realFetch(input as any, init);
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).forEach((v, k) => (headers[k.toLowerCase()] = v));
    let body: unknown = null;
    if (init?.body && typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    const res = await handleRequest({ method: (init?.method ?? 'GET').toUpperCase(), url, headers, body, deviceLabel: headers['x-device-label'] });
    const outHeaders = new Headers({ 'content-type': 'application/json', ...res.headers });
    return new Response(res.status === 204 ? null : JSON.stringify(res.body), { status: res.status, headers: outHeaders });
  };
  startTicker();
}
