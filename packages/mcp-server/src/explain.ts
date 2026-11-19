import { type EventResponse } from '@trace-id/signals/api';
import { SIGNAL_DEFINITIONS } from '@trace-id/signals/definitions';

const TITLES = new Map(SIGNAL_DEFINITIONS.map((d) => [d.id as string, d]));

function verdict(score: number): string {
  if (score >= 60) return 'High risk: block or challenge.';
  if (score >= 25) return 'Some risk: consider a challenge or manual review.';
  return 'Low risk.';
}

function detail(details: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(details)) {
    if (v === null || v === false || (Array.isArray(v) && v.length === 0) || k === 'available') continue;
    parts.push(`${k}=${Array.isArray(v) ? v.join(',') : String(v)}`);
  }
  return parts.join('; ');
}

/** A plain-language account of an event, for an agent to reason over or quote. */
export function explainEvent(e: EventResponse): string {
  const lines: string[] = [];
  lines.push(`Event ${e.eventId} at ${e.createdAt}: suspect score ${e.suspectScore}/100. ${verdict(e.suspectScore)}`);
  const match = e.matchKind === 'token' ? 'its saved token' : e.matchKind === 'similar' ? 'its device signals' : 'nothing (new visitor)';
  lines.push(`Visitor ${e.visitorId}, recognised by ${match}, confidence ${Math.round(e.confidence * 100)}%. Device ${e.deviceId}.`);
  if (e.linkedId) lines.push(`Account (linkedId): ${e.linkedId}.`);

  const detected = Object.entries(e.signals).filter(([, s]) => s.detected);
  if (detected.length === 0) lines.push('No signal fired.');
  else {
    lines.push('Signals that fired (points added to the score):');
    const points = new Map(e.reasons.map((r) => [r.signal as string, r.contribution]));
    for (const [id, s] of detected) {
      const def = TITLES.get(id);
      const d = detail(s.details);
      lines.push(`- ${def?.title ?? id} (+${points.get(id) ?? 0})${d ? `: ${d}` : ''}`);
      if (def) lines.push(`  Can be wrong when: ${def.falsePositives}`);
    }
  }
  const unavailable = Object.entries(e.signals).filter(([, s]) => s.details?.available === false).map(([id]) => id);
  if (unavailable.length > 0) lines.push(`Not evaluated on this server (missing data or configuration): ${unavailable.join(', ')}.`);
  if (e.linkedVisitors.length > 0) {
    lines.push('Same device in other browsers:');
    for (const l of e.linkedVisitors) {
      lines.push(`- ${l.visitorId} (${l.browser}), ${Math.round(l.confidence * 100)}% via ${l.via}, last seen ${l.lastSeenAt}`);
    }
  }
  lines.push(`IP country: ${e.ip.country ?? 'unknown'}. User agent: ${e.attributes.userAgent ?? 'unknown'}.`);
  return lines.join('\n');
}
