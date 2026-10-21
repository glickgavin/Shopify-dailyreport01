import { redirect } from 'next/navigation';
import { getAdminSessionUser } from '@/lib/admin-session';
import CreditCorrectionClient from './CreditCorrectionClient';

export const metadata = { title: 'Credit Correction · Admin' };
export const dynamic = 'force-dynamic';

export default async function CreditCorrectionPage() {
  const user = await getAdminSessionUser();
  if (!user) redirect('/dashboard/admin/login');

  return <CreditCorrectionClient />;
}
