import { type StoredEvent } from '../event.js';
import { type FraudModel } from '@trace-id/signals/fraud-score';
import { type AccountRecord, type DeviceProfileRecord, type LabelRecord, type TraceStorage, type VisitorRecord } from '../storage.js';

/**
 * Everything in process memory. For tests, local development and trying Trace out: data is gone when the process
 * stops, and several instances do not share it. Use mongoStorage or postgresStorage in production.
 */
export function memoryStorage(): TraceStorage & { readonly size: { visitors: number; events: number } } {
  const visitors = new Map<string, VisitorRecord>();
  const buckets = new Map<string, Set<string>>();
  const profiles = new Map<string, DeviceProfileRecord>(); // `${visitorId}|${netHash}`
  const accounts = new Map<string, AccountRecord>(); // `${visitorId}|${linkedId}`
  const events = new Map<string, StoredEvent>();
  const labels = new Map<string, LabelRecord>(); // `${eventId}|${label}`
  const models = new Map<string, FraudModel>();

  const byNewest = <T extends { lastSeenAt: Date }>(a: T, b: T) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime();

  return {
    get size() {
      return { visitors: visitors.size, events: events.size };
    },
    async visitor(id) {
      return visitors.get(id) ?? null;
    },
    async visitors(ids) {
      return [...new Set(ids)].map((id) => visitors.get(id)).filter((v): v is VisitorRecord => !!v);
    },
    async visitorIdsInBuckets(hashes, limit) {
      const out = new Set<string>();
      for (const h of hashes) for (const id of buckets.get(h) ?? []) {
        out.add(id);
        if (out.size >= limit) return [...out];
      }
      return [...out];
    },
    async visitorsOnDevice(deviceId, limit) {
      return [...visitors.values()].filter((v) => v.deviceId === deviceId || v.id === deviceId).sort(byNewest).slice(0, limit);
    },
    async networksOfVisitor(visitorId, since, limit) {
      return [...profiles.values()].filter((p) => p.visitorId === visitorId && p.lastSeenAt >= since).sort(byNewest).slice(0, limit).map((p) => p.netHash);
    },
    async profilesOnNetworks(networks, excludeVisitorId, since, limit) {
      const set = new Set(networks);
      return [...profiles.values()]
        .filter((p) => set.has(p.netHash) && p.visitorId !== excludeVisitorId && p.lastSeenAt >= since)
        .sort(byNewest)
        .slice(0, limit);
    },
    async visitorsPerNetwork(networks, since) {
      const set = new Set(networks);
      const out = new Map<string, number>();
      for (const p of profiles.values()) if (set.has(p.netHash) && p.lastSeenAt >= since) out.set(p.netHash, (out.get(p.netHash) ?? 0) + 1);
      return out;
    },
    async visitorIdsWithCore(coreHash, excludeVisitorId, limit) {
      const out = new Set<string>();
      for (const p of profiles.values()) if (p.coreHash === coreHash && p.visitorId !== excludeVisitorId) out.add(p.visitorId);
      return [...out].slice(0, limit);
    },
    async profilesOfVisitors(ids, limit) {
      const set = new Set(ids);
      return [...profiles.values()].filter((p) => set.has(p.visitorId)).sort(byNewest).slice(0, limit);
    },
    async linkedIdsOfVisitors(ids, since, limit) {
      const set = new Set(ids);
      const out = new Set<string>();
      for (const a of accounts.values()) if (set.has(a.visitorId) && a.lastSeenAt >= since) out.add(a.linkedId);
      return [...out].slice(0, limit);
    },
    async visitorIdsOfLinkedId(linkedId, since, excludeVisitorId, limit) {
      const out: string[] = [];
      for (const a of accounts.values()) if (a.linkedId === linkedId && a.lastSeenAt >= since && a.visitorId !== excludeVisitorId) out.push(a.visitorId);
      return out.slice(0, limit);
    },
    async accountsOfVisitors(ids, limit) {
      const set = new Set(ids);
      return [...accounts.values()].filter((a) => set.has(a.visitorId)).sort(byNewest).slice(0, limit);
    },
    async saveIdentification(w) {
      const prev = visitors.get(w.visitor.id);
      visitors.set(w.visitor.id, {
        id: w.visitor.id,
        deviceId: w.visitor.deviceId,
        components: w.visitor.components,
        firstSeenAt: prev?.firstSeenAt ?? w.now,
        lastSeenAt: w.now,
        eventCount: (prev?.eventCount ?? 0) + 1,
      });
      for (const h of w.buckets) {
        const set = buckets.get(h) ?? new Set<string>();
        set.add(w.visitor.id);
        buckets.set(h, set);
      }
      if (w.profile) profiles.set(`${w.profile.visitorId}|${w.profile.netHash}`, { ...w.profile, lastSeenAt: w.now });
      if (w.account) {
        const key = `${w.account.visitorId}|${w.account.linkedId}`;
        accounts.set(key, { ...w.account, firstSeenAt: accounts.get(key)?.firstSeenAt ?? w.now, lastSeenAt: w.now });
      }
      events.set(w.event.id, w.event);
    },
    async event(id) {
      return events.get(id) ?? null;
    },
    async eventsOfVisitor(visitorId, limit, before) {
      return [...events.values()]
        .filter((e) => e.visitorId === visitorId && (!before || e.createdAt < before))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    },
    async deleteVisitor(visitorId) {
      const existed = visitors.delete(visitorId);
      for (const set of buckets.values()) set.delete(visitorId);
      for (const [k, p] of profiles) if (p.visitorId === visitorId) profiles.delete(k);
      for (const [k, a] of accounts) if (a.visitorId === visitorId) accounts.delete(k);
      for (const [k, e] of events) if (e.visitorId === visitorId) events.delete(k);
      for (const [k, l] of labels) if (l.visitorId === visitorId) labels.delete(k);
      return existed;
    },
    async saveLabel(l) {
      labels.set(`${l.eventId}|${l.label}`, { ...l });
    },
    async deleteLabel(eventId, label) {
      return labels.delete(`${eventId}|${label}`);
    },
    async labels(label, limit) {
      return [...labels.values()].filter((l) => l.label === label).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, limit);
    },
    async labelCounts() {
      const out = new Map<string, { label: string; n: number; positives: number }>();
      for (const l of labels.values()) {
        const c = out.get(l.label) ?? { label: l.label, n: 0, positives: 0 };
        c.n++;
        if (l.fraud) c.positives++;
        out.set(l.label, c);
      }
      return [...out.values()];
    },
    async eventLabels(eventId) {
      return [...labels.values()].filter((l) => l.eventId === eventId);
    },
    async saveFraudModel(m) {
      models.set(m.label, m);
    },
    async deleteFraudModel(label) {
      models.delete(label);
    },
    async fraudModels() {
      return [...models.values()];
    },
  };
}
