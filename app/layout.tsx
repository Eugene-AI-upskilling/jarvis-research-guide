import type { Metadata, Viewport } from 'next';
import { Orbitron, Rajdhani, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const orbitron = Orbitron({
  subsets: ['latin'],
  weight: ['500', '700', '900'],
  variable: '--next-font-orbitron',
  display: 'swap',
});

const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--next-font-rajdhani',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--next-font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'J.A.R.V.I.S. — AI 리서치 가이드',
  description: '시장·종목 질문을 말과 자료 카드로 설명하는 AI 리서치 가이드',
  applicationName: 'JARVIS Research Guide',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#000814',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ko"
      className={`${orbitron.variable} ${rajdhani.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link
          rel="preconnect"
          href="https://cdn.jsdelivr.net"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
        <style>{`
          :root {
            --font-orbitron: var(--next-font-orbitron), "Pretendard", system-ui, sans-serif;
            --font-rajdhani: var(--next-font-rajdhani), "Pretendard", system-ui, sans-serif;
            --font-jetbrains: var(--next-font-jetbrains), ui-monospace, monospace;
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
