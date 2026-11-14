import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'tbdname',
  description: 'Self-hostable device identification and fraud signals',
  cleanUrls: true,
  lastUpdated: false,
  srcExclude: ['LICENSE'],
  themeConfig: {
    nav: [
      { text: 'Quickstart', link: '/quickstart' },
      { text: 'API', link: '/api' },
      { text: 'Signals', link: '/signals' },
    ],
    sidebar: [
      {
        text: 'Start',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Quickstart (15 minutes)', link: '/quickstart' },
        ],
      },
      {
        text: 'Integrate',
        items: [
          { text: 'SDKs and verification', link: '/integration' },
          { text: 'API reference', link: '/api' },
          { text: 'Signal catalog', link: '/signals' },
        ],
      },
      {
        text: 'Operate',
        items: [
          { text: 'Self-hosting guide', link: '/self-hosting' },
          { text: 'Configuration reference', link: '/configuration' },
          { text: 'Privacy guide', link: '/privacy' },
          { text: 'Accuracy', link: '/accuracy' },
        ],
      },
    ],
    footer: { message: 'Docs licensed CC BY 4.0. Server AGPL-3.0, SDKs MIT.' },
    search: { provider: 'local' },
  },
});
