import DashboardLayout from '../components/dashboard/DashboardLayout';

export default function Reports() {
  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold text-on-surface mb-2">Reports</h1>
          <p className="text-on-surface-variant">Generate and download compliance reports</p>
        </div>

        <div className="bg-surface-container-lowest rounded-2xl p-16 text-center border border-outline-variant/30">
          <span className="material-symbols-outlined text-6xl text-on-surface-variant/30 mb-4 block">description</span>
          <h3 className="text-xl font-semibold text-on-surface mb-2">Reports coming soon</h3>
          <p className="text-on-surface-variant">Generate comprehensive compliance reports from your inspection history.</p>
        </div>
      </div>
    </DashboardLayout>
  );
}