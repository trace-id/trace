'use client';

import { Boxes, Database, Globe2 } from 'lucide-react';
import { Clients } from '@/components/integrations/clients';
import { IpProviders } from '@/components/integrations/ip-providers';
import { RedisSettings } from '@/components/integrations/redis';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { PageHeader } from '@/components/ui/primitives';

const tab = (icon: React.ReactNode, label: string) => <span className="inline-flex items-center gap-1.5">{icon} {label}</span>;

export default function IntegrationsPage() {
  return (
    <>
      <PageHeader title="Integrations" description="The services Trace uses and the clients that send it events. Provider and Redis settings apply to the whole server, not one project." />
      <Tabs defaultValue="ip">
        <TabsList>
          <TabsTrigger value="ip">{tab(<Globe2 className="size-3.5" />, 'IP intelligence')}</TabsTrigger>
          <TabsTrigger value="redis">{tab(<Database className="size-3.5" />, 'Redis')}</TabsTrigger>
          <TabsTrigger value="clients">{tab(<Boxes className="size-3.5" />, 'Clients')}</TabsTrigger>
        </TabsList>
        <TabsContent value="ip" className="mt-5"><IpProviders /></TabsContent>
        <TabsContent value="redis" className="mt-5"><RedisSettings /></TabsContent>
        <TabsContent value="clients" className="mt-5"><Clients /></TabsContent>
      </Tabs>
    </>
  );
}
