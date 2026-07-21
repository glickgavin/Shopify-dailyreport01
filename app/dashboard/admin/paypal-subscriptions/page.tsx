import { redirect } from 'next/navigation';
import { getAdminSessionUser } from '@/lib/admin-session';
import PaypalSubscriptionsClient from './PaypalSubscriptionsClient';

export const metadata = { title: 'PayPal Subscriptions · Admin' };
export const dynamic = 'force-dynamic';

export default async function PayPalSubscriptionsPage() {
  const user = await getAdminSessionUser();
  if (!user) redirect('/dashboard/admin/login');

  return <PaypalSubscriptionsClient />;
}
