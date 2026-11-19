'use client';

import type { MeResponse } from '@trace-id/signals/api';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Wordmark } from '@/components/shell/shell';
import { ErrorBanner, Spinner } from '@/components/ui/primitives';
import { useApi } from '@/lib/use-api';

export default function Home() {
  const router = useRouter();
  const me = useApi<MeResponse>('/v1/me');
  const first = me.data?.projects[0];

  useEffect(() => {
    if (me.data) router.replace(first ? `/projects/${first.id}` : '/projects/new');
  }, [me.data, first, router]);

  return (
    <div className="grid min-h-screen place-items-center">
      <div className="grid justify-items-center gap-5">
        <Wordmark />
        {me.error ? <ErrorBanner message={me.error} /> : <Spinner />}
      </div>
    </div>
  );
}
