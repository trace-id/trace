import { SIGNAL_IDS } from '@trace-id/signals/config';
import { FRAUD_FEATURES } from '@trace-id/signals/fraud-score';
import { WEBHOOK_TYPES } from '@trace-id/signals/api';

/**
 * OpenAPI 3.1 description of the public v1 API (what SDKs, backends and agents call). The dashboard's session-only
 * management routes are left out. Served at GET /openapi.json.
 */

const error = (description: string) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const id20 = { type: 'string', pattern: '^[0-9A-Za-z]{20}$' };

export const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Trace API',
    version: '1.0.0',
    description:
      'Device identification and fraud signals. The browser SDK calls POST /v1/identify with a public key; your backend reads the verified event with a secret key. Only the verified event should drive decisions.',
    license: { name: 'AGPL-3.0', identifier: 'AGPL-3.0-only' },
  },
  servers: [{ url: 'https://id.example.com', description: 'Your trace server' }],
  security: [{ secretKey: [] }],
  tags: [
    { name: 'Identify', description: 'Called by the browser SDK' },
    { name: 'Events', description: 'Verify an identification on your backend' },
    { name: 'Visitors', description: 'History and deletion' },
    { name: 'Devices', description: 'Browsers and accounts on one device' },
    { name: 'Webhooks', description: 'Push events to your backend' },
    { name: 'Fraud score', description: 'Label events; Trace learns a score per fraud type' },
    { name: 'Health' },
  ],
  paths: {
    '/v1/identify': {
      post: {
        tags: ['Identify'],
        operationId: 'identify',
        summary: 'Identify the browser (SDK only)',
        description:
          'Sent by @trace-id/sdk-js with Content-Type text/plain (a CORS simple request). The response is deliberately small; verify eventId on your server. Body capped at 64 KB.',
        security: [{ publicKey: [] }],
        parameters: [{ name: 'apiKey', in: 'query', required: true, schema: { type: 'string', pattern: '^pk_' } }],
        requestBody: { required: true, content: { 'text/plain': { schema: { $ref: '#/components/schemas/IdentifyRequest' } }, 'application/json': { schema: { $ref: '#/components/schemas/IdentifyRequest' } } } },
        responses: {
          '200': { description: 'Identified', content: { 'application/json': { schema: { $ref: '#/components/schemas/IdentifyResponse' } } } },
          '400': error('Invalid request'),
          '401': error('Invalid API key'),
          '403': error('Origin not allowed for this key'),
          '429': error('Rate limited (see Retry-After)'),
        },
      },
    },
    '/v1/identify/forget': {
      post: {
        tags: ['Identify'],
        operationId: 'forgetVisitorCookie',
        summary: 'Clear the first-party visitor cookie',
        security: [{ publicKey: [] }],
        parameters: [{ name: 'apiKey', in: 'query', required: true, schema: { type: 'string', pattern: '^pk_' } }],
        responses: { '204': { description: 'Cookie cleared' } },
      },
    },
    '/v1/events/{eventId}': {
      get: {
        tags: ['Events'],
        operationId: 'getEvent',
        summary: 'Get a verified event',
        description: 'The full server-side record of one identification, readable for EVENT_VERIFY_WINDOW_MINUTES (default 60).',
        parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'The event', content: { 'application/json': { schema: { $ref: '#/components/schemas/Event' } } } },
          '401': error('Missing or invalid secret key'),
          '404': error('No such event in this project'),
          '410': error('Past the verification window'),
          '429': error('Rate limited'),
        },
      },
    },
    '/v1/events/{eventId}/labels/{label}': {
      put: {
        tags: ['Fraud score'],
        operationId: 'labelEvent',
        summary: 'Label an event as fraud or legit for one fraud type',
        description: 'Training data for the fraud score. The signals that fired are copied into the label, so it outlives event retention. Models retrain 30 s after the last change.',
        parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'label', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,31}$' }, description: 'Fraud type, e.g. payment or account_takeover' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['fraud'], additionalProperties: false, properties: { fraud: { type: 'boolean' } } } } } },
        responses: {
          '200': { description: 'Labelled', content: { 'application/json': { schema: { type: 'object', properties: { eventId: { type: 'string' }, label: { type: 'string' }, fraud: { type: 'boolean' } } } } } },
          '400': error('Invalid event id, label or body'),
          '404': error('No such event in this project'),
          '409': error('Project already has 20 fraud types'),
        },
      },
      delete: {
        tags: ['Fraud score'],
        operationId: 'unlabelEvent',
        summary: 'Remove a label',
        parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'label', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,31}$' }, description: 'Fraud type, e.g. payment or account_takeover' }],
        responses: { '204': { description: 'Removed' }, '404': error('No such label') },
      },
    },
    '/v1/fraud-models': {
      get: {
        tags: ['Fraud score'],
        operationId: 'listFraudModels',
        summary: 'Trained models and fraud types still short of labels',
        responses: { '200': { description: 'Models', content: { 'application/json': { schema: { $ref: '#/components/schemas/FraudModels' } } } } },
      },
    },
    '/v1/fraud-models/train': {
      post: {
        tags: ['Fraud score'],
        operationId: 'trainFraudModels',
        summary: 'Retrain every fraud type now',
        responses: { '200': { description: 'Models', content: { 'application/json': { schema: { $ref: '#/components/schemas/FraudModels' } } } } },
      },
    },
    '/v1/visitors/{visitorId}': {
      get: {
        tags: ['Visitors'],
        operationId: 'getVisitor',
        summary: 'Visitor history',
        parameters: [
          { name: 'visitorId', in: 'path', required: true, schema: id20 },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'nextCursor of the previous page' },
        ],
        responses: {
          '200': { description: 'History, newest first', content: { 'application/json': { schema: { $ref: '#/components/schemas/VisitorHistory' } } } },
          '400': error('Invalid visitorId or cursor'),
          '404': error('Visitor not found'),
        },
      },
      delete: {
        tags: ['Visitors'],
        operationId: 'deleteVisitor',
        summary: 'Delete a visitor and all of its events (permanent)',
        parameters: [{ name: 'visitorId', in: 'path', required: true, schema: id20 }],
        responses: { '204': { description: 'Deleted' }, '404': error('Visitor not found') },
      },
    },
    '/v1/devices/{deviceId}': {
      get: {
        tags: ['Devices'],
        operationId: 'getDevice',
        summary: 'Device graph',
        description: 'Every browser (visitor) sharing this deviceId and every account (linkedId) seen on them.',
        parameters: [{ name: 'deviceId', in: 'path', required: true, schema: id20 }],
        responses: {
          '200': { description: 'The device', content: { 'application/json': { schema: { $ref: '#/components/schemas/Device' } } } },
          '400': error('Invalid deviceId'),
          '404': error('Device not found'),
        },
      },
    },
    '/v1/webhooks': {
      get: {
        tags: ['Webhooks'],
        operationId: 'listWebhooks',
        summary: 'List webhook endpoints',
        responses: { '200': { description: 'Endpoints', content: { 'application/json': { schema: { type: 'object', properties: { endpoints: { type: 'array', items: { $ref: '#/components/schemas/WebhookEndpoint' } } } } } } } },
      },
      post: {
        tags: ['Webhooks'],
        operationId: 'createWebhook',
        summary: 'Create a webhook endpoint',
        description: 'The signing secret (whsec_...) is returned only here. Deliveries carry X-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url', 'events'],
                additionalProperties: false,
                properties: {
                  url: { type: 'string', format: 'uri', maxLength: 2048, description: 'https only' },
                  events: { type: 'array', items: { type: 'string', enum: [...WEBHOOK_TYPES] }, uniqueItems: true },
                  flagThreshold: { type: 'integer', minimum: 1, maximum: 100, description: 'Suspect score from which visitor.flagged fires' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookEndpoint' } } } }, '400': error('Invalid URL or events') },
      },
    },
    '/v1/webhooks/{id}': {
      delete: {
        tags: ['Webhooks'],
        operationId: 'deleteWebhook',
        summary: 'Delete a webhook endpoint',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'Deleted' }, '404': error('Not found') },
      },
    },
    '/health': { get: { tags: ['Health'], operationId: 'health', security: [], summary: 'Liveness', responses: { '200': { description: 'Up' } } } },
    '/health/ready': { get: { tags: ['Health'], operationId: 'ready', security: [], summary: 'Readiness (database reachable)', responses: { '200': { description: 'Ready' }, '503': { description: 'Database unavailable' } } } },
  },
  components: {
    securitySchemes: {
      secretKey: { type: 'http', scheme: 'bearer', description: 'Secret key sk_... (server side only)' },
      publicKey: { type: 'apiKey', in: 'query', name: 'apiKey', description: 'Public key pk_..., checked against allowed origins' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } } },
      },
      IdentifyRequest: {
        type: 'object',
        required: ['signals', 'sdk'],
        properties: {
          signals: { type: 'object', description: 'Payload collected and hashed by @trace-id/sdk-js; not meant to be built by hand.' },
          token: { type: 'string' },
          linkedId: { type: 'string', maxLength: 256, description: 'Your own account id' },
          tags: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] }, maxProperties: 10 },
          sdk: { type: 'object', properties: { name: { type: 'string' }, version: { type: 'string' } } },
          sentAt: { type: 'integer' },
        },
      },
      IdentifyResponse: {
        type: 'object',
        required: ['eventId', 'visitorId', 'deviceId', 'confidence', 'suspectScore', 'token'],
        properties: {
          eventId: { type: 'string', format: 'uuid' },
          visitorId: id20,
          deviceId: { ...id20, description: 'Shared by every browser on the device' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          suspectScore: { type: 'integer', minimum: 0, maximum: 100 },
          token: { type: 'string' },
          sealedResult: { type: 'string', description: 'Full event, AES-256-GCM encrypted (only with SEALED_RESULTS_KEY)' },
        },
      },
      SignalResult: {
        type: 'object',
        required: ['detected', 'details'],
        properties: { detected: { type: 'boolean' }, details: { type: 'object', description: 'Signal-specific; details.available false means not evaluated on this server' } },
      },
      LinkedVisitor: {
        type: 'object',
        properties: {
          visitorId: id20,
          confidence: { type: 'number' },
          browser: { type: 'string' },
          sameNetwork: { type: 'boolean' },
          sharedNetworks: { type: 'integer' },
          via: { type: 'string', enum: ['sharedNetwork', 'rareHardware'] },
          lastSeenAt: { type: 'string', format: 'date-time' },
        },
      },
      Event: {
        type: 'object',
        required: ['eventId', 'visitorId', 'deviceId', 'confidence', 'matchKind', 'suspectScore', 'reasons', 'signals', 'createdAt', 'expiresAt'],
        properties: {
          eventId: { type: 'string', format: 'uuid' },
          visitorId: id20,
          deviceId: id20,
          confidence: { type: 'number' },
          matchKind: { type: 'string', enum: ['token', 'similar', 'new'] },
          suspectScore: { type: 'integer', minimum: 0, maximum: 100 },
          reasons: { type: 'array', items: { type: 'object', properties: { signal: { type: 'string', enum: [...SIGNAL_IDS] }, contribution: { type: 'number' } } } },
          signals: { type: 'object', properties: Object.fromEntries(SIGNAL_IDS.map((id) => [id, { $ref: '#/components/schemas/SignalResult' }])) },
          components: { type: 'object', additionalProperties: { type: 'string' }, description: 'Hashed components' },
          attributes: { type: 'object' },
          ip: { type: 'object', properties: { address: { type: ['string', 'null'] }, country: { type: ['string', 'null'] }, asn: { type: ['integer', 'null'] } } },
          tags: { type: ['object', 'null'] },
          linkedId: { type: ['string', 'null'] },
          linkedVisitors: { type: 'array', items: { $ref: '#/components/schemas/LinkedVisitor' } },
          fraudScores: {
            type: 'array',
            description: 'Per fraud type, from models trained on this project\'s labels. Absent until a type is trained.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                probability: { type: 'number', minimum: 0, maximum: 1 },
                reasons: { type: 'array', items: { type: 'string', enum: [...FRAUD_FEATURES] } },
              },
            },
          },
          createdAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      VisitorHistory: {
        type: 'object',
        properties: {
          visitorId: id20,
          deviceId: id20,
          firstSeenAt: { type: 'string', format: 'date-time' },
          lastSeenAt: { type: 'string', format: 'date-time' },
          eventCount: { type: 'integer' },
          events: { type: 'array', items: { type: 'object' } },
          nextCursor: { type: ['string', 'null'] },
        },
      },
      Device: {
        type: 'object',
        properties: {
          deviceId: id20,
          visitors: { type: 'array', items: { type: 'object', properties: { visitorId: id20, browser: { type: ['string', 'null'] }, firstSeenAt: { type: 'string' }, lastSeenAt: { type: 'string' }, eventCount: { type: 'integer' } } } },
          accounts: { type: 'array', items: { type: 'object', properties: { linkedId: { type: 'string' }, firstSeenAt: { type: 'string' }, lastSeenAt: { type: 'string' }, visitorIds: { type: 'array', items: id20 } } } },
        },
      },
      FraudModels: {
        type: 'object',
        properties: {
          models: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                trainedAt: { type: 'string', format: 'date-time' },
                n: { type: 'integer' },
                positives: { type: 'integer' },
                intercept: { type: 'number' },
                coefficients: { type: 'object', additionalProperties: { type: 'number' }, description: 'Log-odds per signal or context feature' },
                cvAuc: { type: ['number', 'null'], description: '5-fold cross-validated ROC AUC on the labels' },
              },
            },
          },
          untrained: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, n: { type: 'integer' }, positives: { type: 'integer' } } } },
        },
      },
      WebhookEndpoint: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          url: { type: 'string' },
          events: { type: 'array', items: { type: 'string', enum: [...WEBHOOK_TYPES] } },
          flagThreshold: { type: 'integer' },
          enabled: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          secret: { type: 'string', description: 'Only in the create response' },
        },
      },
    },
  },
} as const;
