import { type CrossBrowserConfig } from './crossbrowser.js';
import { type LinkageConfig } from './linkage.js';
import { type ComponentName } from './types.js';

export const SIGNAL_IDS = [
  'bot',
  'tampering',
  'tor',
  'datacenterIp',
  'ipBlocklist',
  'velocity',
  'incognito',
  'devtools',
  'virtualMachine',
  'privacyBrowser',
  'highActivity',
  'crossBrowser',
  'antiDetect',
  'vpn',
  'tlsMismatch',
  'multiAccount',
  'accountSharing',
  'automatedInput',
  'aiAgent',
  'proxy',
  'rareDevice',
  'tamperedRequest',
  'replayedRequest',
  'flaggedNetwork',
  'emulator',
  'rootedDevice',
] as const;

export type SignalId = (typeof SIGNAL_IDS)[number];

export interface IdentificationConfig {
  matchThreshold: number;
  tokenAgreementThreshold: number;
  minSharedWeightRatio: number;
  ambiguityMargin: number;
  maxCandidates: number;
  componentWeights: Partial<Record<ComponentName, number>>;
  buckets: ComponentName[][];
  /**
   * weighted: share of matching component weight (matchThreshold). linkage: probabilistic record linkage with value
   * frequencies and per-component change rates (see linkage.ts). Optional: older configs use weighted.
   */
  method?: 'weighted' | 'linkage';
  linkage?: LinkageConfig;
}

export interface VelocityThresholds {
  eventsPerVisitor1h: number;
  /** High-activity device: sustained volume over a day rather than a burst. */
  eventsPerVisitor24h: number;
  visitorsPerIp1h: number;
  ipsPerVisitor24h: number;
  visitorsPerLinkedId24h: number;
  /** Bursts: events from one visitor within 5 minutes. */
  eventsPerVisitor5m: number;
  /** One visitor seen from more countries than this in 24 h (impossible travel, rotating proxies). */
  countriesPerVisitor24h: number;
  /** One browser signing into more accounts than this in 24 h. */
  linkedIdsPerVisitor24h: number;
}

/** Velocity thresholds added after the first release, with their defaults. */
export const LATER_VELOCITY_DEFAULTS = {
  eventsPerVisitor5m: 20,
  countriesPerVisitor24h: 2,
  linkedIdsPerVisitor24h: 3,
} as const;

/** multiAccount / accountSharing: accounts are the customer's linkedId, devices the cross-browser deviceId. */
export interface AccountsConfig {
  windowHours: number;
  /** multiAccount fires when more distinct accounts than this used one device in the window. */
  maxAccountsPerDevice: number;
  /** accountSharing fires when one account was used on more distinct devices than this in the window. */
  maxDevicesPerAccount: number;
}

export const DEFAULT_ACCOUNTS_CONFIG: AccountsConfig = {
  windowHours: 720,
  maxAccountsPerDevice: 2,
  maxDevicesPerAccount: 5,
};

/** rareDevice: only judged once the project has enough visitors for frequencies to mean something. */
export interface RareDeviceConfig {
  minVisitors: number;
  /** Fires when the estimated share of visitors with this hardware combination is below this. */
  maxShare: number;
}

export const DEFAULT_RARE_DEVICE_CONFIG: RareDeviceConfig = { minVisitors: 1000, maxShare: 0.0001 };

/** flaggedNetwork: other visitors on this network flagged recently. */
export interface FlaggedNetworkConfig {
  /** Look-back window. */
  windowHours: number;
  /** A neighbour counts as flagged with an event scoring at least this (without its own flaggedNetwork part). */
  flagScore: number;
  /** Fires with at least this many flagged neighbours... */
  minFlagged: number;
  /** ...that are at least this share of the network's other visitors (keeps big shared networks from firing). */
  minShare: number;
}

export const DEFAULT_FLAGGED_NETWORK_CONFIG: FlaggedNetworkConfig = { windowHours: 24, flagScore: 70, minFlagged: 2, minShare: 0.25 };

export interface ScoringConfig {
  version: 1;
  identification: IdentificationConfig;
  suspect: {
    weights: Record<SignalId, number>;
  };
  velocity: VelocityThresholds;
  crossBrowser: CrossBrowserConfig;
  accounts: AccountsConfig;
  /** Optional: added later; DEFAULT_RARE_DEVICE_CONFIG when absent. */
  rareDevice?: RareDeviceConfig;
  /** Optional: added later; DEFAULT_FLAGGED_NETWORK_CONFIG when absent. */
  flaggedNetwork?: FlaggedNetworkConfig;
}
