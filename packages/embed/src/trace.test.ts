import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryCounters } from './counters.js';
import { memoryStorage } from './storage/memory.js';
import { HEADERS, identifyBody, SECRET } from './test-helpers.js';
import { DEFAULT_SCORING } from './config.js';
import { createTrace, TraceError } from './trace.js';

const ctx = { ip: '203.0.113.7', headers: HEADERS };
const fresh = (extra: Parameters<typeof createTrace>[0] extends infer O ? Partial<O> : never = {}) =>
  createTrace({ storage: memoryStorage(), secret: SECRET, ...extra });

afterEach(() => vi.useRealTimers());

describe('createTrace', () => {
  it('rejects a short secret', () => {
    expect(() => createTrace({ storage: memoryStorage(), secret: 'short' })).toThrow(/32 characters/);
  });

  it('identifies a new visitor and sets the first-party cookie on the mounted path', async () => {
    const trace = fresh();
    const out = await trace.identify(identifyBody('alice'), { ...ctx, cookiePath: '/trace/v1/identify' });
    expect(out.result.visitorId).toMatch(/^[0-9A-Za-z]{20}$/);
    expect(out.result.deviceId).toBe(out.result.visitorId);
    expect(out.result.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.setCookie).toMatch(/^_trace_vt=v1\./);
    expect(out.setCookie).toContain('Path=/trace/v1/identify');
    expect(out.setCookie).toContain('HttpOnly');
  });

  it('recognises the visitor by token, then by device traits once storage is cleared', async () => {
    const trace = fresh();
    const first = await trace.identify(identifyBody('alice'), ctx);
    const byToken = await trace.identify(identifyBody('alice', { token: first.result.token }), ctx);
    expect(byToken.result.visitorId).toBe(first.result.visitorId);
    expect((await trace.verify(byToken.result.eventId)).matchKind).toBe('token');

    const cleared = await trace.identify(identifyBody('alice'), ctx);
    expect(cleared.result.visitorId).toBe(first.result.visitorId);
    expect((await trace.verify(cleared.result.eventId)).matchKind).toBe('similar');
  });

  it('records a bot verdict and flags an unsigned AI agent', async () => {
    const trace = fresh();
    const human = await trace.identify(identifyBody('alice'), ctx);
    expect((await trace.verify(human.result.eventId)).botInfo).toEqual({ result: 'notDetected', type: null, name: null, provider: null, identity: null });
    const agentHeaders = { ...HEADERS, 'user-agent': 'Mozilla/5.0 AppleWebKit/537.36; compatible; ChatGPT-User/1.0; +https://openai.com/bot' };
    const agent = await trace.identify(identifyBody('bob'), { ...ctx, headers: agentHeaders, url: 'https://shop.example/trace/v1/identify' });
    const event = await trace.verify(agent.result.eventId);
    expect(event.botInfo).toMatchObject({ result: 'bad', type: 'aiAgent', name: 'ChatGPT', identity: 'unsigned' });
    expect(event.signals.aiAgent.detected).toBe(true);
    expect(event.reasons).toContainEqual({ signal: 'aiAgent', contribution: 20 });
  });

  it('keeps different devices apart', async () => {
    const trace = fresh();
    const a = await trace.identify(identifyBody('alice'), ctx);
    const b = await trace.identify(identifyBody('bob'), ctx);
    expect(b.result.visitorId).not.toBe(a.result.visitorId);
  });

  it('accepts the cookie when the token is not in the body', async () => {
    const trace = fresh();
    const first = await trace.identify(identifyBody('alice'), ctx);
    const cookie = first.setCookie!.split(';')[0]!;
    const again = await trace.identify(identifyBody('alice'), { ...ctx, headers: { ...HEADERS, cookie } });
    expect((await trace.verify(again.result.eventId)).matchKind).toBe('token');
  });

  it('scores a headless bot with the default weights and reports the reasons', async () => {
    const trace = fresh();
    const out = await trace.identify(identifyBody('bot', { overrides: { bot: { webdriver: true, headlessUserAgent: true } } }), ctx);
    const event = await trace.verify(out.result.eventId);
    expect(event.signals.bot.detected).toBe(true);
    expect(event.reasons).toContainEqual({ signal: 'bot', contribution: 60 });
    expect(event.suspectScore).toBeGreaterThanOrEqual(60);
  });

  it('counts accounts per device for the multi-account signal and the device view', async () => {
    const trace = fresh();
    let last = '';
    for (const linkedId of ['u1', 'u2', 'u3', 'u4']) {
      last = (await trace.identify(identifyBody('alice', { linkedId }), ctx)).result.eventId;
    }
    const event = await trace.verify(last);
    expect(event.signals.multiAccount.detected).toBe(true);
    const device = await trace.device(event.deviceId);
    expect(device?.accounts.map((a) => a.linkedId).sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
  });

  it('counts velocity in process by default', async () => {
    const trace = fresh();
    let last = '';
    for (let i = 0; i < 3; i++) last = (await trace.identify(identifyBody('alice'), ctx)).result.eventId;
    const event = await trace.verify(last);
    expect(event.signals.velocity.details).toMatchObject({ eventsPerVisitor1h: 3 });
  });

  it('reports velocity as not available when counters are off', async () => {
    const trace = fresh({ counters: false });
    const out = await trace.identify(identifyBody('alice'), ctx);
    expect((await trace.verify(out.result.eventId)).signals.velocity.details).toMatchObject({ available: false });
  });

  it('refuses events older than the verification window, but still returns them through event()', async () => {
    const trace = fresh({ verifyWindowMinutes: 5 });
    const out = await trace.identify(identifyBody('alice'), ctx);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await expect(trace.verify(out.result.eventId)).rejects.toMatchObject({ status: 410, code: 'event_expired' });
    expect(await trace.event(out.result.eventId)).not.toBeNull();
  });

  it('rejects unknown and malformed event ids', async () => {
    const trace = fresh();
    await expect(trace.verify('nope')).rejects.toMatchObject({ status: 400 });
    await expect(trace.verify('0193a3f2-7c1e-7b4a-9d2f-5e8c1a6b3f40')).rejects.toBeInstanceOf(TraceError);
  });

  it('rejects malformed bodies without echoing values, and checks the public key when one is set', async () => {
    const trace = fresh({ publicKey: 'pk_test_embed' });
    await expect(trace.identify(identifyBody('alice'), ctx)).rejects.toMatchObject({ status: 401 });
    await expect(trace.identify({ signals: { v: 2 } }, { ...ctx, apiKey: 'pk_test_embed' })).rejects.toMatchObject({ status: 400 });
    const ok = await trace.identify(JSON.stringify(identifyBody('alice')), { ...ctx, apiKey: 'pk_test_embed' });
    expect(ok.result.visitorId).toBeTruthy();
  });

  it('calls onEvent with the full event, and survives a failing hook', async () => {
    const seen: string[] = [];
    const log = vi.fn();
    const trace = fresh({ onEvent: (e) => { seen.push(e.eventId); throw new Error('hook down'); }, log });
    const out = await trace.identify(identifyBody('alice'), ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([out.result.eventId]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('onEvent failed'));
  });

  it('adds a sealed result when a seal key is set', async () => {
    const trace = fresh({ sealKey: Buffer.alloc(32, 7).toString('base64') });
    const out = await trace.identify(identifyBody('alice'), ctx);
    expect(out.result.sealedResult).toMatch(/^[\w-]+$/);
  });

  it('stores only a truncated IP by default and nothing with ipStorage none', async () => {
    const t1 = fresh();
    const e1 = await t1.verify((await t1.identify(identifyBody('alice'), ctx)).result.eventId);
    expect(e1.ip.address).toBe('203.0.113.0');
    const t2 = fresh({ ipStorage: 'none' });
    const e2 = await t2.verify((await t2.identify(identifyBody('alice'), ctx)).result.eventId);
    expect(e2.ip.address).toBeNull();
  });

  it('learns a fraud score from labels and scores new events with reasons', async () => {
    const trace = fresh();
    const ids: { id: string; bot: boolean }[] = [];
    for (let i = 0; i < 20; i++) {
      for (const bot of [true, false]) {
        const out = await trace.identify(identifyBody(`${bot ? 'bot' : 'human'}-${i}`, { overrides: { bot: { webdriver: bot } } }), ctx);
        ids.push({ id: out.result.eventId, bot });
      }
    }
    for (const { id, bot } of ids) expect(await trace.label(id, 'payment', bot)).toEqual({ eventId: id, label: 'payment', fraud: bot });
    await trace.label(ids[0]!.id, 'promo_abuse', true);

    const models = await trace.trainFraudModels();
    expect(models.models).toHaveLength(1);
    expect(models.models[0]).toMatchObject({ label: 'payment', n: 40, positives: 20 });
    expect(models.models[0]!.coefficients.bot!).toBeGreaterThan(0);
    expect(models.untrained).toEqual([{ label: 'promo_abuse', n: 1, positives: 1 }]);
    expect(await trace.fraudModels()).toEqual(models);
    expect((await trace.eventLabels(ids[0]!.id)).labels.map((l) => l.label)).toEqual(['payment', 'promo_abuse']);

    const bot = await trace.verify((await trace.identify(identifyBody('bot-new', { overrides: { bot: { webdriver: true } } }), ctx)).result.eventId);
    const human = await trace.verify((await trace.identify(identifyBody('human-new'), ctx)).result.eventId);
    expect(bot.fraudScores?.[0]).toMatchObject({ label: 'payment', reasons: ['bot'] });
    expect(bot.fraudScores![0]!.probability).toBeGreaterThan(0.8);
    expect(human.fraudScores![0]!.probability).toBeLessThan(0.2);

    expect(await trace.unlabel(ids[0]!.id, 'promo_abuse')).toBe(true);
    expect(await trace.unlabel(ids[0]!.id, 'promo_abuse')).toBe(false);
  });

  it("records the account's history for the fraud score's account-age features", async () => {
    const storage = memoryStorage();
    const trace = createTrace({ storage, secret: SECRET });
    const account = async (seed: string, linkedId?: string, ip = ctx.ip) =>
      (await storage.event((await trace.identify(identifyBody(seed, linkedId ? { linkedId } : {}), { ...ctx, ip })).result.eventId))!.signals.account;
    expect(await account('alice')).toBeUndefined();
    expect(await account('alice', 'user-1')).toEqual({ firstSeenAt: null, seenOnDevice: false });
    const again = await account('alice', 'user-1');
    expect(again?.seenOnDevice).toBe(true);
    expect(again?.firstSeenAt).toMatch(/^\d{4}-/);
    // Another device, on another network (on the same network with the same hardware it would be linked as one device).
    const elsewhere = await account('bob', 'user-1', '198.51.100.20');
    expect(elsewhere).toEqual({ firstSeenAt: again?.firstSeenAt, seenOnDevice: false });
  });

  it('flags a request sent twice with the same nonce', async () => {
    const trace = fresh();
    const body = { ...identifyBody('alice'), nonce: 'ab'.repeat(16), sentAt: Date.now() };
    const first = await trace.verify((await trace.identify(body, ctx)).result.eventId);
    const again = await trace.verify((await trace.identify(body, ctx)).result.eventId);
    expect(first.signals.replayedRequest).toMatchObject({ detected: false, details: { available: true } });
    expect(again.signals.replayedRequest.detected).toBe(true);
    expect(again.reasons).toContainEqual({ signal: 'replayedRequest', contribution: 50 });
    const noNonce = await trace.verify((await trace.identify(identifyBody('bob'), ctx)).result.eventId);
    expect(noNonce.signals.replayedRequest.details).toEqual({ available: false });
    await expect(trace.identify({ ...body, nonce: 'not-hex' }, ctx)).rejects.toMatchObject({ status: 400 });
  });

  it('flags a visitor on a network where other visitors were flagged', async () => {
    const scoring = { ...DEFAULT_SCORING, flaggedNetwork: { ...DEFAULT_SCORING.flaggedNetwork!, flagScore: 60 } };
    const trace = fresh({ scoring });
    const visit = async (seed: string, ip: string, bot = false) =>
      trace.verify((await trace.identify(identifyBody(seed, { overrides: { bot: { webdriver: bot } } }), { ...ctx, ip })).result.eventId);
    for (const [i, seed] of ['f1', 'f2', 'f3'].entries()) await visit(seed, `198.18.50.${10 + i}`, true);
    const newcomer = await visit('f4', '198.18.50.20');
    expect(newcomer.signals.flaggedNetwork).toMatchObject({ detected: true, details: { visitors: 3, flagged: 3 } });
    expect((await visit('g1', '198.18.51.10')).signals.flaggedNetwork.detected).toBe(false);
  });

  it('validates labels and reports when the storage cannot hold them', async () => {
    const trace = fresh();
    const out = await trace.identify(identifyBody('alice'), ctx);
    await expect(trace.label(out.result.eventId, 'Payment', true)).rejects.toMatchObject({ status: 400, code: 'invalid_label' });
    await expect(trace.label('nope', 'payment', true)).rejects.toMatchObject({ status: 400, code: 'invalid_event_id' });
    await expect(trace.label('01a1dcf6-53b8-7c68-bd1d-000000000000', 'payment', true)).rejects.toMatchObject({ status: 404 });
    for (let i = 0; i < 20; i++) await trace.label(out.result.eventId, `type_${i}`, true);
    await expect(trace.label(out.result.eventId, 'one_more', true)).rejects.toMatchObject({ status: 409, code: 'limit_reached' });

    const { saveLabel: _omit, ...withoutLabels } = memoryStorage();
    const plain = createTrace({ storage: withoutLabels, secret: SECRET });
    const e = await plain.identify(identifyBody('alice'), ctx);
    await expect(plain.label(e.result.eventId, 'payment', true)).rejects.toMatchObject({ status: 501 });
    expect((await plain.verify(e.result.eventId)).fraudScores).toBeUndefined();
  });

  it('deletes a visitor and its events', async () => {
    const trace = fresh();
    const out = await trace.identify(identifyBody('alice'), ctx);
    expect(await trace.deleteVisitor(out.result.visitorId)).toBe(true);
    expect(await trace.event(out.result.eventId)).toBeNull();
    expect(await trace.visitorEvents(out.result.visitorId)).toEqual([]);
  });
});

describe('memoryCounters nonces', () => {
  it('accepts a nonce once until it expires', async () => {
    const c = memoryCounters();
    expect(await c.claimNonce!('n1', 1000, 0)).toBe(true);
    expect(await c.claimNonce!('n1', 1000, 500)).toBe(false);
    expect(await c.claimNonce!('n1', 1000, 1500)).toBe(true);
  });
});
