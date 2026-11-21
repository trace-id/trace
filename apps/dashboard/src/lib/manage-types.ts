/** Shapes returned by the server's team, list and alert routes. */

export type Role = 'viewer' | 'admin' | 'owner';

export interface MemberView {
  userId: string;
  email: string;
  name: string;
  role: Role;
  joinedAt: string;
  isYou: boolean;
}
export interface InviteView {
  id: string;
  email: string;
  role: Role;
  invitedAt: string;
  expiresAt: string;
}
export interface MembersResponse {
  members: MemberView[];
  invites: InviteView[];
}

export type ListKind = 'ip' | 'cidr' | 'visitor' | 'device' | 'linked';
export interface ListEntryView {
  id: string;
  kind: ListKind;
  value: string;
  action: 'allow' | 'block';
  note: string | null;
  createdAt: string;
  expiresAt: string | null;
  hits: number;
  lastHitAt: string | null;
}

export type AlertKind = 'flagged_events' | 'flagged_ratio' | 'event_volume';
export interface AlertRuleView {
  id: string;
  name: string;
  kind: AlertKind;
  description: string;
  threshold: number;
  windowMinutes: number;
  minEvents: number;
  cooldownMinutes: number;
  enabled: boolean;
  webhookUrl: string | null;
  lastFiredAt: string | null;
  createdAt: string;
  current: { observed: number; wouldFire: boolean; events: number; flagged: number };
  webhookSecret?: string;
}
export interface AlertEventView {
  id: string;
  ruleId: string | null;
  ruleName: string;
  kind: AlertKind;
  observed: number;
  threshold: number;
  windowMinutes: number;
  delivery: 'none' | 'delivered' | 'failed';
  deliveryError: string | null;
  test: boolean;
  firedAt: string;
}
