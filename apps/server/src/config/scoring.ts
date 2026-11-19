// Shared with the embedded mode: the implementation lives in @trace-id/embed (packages/embed/src).
export { loadScoringConfig, parseScoringConfig } from '@trace-id/embed/core';

/** Nest injection token for the loaded ScoringConfig. */
export const SCORING = Symbol('SCORING');
