import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002'),
  title: 'Anonymous Feedback — Speak freely',
  description: 'A private space to share workplace feedback without revealing who said it.',
  openGraph: {
    title: 'Anonymous Feedback',
    description: 'Say what needs to be said.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Anonymous Feedback',
    description: 'Say what needs to be said.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
