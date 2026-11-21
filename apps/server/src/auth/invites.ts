import { type PrismaService } from '../infra/prisma.service.js';

export const INVITE_DAYS = 14;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Whether this address has an unexpired invitation: that is what lets someone sign up on a closed server. */
export async function hasPendingInvite(prisma: PrismaService, email: string): Promise<boolean> {
  return (await prisma.projectInvite.count({ where: { email: normalizeEmail(email), expiresAt: { gt: new Date() } } })) > 0;
}

/** Turns every unexpired invitation for the address into a membership, then removes them. Returns how many. */
export async function acceptInvites(prisma: PrismaService, userId: string, email: string): Promise<number> {
  const invites = await prisma.projectInvite.findMany({ where: { email: normalizeEmail(email), expiresAt: { gt: new Date() } } });
  for (const i of invites) {
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: i.projectId, userId } },
      create: { projectId: i.projectId, userId, role: i.role },
      update: {},
    });
  }
  await prisma.projectInvite.deleteMany({ where: { email: normalizeEmail(email) } });
  return invites.length;
}
