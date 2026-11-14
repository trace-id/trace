import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError } from 'better-auth/api';
import { type Env } from '../config/env.js';
import { type PrismaService } from '../infra/prisma.service.js';

export const AUTH = Symbol('AUTH');

/** The first account may always be created; later ones only when sign-up is enabled. */
export async function signupAllowed(prisma: PrismaService, env: Env): Promise<boolean> {
  if (env.DASHBOARD_ALLOW_SIGNUP) return true;
  return (await prisma.user.count()) === 0;
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
    advanced: { useSecureCookies: env.DASHBOARD_URL.startsWith('https://') },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!(await signupAllowed(prisma, env))) {
              throw new APIError('FORBIDDEN', { message: 'Sign-up is disabled' });
            }
            return { data: user };
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
