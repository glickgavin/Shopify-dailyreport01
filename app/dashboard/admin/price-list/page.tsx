import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getAdminSessionUser } from '@/lib/admin-session';
import PriceListClient from './PriceListClient';

export const metadata = { title: 'Price List · Admin' };
export const dynamic = 'force-dynamic';

export default async function PriceListPage() {
  const user = await getAdminSessionUser();
  if (!user) redirect('/dashboard/admin/login');

  return (
    <Suspense>
      <PriceListClient />
    </Suspense>
  );
}
