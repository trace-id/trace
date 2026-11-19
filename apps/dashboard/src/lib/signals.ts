import { SIGNAL_DEFINITIONS } from '@trace-id/signals/definitions';

export type SignalGroup = 'Automation' | 'Network' | 'Device' | 'Account' | 'Request';

export interface SignalMeta {
  id: string;
  title: string;
  description: string;
  falsePositives: string;
  group: SignalGroup;
}

const GROUPS: Record<string, SignalGroup> = {
  bot: 'Automation', automatedInput: 'Automation', aiAgent: 'Automation', highActivity: 'Automation', velocity: 'Automation',
  tor: 'Network', vpn: 'Network', proxy: 'Network', datacenterIp: 'Network', ipBlocklist: 'Network', flaggedNetwork: 'Network', tlsMismatch: 'Network',
  tampering: 'Device', antiDetect: 'Device', incognito: 'Device', devtools: 'Device', virtualMachine: 'Device', privacyBrowser: 'Device',
  emulator: 'Device', rootedDevice: 'Device', rareDevice: 'Device',
  crossBrowser: 'Account', multiAccount: 'Account', accountSharing: 'Account',
  tamperedRequest: 'Request', replayedRequest: 'Request',
};

export const SIGNALS: SignalMeta[] = SIGNAL_DEFINITIONS.map((d) => ({
  id: d.id,
  title: d.title,
  description: d.description,
  falsePositives: d.falsePositives,
  group: GROUPS[d.id] ?? 'Device',
}));

const byId = new Map(SIGNALS.map((s) => [s.id, s]));

export function signalMeta(id: string): SignalMeta {
  return byId.get(id) ?? { id, title: id, description: '', falsePositives: '', group: 'Device' };
}

export function signalTitle(id: string): string {
  return signalMeta(id).title;
}
