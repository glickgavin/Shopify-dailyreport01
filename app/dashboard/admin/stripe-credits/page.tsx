import { redirect } from 'next/navigation';
import { getAdminSessionUser } from '@/lib/admin-session';
import StripeCreditsClient from './StripeCreditsClient';

export const metadata = { title: 'Stripe Credits · Admin' };
export const dynamic = 'force-dynamic';

export default async function StripeCreditsPage() {
  const user = await getAdminSessionUser();
  if (!user) redirect('/dashboard/admin/login');

  return <StripeCreditsClient />;
}
