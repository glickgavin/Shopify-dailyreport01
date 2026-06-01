export type SystemStatus = 'operational' | 'degraded' | 'building';

export interface SystemEntry {
  id: string;
  name: string;
  description: string;
  url: string;
  category: string;
  healthUrl?: string;
  status: SystemStatus;
}

export const SYSTEMS: SystemEntry[] = [
  {
    id: 'daily-report',
    name: 'Daily Report',
    description: 'Shopify revenue, orders & profit dashboard',
    url: 'https://shopifydailyreport01.vercel.app/',
    category: 'Analytics',
    status: 'operational',
  },
  {
    id: 'conversion-agent',
    name: 'Conversion Agent',
    description: 'Conversion optimization & agent dashboard',
    url: 'https://conversion-agent.vercel.app/dashboard',
    category: 'Optimization',
    status: 'operational',
  },
  {
    id: 'imagegen',
    name: 'ImageGen',
    description: 'AI image generation tool',
    url: 'https://imagegen-pi-flame.vercel.app/',
    category: 'Creative',
    status: 'operational',
  },
  {
    id: 'membership-analytics',
    name: 'Membership Analytics',
    description: 'VIP subscription metrics — cohort retention, LTV, churn',
    url: 'https://shopifydailyreport01.vercel.app/dashboard/membership',
    category: 'Analytics',
    healthUrl: 'https://shopifydailyreport01.vercel.app/api/health/membership',
    status: 'operational',
  },
];
