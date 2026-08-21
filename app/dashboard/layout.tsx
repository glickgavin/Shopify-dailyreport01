import AnalyticsSidebar from '@/components/analytics/AnalyticsSidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <style>{`
        @media (max-width: 1023px) { .app-shell { flex-direction: column; } }
      `}</style>
      <AnalyticsSidebar />
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>{children}</main>
    </div>
  );
}
