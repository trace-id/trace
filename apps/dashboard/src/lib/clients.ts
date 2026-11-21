/** Friendly names for the client packages that send events. Unknown names (a custom client) are shown as they are. */
const CLIENTS: Record<string, string> = {
  '@trace-id/sdk-js': 'JavaScript',
  '@trace-id/sdk-react': 'React',
  '@trace-id/sdk-next': 'Next.js',
  '@trace-id/sdk-vue': 'Vue',
  '@trace-id/sdk-nuxt': 'Nuxt',
  '@trace-id/sdk-svelte': 'Svelte',
  '@trace-id/sdk-angular': 'Angular',
  '@trace-id/sdk-solid': 'Solid',
  '@trace-id/sdk-react-native': 'React Native and Expo',
  trace_device: 'Flutter',
  'dev.trace.device': 'Android (Kotlin)',
  TraceDevice: 'iOS (Swift)',
};

export function clientName(packageName: string): string {
  return CLIENTS[packageName] ?? packageName;
}

/** "@trace-id/sdk-react 0.1.0" (the analytics key) as "React 0.1.0". */
export function clientLabel(key: string): string {
  const at = key.lastIndexOf(' ');
  if (at <= 0) return clientName(key);
  return `${clientName(key.slice(0, at))} ${key.slice(at + 1)}`;
}
