import { redirect } from 'next/navigation';

// Original URL for this report — it now lives in the admin section.
export default function PriceListRedirect() {
  redirect('/dashboard/admin/price-list');
}
