export { createTrace, TraceError, type IdentifyContext, type IdentifyOutcome, type Trace, type TraceOptions } from './trace.js';
export { memoryStorage } from './storage/memory.js';
export { memoryCounters, redisCounters, type RedisPipelineClient, type TraceCounters } from './counters.js';
export { DEFAULT_SCORING, loadScoringConfig, parseScoringConfig } from './config.js';
export type { AccountRecord, DeviceProfileRecord, IdentificationWrite, TraceStorage, VisitorRecord } from './storage.js';
export type { StoredEvent, StoredSignals } from './event.js';
export type { DeviceResponse, EventResponse, IdentifyResponse } from '@trace-id/signals/api';
