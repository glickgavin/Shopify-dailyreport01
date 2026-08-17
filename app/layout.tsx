import type { Metadata } from 'next';
import { Figtree, Caprasimo } from 'next/font/google';
import './globals.css';

const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree', display: 'swap' });
const caprasimo = Caprasimo({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-caprasimo',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Shopify Daily Report',
  description: 'Automated daily Shopify sales dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${caprasimo.variable}`}>
      <body>{children}</body>
    </html>
  );
}
