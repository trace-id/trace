import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError } from 'better-auth/api';
import { type Env } from '../config/env.js';
import { type PrismaService } from '../infra/prisma.service.js';
import { acceptInvites, hasPendingInvite } from './invites.js';

export const AUTH = Symbol('AUTH');

export const CLIENT_IP_HEADER = 'x-trace-client-ip';

/** Client-controlled headers that IP-aware libraries might otherwise trust. */
export const SPOOFABLE_IP_HEADERS = [
  'x-forwarded-for',
  'x-real-ip',
  'x-client-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'fastly-client-ip',
  'x-cluster-client-ip',
  'forwarded',
  CLIENT_IP_HEADER,
];

/** The first account may always be created; later ones when sign-up is enabled or the address was invited to a project. */
export async function signupAllowed(prisma: PrismaService, env: Env, email?: string): Promise<boolean> {
  if (env.DASHBOARD_ALLOW_SIGNUP) return true;
  if ((await prisma.user.count()) === 0) return true;
  return email !== undefined && (await hasPendingInvite(prisma, email));
}

export function createAuth(env: Env, prisma: PrismaService) {
  return betterAuth({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secret: env.AUTH_SECRET,
    baseURL: env.DASHBOARD_URL,
    basePath: '/api/auth',
    trustedOrigins: [new URL(env.DASHBOARD_URL).origin],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    telemetry: { enabled: false },
    // On in every environment (Better Auth's default is production only). In-memory, so the
    // limits apply per server instance.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 3600, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: env.DASHBOARD_URL.startsWith('https://'),
      // Only the header the server itself sets from the TRUST_PROXY-aware request IP;
      // client-sent X-Forwarded-For is stripped so it cannot rotate rate-limit buckets.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!(await signupAllowed(prisma, env, user.email))) {
              throw new APIError('FORBIDDEN', { message: 'Sign-up is disabled' });
            }
            return { data: user };
          },
          // Whoever was invited gets their projects the moment the account exists.
          after: async (user) => {
            await acceptInvites(prisma, user.id, user.email);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export function toHeaders(raw: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  return headers;
}
