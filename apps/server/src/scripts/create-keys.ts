import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { generateKey } from '../keys/key-crypto.js';
import { isValidOriginPattern } from '../keys/origins.js';

const USAGE = `Usage: npm run keys:create -w tbdname-server -- --project <name> --origins <origin[,origin...]> [--project-id <uuid>]

Creates a project (unless --project-id is given) with one public and one secret key.
Keys are printed once and stored only as SHA-256 hashes.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      'project-id': { type: 'string' },
      origins: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || (!values.project && !values['project-id']) || !values.origins) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  const origins = values.origins.split(',').map((o) => o.trim()).filter(Boolean);
  const invalid = origins.filter((o) => !isValidOriginPattern(o));
  if (invalid.length > 0) {
    console.error(`Invalid origin(s): ${invalid.join(', ')} (expected e.g. https://app.example.com or https://*.example.com)`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const projectId =
      values['project-id'] ?? (await prisma.project.create({ data: { name: values.project ?? 'default' } })).id;
    const pub = generateKey('public');
    const sec = generateKey('secret');
    await prisma.apiKey.createMany({
      data: [
        { projectId, type: 'public', prefix: pub.prefix, hash: pub.hash, allowedOrigins: origins, name: 'default public' },
        { projectId, type: 'secret', prefix: sec.prefix, hash: sec.hash, name: 'default secret' },
      ],
    });
    console.log(`project:    ${projectId}`);
    console.log(`public key: ${pub.key}`);
    console.log(`secret key: ${sec.key}`);
    console.log(`origins:    ${origins.join(', ')}`);
    console.log('\nStore the secret key now; it cannot be shown again.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
