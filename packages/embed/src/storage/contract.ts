import { describe, expect, it } from 'vitest';
import { type StoredEvent } from '../event.js';
import { uuidv7 } from '../ids.js';
import { type TraceStorage } from '../storage.js';

/**
 * Behaviour every storage adapter must have. Run it from the adapter's own test file:
 *   storageContract('memory', async () => memoryStorage());
 * A new adapter (SQL Server, DynamoDB...) is done when this passes.
 */
export function storageContract(name: string, make: () => Promise<TraceStorage>): void {
  const t0 = new Date('2026-11-01T10:00:00Z');
  const later = (min: number) => new Date(t0.getTime() + min * 60_000);
  const event = (id: string, visitorId: string, at: Date): StoredEvent => ({
    id,
    createdAt: at,
    visitorId,
    matchKind: 'new',
    confidence: 1,
    suspectScore: 0,
    reasons: [],
    signals: { results: {} as StoredEvent['signals']['results'], components: { canvas: 'aa11' }, attributes: { screenWidth: 1, screenHeight: 1, timezone: null, languages: [], platform: null, userAgent: null, webglRenderer: null }, sdk: { name: 't', version: '0' }, collectMs: 1 },
    ip: null,
    asn: null,
    country: null,
    tags: null,
    linkedId: null,
  });
  const save = (s: TraceStorage, visitorId: string, at: Date, more: Partial<Parameters<TraceStorage['saveIdentification']>[0]> = {}) =>
    s.saveIdentification({
      now: at,
      visitor: { id: visitorId, deviceId: visitorId, components: { canvas: `c-${visitorId}` } },
      buckets: [`b-${visitorId}`, 'b-shared'],
      profile: null,
      account: null,
      event: event(uuidv7(at), visitorId, at),
      ...more,
    });

  describe(`storage contract: ${name}`, () => {
    it('upserts visitors, keeping firstSeenAt and counting events', async () => {
      const s = await make();
      await s.init?.();
      await save(s, 'v1', t0);
      await save(s, 'v1', later(5));
      const v = await s.visitor('v1');
      expect(v).toMatchObject({ id: 'v1', deviceId: 'v1', eventCount: 2 });
      expect(v!.firstSeenAt.getTime()).toBe(t0.getTime());
      expect(v!.lastSeenAt.getTime()).toBe(later(5).getTime());
      expect(await s.visitor('missing')).toBeNull();
    });

    it('finds visitors by bucket, deduplicated and limited', async () => {
      const s = await make();
      await s.init?.();
      await save(s, 'v1', t0);
      await save(s, 'v2', t0);
      expect((await s.visitorIdsInBuckets(['b-shared'], 10)).sort()).toEqual(['v1', 'v2']);
      expect(await s.visitorIdsInBuckets(['b-v1', 'b-shared'], 1)).toHaveLength(1);
      expect((await s.visitors(['v1', 'v2', 'v1', 'nope'])).map((v) => v.id).sort()).toEqual(['v1', 'v2']);
    });

    it('groups visitors by device', async () => {
      const s = await make();
      await s.init?.();
      await save(s, 'v1', t0);
      await save(s, 'v2', later(1), { visitor: { id: 'v2', deviceId: 'v1', components: {} } });
      expect((await s.visitorsOnDevice('v1', 10)).map((v) => v.id)).toEqual(['v2', 'v1']);
    });

    it('stores device profiles per network and answers the linking queries', async () => {
      const s = await make();
      await s.init?.();
      const profile = (visitorId: string, netHash: string, coreHash: string | null) => ({ visitorId, netHash, coreHash, browser: 'chrome', profile: { os: 'win' } });
      await save(s, 'v1', t0, { profile: profile('v1', 'net-a', 'core-1') });
      await save(s, 'v1', later(10), { profile: profile('v1', 'net-b', 'core-1') });
      await save(s, 'v2', later(20), { profile: profile('v2', 'net-a', 'core-1') });
      expect((await s.networksOfVisitor('v1', t0, 10)).sort()).toEqual(['net-a', 'net-b']);
      expect((await s.networksOfVisitor('v1', later(5), 10))).toEqual(['net-b']);
      expect((await s.profilesOnNetworks(['net-a'], 'v1', t0, 10)).map((p) => p.visitorId)).toEqual(['v2']);
      expect(Object.fromEntries(await s.visitorsPerNetwork(['net-a', 'net-b'], t0))).toEqual({ 'net-a': 2, 'net-b': 1 });
      expect(await s.visitorIdsWithCore('core-1', 'v1', 10)).toEqual(['v2']);
      const ofV1 = await s.profilesOfVisitors(['v1'], 10);
      expect(ofV1.map((p) => p.netHash)).toEqual(['net-b', 'net-a']);
      expect(ofV1[0]!.profile).toEqual({ os: 'win' });
    });

    it('tracks accounts per visitor, with first and last seen', async () => {
      const s = await make();
      await s.init?.();
      await save(s, 'v1', t0, { account: { visitorId: 'v1', linkedId: 'alice' } });
      await save(s, 'v1', later(30), { account: { visitorId: 'v1', linkedId: 'alice' } });
      await save(s, 'v2', later(40), { account: { visitorId: 'v2', linkedId: 'alice' } });
      await save(s, 'v1', later(50), { account: { visitorId: 'v1', linkedId: 'bob' } });
      expect((await s.linkedIdsOfVisitors(['v1'], t0, 10)).sort()).toEqual(['alice', 'bob']);
      expect(await s.visitorIdsOfLinkedId('alice', t0, 'v1', 10)).toEqual(['v2']);
      const acc = await s.accountsOfVisitors(['v1'], 10);
      const alice = acc.find((a) => a.linkedId === 'alice')!;
      expect(alice.firstSeenAt.getTime()).toBe(t0.getTime());
      expect(alice.lastSeenAt.getTime()).toBe(later(30).getTime());
    });

    it('stores events and lists a visitor\'s newest first, with paging', async () => {
      const s = await make();
      await s.init?.();
      await save(s, 'v1', t0);
      await save(s, 'v1', later(1));
      await save(s, 'v1', later(2));
      const all = await s.eventsOfVisitor('v1', 10);
      expect(all.map((e) => e.createdAt.getTime())).toEqual([later(2), later(1), t0].map((d) => d.getTime()));
      expect(await s.eventsOfVisitor('v1', 10, later(1))).toHaveLength(1);
      const one = await s.event(all[0]!.id);
      expect(one).toMatchObject({ id: all[0]!.id, visitorId: 'v1', matchKind: 'new' });
      expect(one!.createdAt).toBeInstanceOf(Date);
      expect(await s.event('missing')).toBeNull();
    });

    it('deletes a visitor and everything about it', async () => {
      const s = await make();
      await s.init?.();
      await save(s, 'v1', t0, { account: { visitorId: 'v1', linkedId: 'alice' }, profile: { visitorId: 'v1', netHash: 'n', coreHash: null, browser: 'x', profile: {} } });
      expect(await s.deleteVisitor('v1')).toBe(true);
      expect(await s.visitor('v1')).toBeNull();
      expect(await s.eventsOfVisitor('v1', 10)).toEqual([]);
      expect(await s.visitorIdsInBuckets(['b-v1'], 10)).toEqual([]);
      expect(await s.accountsOfVisitors(['v1'], 10)).toEqual([]);
      expect(await s.deleteVisitor('v1')).toBe(false);
    });

    it('stores fraud labels and models, and deletes labels with the visitor', async () => {
      const s = await make();
      await s.init?.();
      if (!s.saveLabel) return; // optional capability
      const e1 = uuidv7(t0), e2 = uuidv7(later(1)), e3 = uuidv7(later(2));
      await s.saveLabel({ eventId: e1, label: 'payment', fraud: true, visitorId: 'v1', detected: ['bot'], updatedAt: t0 });
      await s.saveLabel({ eventId: e2, label: 'payment', fraud: false, visitorId: 'v2', detected: [], updatedAt: later(1) });
      await s.saveLabel({ eventId: e2, label: 'promo', fraud: true, visitorId: 'v2', detected: ['proxy'], updatedAt: later(1) });
      // Upsert replaces the verdict.
      await s.saveLabel({ eventId: e1, label: 'payment', fraud: false, visitorId: 'v1', detected: ['bot', 'tor'], updatedAt: later(3) });
      await s.saveLabel({ eventId: e3, label: 'payment', fraud: true, visitorId: 'v1', detected: [], updatedAt: later(2) });

      const payment = await s.labels!('payment', 10);
      expect(payment.map((l) => l.eventId)).toEqual([e1, e3, e2]);
      expect(payment[0]).toEqual({ eventId: e1, label: 'payment', fraud: false, visitorId: 'v1', detected: ['bot', 'tor'], updatedAt: later(3) });
      expect(await s.labels!('payment', 1)).toHaveLength(1);
      const counts = (await s.labelCounts!()).sort((a, b) => a.label.localeCompare(b.label));
      expect(counts).toEqual([{ label: 'payment', n: 3, positives: 1 }, { label: 'promo', n: 1, positives: 1 }]);
      expect((await s.eventLabels!(e2)).map((l) => l.label).sort()).toEqual(['payment', 'promo']);

      expect(await s.deleteLabel!(e2, 'promo')).toBe(true);
      expect(await s.deleteLabel!(e2, 'promo')).toBe(false);

      const model = { version: 1 as const, label: 'payment', trainedAt: t0.toISOString(), n: 3, positives: 1, intercept: -1, coefficients: { bot: 2 }, cvAuc: null };
      await s.saveFraudModel!(model);
      await s.saveFraudModel!({ ...model, n: 4 });
      expect(await s.fraudModels!()).toEqual([{ ...model, n: 4 }]);
      await s.deleteFraudModel!('payment');
      expect(await s.fraudModels!()).toEqual([]);

      await save(s, 'v1', t0);
      await s.deleteVisitor('v1');
      expect((await s.labels!('payment', 10)).map((l) => l.visitorId)).toEqual(['v2']);
    });
  });
}
