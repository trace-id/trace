import { makePayload } from '@trace-id/signals/testing';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentifyProvider, useIdentifyClient, useVisitorData, type VisitorDataState } from './provider.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OK = { eventId: 'e1', visitorId: 'v1', confidence: 0.99, suspectScore: 0, token: 'v1.t.1.s' };
const respond = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

let container: HTMLDivElement;
let root: Root;
let state: VisitorDataState | null = null;

function Probe(props: Parameters<typeof useVisitorData>[0]) {
  const s = useVisitorData(props);
  useEffect(() => {
    state = s;
  });
  return null;
}

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(
      <IdentifyProvider apiKey="pk_test" endpoint="https://id.example.test" collector={() => Promise.resolve(makePayload())}>
        {node}
      </IdentifyProvider>,
    );
  });
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  state = null;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('useVisitorData', () => {
  it('identifies on mount and exposes the result without the token', async () => {
    const fetchMock = vi.fn(() => respond(200, OK));
    vi.stubGlobal('fetch', fetchMock);
    await render(<Probe linkedId="user-1" tags={{ page: 'signup' }} />);
    await settle();
    expect(state?.isLoading).toBe(false);
    expect(state?.data).toEqual({ eventId: 'e1', visitorId: 'v1', confidence: 0.99, suspectScore: 0 });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as {
      linkedId: string;
      tags: unknown;
    };
    expect(body).toMatchObject({ linkedId: 'user-1', tags: { page: 'signup' } });
  });

  it('does nothing until getData() when immediate is false, and does not refetch on re-render with equal tags', async () => {
    const fetchMock = vi.fn(() => respond(200, OK));
    vi.stubGlobal('fetch', fetchMock);
    await render(<Probe immediate={false} tags={{ a: 1 }} />);
    await render(<Probe immediate={false} tags={{ a: 1 }} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state?.isLoading).toBe(false);
    let result: unknown;
    await act(async () => {
      result = await state?.getData({ linkedId: 'late' });
    });
    expect(result).toMatchObject({ visitorId: 'v1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces typed errors instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(429, { error: { code: 'rate_limited', message: 'slow' } })));
    await render(<Probe />);
    await settle();
    expect(state?.data).toBeNull();
    expect(state?.error).toMatchObject({ code: 'rate_limited' });
  });

  it('exposes the client for consent toggles', async () => {
    let enabled: boolean | null = null;
    function Consent() {
      const client = useIdentifyClient();
      useEffect(() => {
        void client.disable().then(() => {
          enabled = client.isEnabled;
        });
      }, [client]);
      return null;
    }
    vi.stubGlobal('fetch', vi.fn(() => respond(200, OK)));
    await render(<Consent />);
    await settle();
    expect(enabled).toBe(false);
  });

  it('requires the provider', () => {
    function Orphan() {
      useIdentifyClient();
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => act(() => root.render(<Orphan />))).toThrow(/IdentifyProvider/);
    spy.mockRestore();
  });
});
