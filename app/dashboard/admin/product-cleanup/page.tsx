import { redirect } from 'next/navigation';
import { getAdminSessionUser } from '@/lib/admin-session';
import ProductCleanupClient from './ProductCleanupClient';

export const metadata = { title: 'Product Cleanup · Admin' };
export const dynamic = 'force-dynamic';

export default async function ProductCleanupPage() {
  const user = await getAdminSessionUser();
  if (!user) redirect('/dashboard/admin/login');

  return <ProductCleanupClient />;
}
