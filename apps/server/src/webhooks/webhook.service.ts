import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { type EventResponse, type WebhookType } from '@tbdname/signals/api';
import { PrismaService } from '../infra/prisma.service.js';

interface EndpointSummary {
  id: string;
  events: string[];
  flagThreshold: number;
}

const CACHE_TTL_MS = 30_000;

/**
 * Decides which deliveries an event creates. Deliveries are written in the same transaction
 * as the event, so a crash cannot lose one. Endpoint lists are cached per project for 30 s.
 */
@Injectable()
export class WebhookService {
  private readonly cache = new Map<string, { endpoints: EndpointSummary[]; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  invalidate(projectId: string): void {
    this.cache.delete(projectId);
  }

  private async endpoints(projectId: string): Promise<EndpointSummary[]> {
    const now = Date.now();
    const cached = this.cache.get(projectId);
    if (cached && cached.expiresAt > now) return cached.endpoints;
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { projectId, enabled: true },
      select: { id: true, events: true, flagThreshold: true },
    });
    if (this.cache.size > 10_000) this.cache.clear();
    this.cache.set(projectId, { endpoints, expiresAt: now + CACHE_TTL_MS });
    return endpoints;
  }

  async deliveriesFor(projectId: string, event: EventResponse, now: Date): Promise<Prisma.WebhookDeliveryCreateManyInput[]> {
    const out: Prisma.WebhookDeliveryCreateManyInput[] = [];
    for (const endpoint of await this.endpoints(projectId)) {
      const types: WebhookType[] = [];
      if (endpoint.events.includes('event.created')) types.push('event.created');
      if (endpoint.events.includes('visitor.flagged') && event.suspectScore >= endpoint.flagThreshold) {
        types.push('visitor.flagged');
      }
      for (const type of types) {
        out.push({
          id: randomUUID(),
          endpointId: endpoint.id,
          visitorId: event.visitorId,
          eventId: event.eventId,
          type,
          payload: event as unknown as Prisma.InputJsonObject,
          nextAttemptAt: now,
        });
      }
    }
    return out;
  }
}
