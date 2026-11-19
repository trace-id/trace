import type { Metadata, Viewport } from 'next';
import { Fragment_Mono, Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { THEME_SCRIPT, ThemeProvider } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Trace', template: '%s · Trace' },
  description: 'Device intelligence and fraud signals.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8f8f6' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0d10' },
  ],
};

const sans = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = Fragment_Mono({ subsets: ['latin'], weight: ['400'], variable: '--font-fragment', display: 'swap' });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
