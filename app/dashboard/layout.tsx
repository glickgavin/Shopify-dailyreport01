import AnalyticsSidebar from '@/components/analytics/AnalyticsSidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <AnalyticsSidebar />
      <main style={{ flex: 1, overflow: 'auto' }}>{children}</main>
    </div>
  );
}
