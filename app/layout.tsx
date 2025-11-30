import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kraken Funding Rate Trader',
  description: 'Automated trading signals based on funding rate mean reversion',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
