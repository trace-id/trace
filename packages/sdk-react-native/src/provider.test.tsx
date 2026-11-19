import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { type ClientDeps } from './client.js';
import { READINGS } from './core.test.js';
import { IdentifyProvider, useVisitorData } from './provider.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OK = { eventId: 'e1', visitorId: 'v'.repeat(20), deviceId: 'v'.repeat(20), confidence: 1, suspectScore: 0, token: 't' };
const deps: ClientDeps = {
  readings: async () => READINGS,
  store: null,
  randomBytes: (n) => new Uint8Array(n),
  fetch: (async () => new Response(JSON.stringify(OK), { status: 200 })) as unknown as typeof fetch,
};

function Show() {
  const { data, isLoading } = useVisitorData({ linkedId: 'u1' });
  return <span>{isLoading ? 'loading' : data?.visitorId}</span>;
}

describe('IdentifyProvider + useVisitorData', () => {
  it('identifies on mount and renders the visitor id', async () => {
    const el = document.createElement('div');
    const root = createRoot(el);
    await act(async () => {
      root.render(
        <IdentifyProvider apiKey="pk_test" endpoint="https://id.example.com" deps={deps}>
          <Show />
        </IdentifyProvider>,
      );
    });
    expect(el.textContent).toBe('v'.repeat(20));
    await act(async () => root.unmount());
  });
});
