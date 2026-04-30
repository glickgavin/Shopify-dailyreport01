import { redirect } from 'next/navigation';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';

export default function DashboardIndex() {
  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const yesterday = format(toZonedTime(subDays(new Date(), 1), tz), 'yyyy-MM-dd', { timeZone: tz });
  redirect(`/dashboard/${yesterday}`);
}
