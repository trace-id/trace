import { describe, expect, it } from 'vitest';
import { type SignalId } from './config.js';
import {
  contextFeatures,
  FRAUD_LABEL_PATTERN,
  fraudFeatures,
  knownFeatures,
  type FraudExample,
  firedSignals,
  fitLogistic,
  rocAuc,
  scoreFraud,
  trainFraudModel,
} from './fraud-score.js';

/** Synthetic labels: proxy predicts this fraud type strongly, bot weakly, devtools not at all. */
function labelled(): FraudExample[] {
  const out: FraudExample[] = [];
  const add = (count: number, detected: SignalId[], fraud: boolean) => {
    for (let i = 0; i < count; i++) out.push({ detected, fraud });
  };
  add(40, ['proxy'], true);
  add(5, ['proxy'], false);
  add(10, ['bot'], true);
  add(10, ['bot'], false);
  add(10, ['devtools'], true);
  add(40, ['devtools'], false);
  add(5, [], true);
  add(80, [], false);
  return out;
}

describe('fraud score', () => {
  it('learns which signals predict a fraud type and scores with reasons', () => {
    const model = trainFraudModel('payment', labelled(), { now: new Date('2026-11-18T00:00:00Z') })!;
    expect(model).toMatchObject({ label: 'payment', n: 200, positives: 65, trainedAt: '2026-11-18T00:00:00.000Z' });
    expect(model.coefficients.proxy!).toBeGreaterThan(model.coefficients.bot!);
    expect(model.coefficients.tor).toBeUndefined();
    expect(model.cvAuc!).toBeGreaterThan(0.75);

    const proxied = scoreFraud(model, ['proxy', 'devtools']);
    const clean = scoreFraud(model, []);
    expect(proxied.probability).toBeGreaterThan(0.6);
    expect(clean.probability).toBeLessThan(0.15);
    expect(proxied.reasons[0]).toBe('proxy');
    expect(clean.reasons).toEqual([]);
  });

  it('does not list features with a negligible weight as reasons', () => {
    const model = { ...trainFraudModel('payment', labelled())!, coefficients: { proxy: 2, bot: 0.05, devtools: -1 } };
    expect(scoreFraud(model, ['proxy', 'bot', 'devtools']).reasons).toEqual(['proxy']);
  });

  it('ignores signals the model never saw', () => {
    const model = trainFraudModel('payment', labelled())!;
    expect(scoreFraud(model, ['tor']).probability).toBe(scoreFraud(model, []).probability);
  });

  it('refuses to train on too few labels or a single class', () => {
    expect(trainFraudModel('x', labelled().slice(0, 20))).toBeNull();
    expect(trainFraudModel('x', labelled().filter((e) => e.fraud))).toBeNull();
    const fewFraud = [...labelled().filter((e) => !e.fraud), ...labelled().filter((e) => e.fraud).slice(0, 4)];
    expect(trainFraudModel('x', fewFraud)).toBeNull();
  });

  it('skips cross-validation when a class has fewer examples than folds', () => {
    const examples = [...labelled().filter((e) => !e.fraud), ...labelled().filter((e) => e.fraud).slice(0, 6)];
    expect(trainFraudModel('x', examples, { folds: 10 })?.cvAuc).toBeNull();
  });

  it('fits weighted rows the same as repeated rows', () => {
    const repeated = fitLogistic([[1], [1], [1], [0]], [1, 1, 0, 0], { iterations: 500 });
    const weighted = fitLogistic([[1], [1], [0]], [1, 0, 0], { iterations: 500 }, [2, 1, 1]);
    weighted.forEach((w, i) => expect(w).toBeCloseTo(repeated[i]!, 6));
  });

  it('computes AUC with ties counted half', () => {
    expect(rocAuc([0.9, 0.1], [true, false])).toBe(1);
    expect(rocAuc([0.5, 0.5], [true, false])).toBe(0.5);
    expect(rocAuc([0.5], [true])).toBeNaN();
  });

  it('lists fired signals and validates label names', () => {
    expect(firedSignals({ bot: { detected: true }, tor: { detected: false }, proxy: { detected: true } })).toEqual(['bot', 'proxy']);
    expect(FRAUD_LABEL_PATTERN.test('account_takeover')).toBe(true);
    expect(FRAUD_LABEL_PATTERN.test('Payment')).toBe(false);
    expect(FRAUD_LABEL_PATTERN.test('1st')).toBe(false);
  });
});

describe('context features', () => {
  const base = { matchKind: 'token', confidence: 1, createdAt: new Date('2026-11-18T12:00:00Z'), results: {}, linkedVisitors: [], timezone: 'UTC' };

  it('reads each feature from what the event stores', () => {
    expect(contextFeatures(base)).toEqual([]);
    expect(
      contextFeatures({
        ...base,
        matchKind: 'new',
        results: {
          velocity: { detected: false, details: { visitorsPerIp1h: 3, ipsPerVisitor24h: 3, eventsPerVisitor1h: 5, visitorsPerLinkedId24h: 2 } },
          multiAccount: { detected: false, details: { accountsOnDevice: 2 } },
        },
        linkedVisitors: [{}],
      }),
    ).toEqual(['newVisitor', 'sharedIp', 'manyIps', 'eventBurst', 'sharedAccount', 'multipleAccounts', 'otherBrowsers']);
    expect(contextFeatures({ ...base, matchKind: 'similar', confidence: 0.79 })).toEqual(['weakMatch']);
    expect(contextFeatures({ ...base, matchKind: 'similar', confidence: 0.8 })).toEqual([]);
    expect(contextFeatures({ ...base, results: { accountSharing: { detected: false, details: { devicesForAccount: 2 } } } })).toEqual(['sharedAccount']);
  });

  it("uses the browser's time zone for night, and ignores a bad one", () => {
    const at = new Date('2026-11-18T20:30:00Z'); // 05:30 in Tokyo, 21:30 in Berlin
    expect(contextFeatures({ ...base, createdAt: at, timezone: 'Asia/Tokyo' })).toEqual(['localNight']);
    expect(contextFeatures({ ...base, createdAt: at, timezone: 'Europe/Berlin' })).toEqual([]);
    expect(contextFeatures({ ...base, createdAt: at, timezone: 'Not/AZone' })).toEqual([]);
    expect(contextFeatures({ ...base, createdAt: at, timezone: null })).toEqual([]);
  });

  it('reads account age: new accounts, and old accounts on a new device', () => {
    const at = new Date('2026-11-18T12:00:00Z');
    const ago = (h: number) => new Date(at.getTime() - h * 3_600_000).toISOString();
    const f = (account: { firstSeenAt: string | null; seenOnDevice: boolean } | null) => contextFeatures({ ...base, createdAt: at, account });
    expect(f(null)).toEqual([]);
    expect(f({ firstSeenAt: null, seenOnDevice: false })).toEqual(['newAccount']);
    expect(f({ firstSeenAt: ago(23), seenOnDevice: true })).toEqual(['newAccount']);
    expect(f({ firstSeenAt: ago(25), seenOnDevice: false })).toEqual(['newDeviceForAccount']);
    expect(f({ firstSeenAt: ago(25 * 30), seenOnDevice: true })).toEqual([]);
  });

  it('lists fired signals before context features, and drops unknown ids', () => {
    expect(fraudFeatures({ ...base, matchKind: 'new', results: { bot: { detected: true } } })).toEqual(['bot', 'newVisitor']);
    expect(knownFeatures(['bot', 'newVisitor', 'retiredSignal'])).toEqual(['bot', 'newVisitor']);
  });

  it('separates fraud the signals miss (synthetic data)', () => {
    // Synthetic account takeover: no fraud signal fires; the takeovers come from new browsers on a shared account.
    const examples: FraudExample[] = [];
    const add = (count: number, detected: FraudExample['detected'], fraud: boolean) => {
      for (let i = 0; i < count; i++) examples.push({ detected, fraud });
    };
    add(30, ['newVisitor', 'sharedAccount'], true);
    add(10, ['newVisitor'], true);
    add(10, ['newVisitor', 'sharedAccount'], false);
    add(40, ['newVisitor'], false);
    add(60, [], false);
    add(5, ['vpn'], true);
    add(10, ['vpn'], false);
    const signalsOnly = examples.map((e) => ({ ...e, detected: e.detected.filter((d) => d === 'vpn') }));
    const withContext = trainFraudModel('ato', examples)!;
    const withoutContext = trainFraudModel('ato', signalsOnly)!;
    expect(withContext.cvAuc!).toBeGreaterThan(0.8);
    expect(withoutContext.cvAuc!).toBeLessThan(0.65);
    expect(scoreFraud(withContext, ['newVisitor', 'sharedAccount']).reasons).toEqual(['sharedAccount', 'newVisitor']);
  });
});
