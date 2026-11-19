import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { type EventLabelResponse, type EventLabelsResponse, type FraudModelsResponse } from '@trace-id/signals/api';
import {
  FRAUD_LABEL_PATTERN,
  FRAUD_MODEL_MINIMUM,
  type FraudModel,
  type FraudScore,
  type FeatureSource,
  fraudFeatures,
  knownFeatures,
  scoreFraud,
  trainFraudModel,
} from '@trace-id/signals/fraud-score';
import { ApiError } from '../common/api-error.js';
import { uuidv7Time } from '../common/ids.js';
import { describeError } from '../common/log-safe.js';
import { type StoredSignals } from '../events/event-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';

/** Fraud types per project; keeps one tenant from growing the model table without bound. */
export const MAX_FRAUD_LABELS = 20;
/** Newest labels per type used for training. */
export const MAX_TRAINING_LABELS = 50_000;
const MODEL_CACHE_MS = 60_000;
const TRAIN_DELAY_MS = 30_000;


/**
 * Labels, training and scoring for the per-project fraud score. Labels are written by the customer's backend (secret
 * key); models are retrained 30 s after the last label change, on demand, and in the maintenance pass.
 */
@Injectable()
export class FraudService implements OnModuleDestroy {
  private readonly logger = new Logger('Fraud');
  private readonly cache = new Map<string, { at: number; models: FraudModel[] }>();
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(private readonly prisma: PrismaService) {}

  onModuleDestroy(): void {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
  }

  /** The project's trained models, cached for a minute. */
  async modelsFor(projectId: string, now = Date.now()): Promise<FraudModel[]> {
    const hit = this.cache.get(projectId);
    if (hit && now - hit.at < MODEL_CACHE_MS) return hit.models;
    const rows = await this.prisma.fraudModel.findMany({ where: { projectId }, orderBy: { label: 'asc' } });
    const models = rows.map((r) => r.model as unknown as FraudModel);
    this.cache.set(projectId, { at: now, models });
    return models;
  }

  /** Scores an event: its fired signals plus context features (see CONTEXT_FEATURES). */
  score(models: readonly FraudModel[], source: FeatureSource): FraudScore[] {
    if (models.length === 0) return [];
    const features = fraudFeatures(source);
    return models.map((m) => scoreFraud(m, features));
  }

  async label(projectId: string, eventId: string, label: string, body: unknown): Promise<EventLabelResponse> {
    if (!FRAUD_LABEL_PATTERN.test(label)) {
      throw ApiError.badRequest('label must be lowercase letters, digits and _, starting with a letter, up to 32', 'invalid_label');
    }
    const fraud = (body as { fraud?: unknown } | null)?.fraud;
    if (typeof fraud !== 'boolean' || Object.keys(body as object).length !== 1) {
      throw ApiError.badRequest('Body must be {"fraud": true|false}');
    }
    const createdAt = uuidv7Time(eventId);
    if (!createdAt) throw ApiError.badRequest('eventId is not a valid event id', 'invalid_event_id');
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, createdAt, projectId },
      select: { visitorId: true, signals: true, matchKind: true, confidence: true, createdAt: true },
    });
    if (!event) throw ApiError.notFound('Event not found');

    const existing = await this.prisma.eventLabel.findMany({ where: { projectId }, distinct: ['label'], select: { label: true } });
    if (!existing.some((l) => l.label === label) && existing.length >= MAX_FRAUD_LABELS) {
      throw new ApiError(409, 'limit_reached', `A project can have at most ${MAX_FRAUD_LABELS} fraud types`);
    }
    const stored = event.signals as unknown as StoredSignals;
    // The same features the event was scored with, so training matches scoring.
    const detected = fraudFeatures({
      matchKind: event.matchKind,
      confidence: event.confidence,
      createdAt: event.createdAt,
      results: stored.results ?? {},
      linkedVisitors: stored.linkedVisitors ?? [],
      timezone: stored.attributes?.timezone ?? null,
      account: stored.account ?? null,
    });
    await this.prisma.eventLabel.upsert({
      where: { projectId_eventId_label: { projectId, eventId, label } },
      create: { projectId, eventId, label, fraud, visitorId: event.visitorId, detected },
      update: { fraud, detected },
    });
    this.scheduleTraining(projectId);
    return { eventId, label, fraud };
  }

  async labelsOf(projectId: string, eventId: string): Promise<EventLabelsResponse> {
    const rows = await this.prisma.eventLabel.findMany({
      where: { projectId, eventId },
      orderBy: { label: 'asc' },
      select: { label: true, fraud: true, updatedAt: true },
    });
    return { labels: rows.map((r) => ({ label: r.label, fraud: r.fraud, updatedAt: r.updatedAt.toISOString() })) };
  }

  async unlabel(projectId: string, eventId: string, label: string): Promise<void> {
    const { count } = await this.prisma.eventLabel.deleteMany({ where: { projectId, eventId, label } });
    if (count === 0) throw ApiError.notFound('Label not found');
    this.scheduleTraining(projectId);
  }

  /** Retrains every fraud type of the project now. */
  async train(projectId: string, now = new Date()): Promise<FraudModelsResponse> {
    const pending = this.pending.get(projectId);
    if (pending) clearTimeout(pending);
    this.pending.delete(projectId);

    const labels = await this.prisma.eventLabel.findMany({ where: { projectId }, distinct: ['label'], select: { label: true } });
    for (const { label } of labels) await this.trainLabel(projectId, label, now);
    // Models whose labels were all deleted.
    await this.prisma.fraudModel.deleteMany({ where: { projectId, label: { notIn: labels.map((l) => l.label) } } });
    this.cache.delete(projectId);
    return this.list(projectId);
  }

  async list(projectId: string): Promise<FraudModelsResponse> {
    const [rows, counts, fraudCounts] = await Promise.all([
      this.prisma.fraudModel.findMany({ where: { projectId }, orderBy: { label: 'asc' } }),
      this.prisma.eventLabel.groupBy({ by: ['label'], where: { projectId }, _count: { _all: true } }),
      this.prisma.eventLabel.groupBy({ by: ['label'], where: { projectId, fraud: true }, _count: { _all: true } }),
    ]);
    const models = rows.map((r) => {
      const { version: _version, ...rest } = r.model as unknown as FraudModel;
      return rest;
    });
    const trained = new Set(models.map((m) => m.label));
    const positives = new Map(fraudCounts.map((c) => [c.label, c._count._all]));
    const untrained = counts
      .filter((c) => !trained.has(c.label))
      .map((c) => ({ label: c.label, n: c._count._all, positives: positives.get(c.label) ?? 0 }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { models, untrained };
  }

  /** Maintenance: retrains the types whose labels changed since their model was trained. */
  async trainStale(now = new Date()): Promise<{ trained: number }> {
    const [stats, models] = await Promise.all([
      this.prisma.eventLabel.groupBy({ by: ['projectId', 'label'], _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.fraudModel.findMany({ select: { projectId: true, label: true, trainedAt: true, model: true } }),
    ]);
    const byKey = new Map(models.map((m) => [`${m.projectId}|${m.label}`, m]));
    let trained = 0;
    for (const s of stats) {
      const key = `${s.projectId}|${s.label}`;
      const m = byKey.get(key);
      byKey.delete(key);
      const n = Math.min(s._count._all, MAX_TRAINING_LABELS);
      if (!m && n < FRAUD_MODEL_MINIMUM.examples) continue;
      const stale = !m || (s._max.updatedAt ?? now) > m.trainedAt || (m.model as unknown as FraudModel).n !== n;
      if (!stale) continue;
      await this.trainLabel(s.projectId, s.label, now);
      this.cache.delete(s.projectId);
      trained++;
    }
    for (const m of byKey.values()) {
      await this.prisma.fraudModel.deleteMany({ where: { projectId: m.projectId, label: m.label } });
      this.cache.delete(m.projectId);
    }
    return { trained };
  }

  private async trainLabel(projectId: string, label: string, now: Date): Promise<FraudModel | null> {
    const rows = await this.prisma.eventLabel.findMany({
      where: { projectId, label },
      orderBy: { updatedAt: 'desc' },
      take: MAX_TRAINING_LABELS,
      select: { fraud: true, detected: true },
    });
    const model = trainFraudModel(
      label,
      rows.map((r) => ({ fraud: r.fraud, detected: knownFeatures(r.detected) })),
      { now },
    );
    if (!model) {
      await this.prisma.fraudModel.deleteMany({ where: { projectId, label } });
      return null;
    }
    const data = { model: model as unknown as Prisma.InputJsonObject, trainedAt: now };
    await this.prisma.fraudModel.upsert({
      where: { projectId_label: { projectId, label } },
      create: { projectId, label, ...data },
      update: data,
    });
    return model;
  }

  private scheduleTraining(projectId: string): void {
    const previous = this.pending.get(projectId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.pending.delete(projectId);
      this.train(projectId).catch((err: unknown) => this.logger.error(`training failed: ${describeError(err)}`));
    }, TRAIN_DELAY_MS);
    timer.unref();
    this.pending.set(projectId, timer);
  }
}
