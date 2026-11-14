/**
 * Text for logging an unexpected error. Prisma errors embed the query arguments in their
 * message (signals, stored IPs, linkedIds), so for those only the class, code and the
 * failing model/field names are logged, never the message.
 */
export function describeError(err: unknown): string {
  if (typeof err !== 'object' || err === null) return 'Unknown error';
  const e = err as { name?: unknown; code?: unknown; clientVersion?: unknown; meta?: unknown; stack?: unknown; message?: unknown };
  if (typeof e.clientVersion === 'string') {
    const meta = e.meta as { modelName?: unknown; target?: unknown } | undefined;
    const target = Array.isArray(meta?.target) ? meta.target.join(',') : typeof meta?.target === 'string' ? meta.target : '';
    const model = typeof meta?.modelName === 'string' ? meta.modelName : '';
    return `${String(e.name ?? 'PrismaError')} code=${String(e.code ?? '-')}${model ? ` model=${model}` : ''}${target ? ` target=${target}` : ''}`;
  }
  if (typeof e.stack === 'string') return e.stack;
  return typeof e.message === 'string' ? e.message : 'Unknown error';
}
