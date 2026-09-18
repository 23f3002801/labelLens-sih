import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import DashboardLayout from '../components/dashboard/DashboardLayout';

export default function Dashboard() {
  // Seed from cache synchronously (fresh or stale) so revisiting the page
  // never flashes a skeleton, then revalidate in the background.
  const [user, setUser] = useState(() => api.peekMe()?.data?.user || api.getUser());
  const [inspections, setInspections] = useState(() => api.peekInspections(1, 5)?.data?.items ?? []);
  const [loading, setLoading] = useState(() => !api.peekInspections(1, 5));

  useEffect(() => {
    const unsubscribeMe = api.subscribeMe((d) => {
      if (d?.user) setUser(d.user);
    });
    const unsubscribeInspections = api.subscribeInspections(1, 5, (d) => {
      setInspections(d?.items ?? []);
    });

    // Load profile and inspections independently — a failure in one should
    // not blank out the other.
    api
      .getMe()
      .then((userData) => {
        setUser(userData.user);
        api.setUser(userData.user);
      })
      .catch((error) => console.error('Failed to load profile:', error));

    api
      .getInspections(1, 5)
      .then((inspectionsData) => setInspections(inspectionsData.items || []))
      .catch((error) => console.error('Failed to load inspections:', error))
      .finally(() => setLoading(false));

    return () => {
      unsubscribeMe();
      unsubscribeInspections();
    };
  }, []);

  const stats = {
    totalScans: inspections.length,
    compliant: inspections.filter(i => i.status === 'compliant').length,
    violations: inspections.filter(i => i.status === 'non_compliant').length,
    pending: inspections.filter(i => i.status === 'pending').length
  };

  const complianceScore = stats.totalScans > 0 
    ? Math.round((stats.compliant / stats.totalScans) * 100) 
    : 0;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 h-64 bg-gradient-to-br from-primary/20 to-primary-container/20 rounded-3xl"></div>
            <div className="h-64 bg-surface-container-low rounded-3xl"></div>
          </div>
          <div className="grid grid-cols-4 gap-6">
            {[1,2,3,4].map(i => <div key={i} className="h-40 bg-surface-container-low rounded-3xl"></div>)}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-8 pb-8">
        
        {/* Hero Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Welcome Banner */}
          <div className="lg:col-span-2 bg-gradient-to-br from-[#005d42] via-[#007a56] to-[#009688] rounded-3xl p-8 text-white shadow-2xl relative overflow-hidden group">
            {/* Animated Background Elements */}
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white/5 rounded-full -mr-64 -mt-64 blur-3xl group-hover:scale-110 transition-transform duration-700"></div>
            <div className="absolute bottom-0 left-0 w-80 h-80 bg-white/5 rounded-full -ml-40 -mb-40 blur-2xl"></div>
            <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-white/3 rounded-full -translate-x-1/2 -translate-y-1/2 blur-2xl"></div>
            
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs font-semibold mb-6 shadow-lg">
                <span className="material-symbols-outlined text-[16px]">shield</span>
                GAZETTE-READY INSPECTION COCKPIT
              </div>
              
              <h1 className="text-4xl font-bold mb-4 tracking-tight">Welcome back, {user?.fullName?.split(' ')[0] || 'Inspector'}! 👋</h1>
              <p className="text-white/90 text-lg mb-8 max-w-xl leading-relaxed">
                Review packaging artwork, catch statutory declaration misses, and ship a clean audit trail from one focused workspace.
              </p>
              
              <div className="flex flex-wrap gap-4">
                <Link 
                  to="/dashboard/scan"
                  className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-primary rounded-2xl font-semibold shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-300"
                >
                  <span className="material-symbols-outlined text-[22px]">add_a_photo</span>
                  Start New Scan
                </Link>
                <Link 
                  to="/dashboard/inspections"
                  className="inline-flex items-center gap-2 px-7 py-3.5 bg-white/10 backdrop-blur-md border border-white/30 text-white rounded-2xl font-semibold hover:bg-white/20 transition-all duration-300"
                >
                  <span className="material-symbols-outlined text-[22px]">fact_check</span>
                  View Inspections
                </Link>
              </div>
            </div>
          </div>

          {/* Compliance Score Card */}
          <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-3xl p-7 shadow-lg border border-slate-200/50 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-40 h-40 bg-primary/5 rounded-full -mr-20 -mt-20 blur-2xl"></div>
            
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Compliance Score</h3>
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-primary-container flex items-center justify-center shadow-lg">
                  <span className="material-symbols-outlined text-white text-[22px]">verified</span>
                </div>
              </div>
              
              <div className="mb-6">
                <div className="text-6xl font-bold text-slate-900 mb-3 tracking-tight">{complianceScore}%</div>
                <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden shadow-inner">
                  <div 
                    className="h-full bg-gradient-to-r from-primary via-primary-container to-emerald-400 transition-all duration-1000 ease-out rounded-full shadow-lg"
                    style={{ width: `${complianceScore}%` }}
                  ></div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-4 rounded-2xl bg-emerald-50 border border-emerald-200/50 hover:shadow-md transition-all">
                  <div className="text-3xl font-bold text-emerald-700 mb-1">{stats.compliant}</div>
                  <div className="text-xs text-emerald-600 font-semibold uppercase tracking-wider">PASSED</div>
                </div>
                <div className="text-center p-4 rounded-2xl bg-red-50 border border-red-200/50 hover:shadow-md transition-all">
                  <div className="text-3xl font-bold text-red-700 mb-1">{stats.violations}</div>
                  <div className="text-xs text-red-600 font-semibold uppercase tracking-wider">ISSUES</div>
                </div>
                <div className="text-center p-4 rounded-2xl bg-indigo-50 border border-indigo-200/50 hover:shadow-md transition-all">
                  <div className="text-3xl font-bold text-indigo-700 mb-1">{stats.pending}</div>
                  <div className="text-xs text-indigo-600 font-semibold uppercase tracking-wider">PENDING</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/50 hover:shadow-xl hover:border-primary/30 transition-all duration-300 group">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/10 to-primary-container/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <span className="material-symbols-outlined text-primary text-[24px]">document_scanner</span>
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-slate-900 mb-1">Rule 6(1)</h4>
                <p className="text-sm text-slate-600">Declaration OCR armed</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/50 hover:shadow-xl hover:border-success/30 transition-all duration-300 group">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-success/10 to-emerald-100 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <span className="material-symbols-outlined text-success text-[24px]">straighten</span>
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-slate-900 mb-1">PDP Ratio</h4>
                <p className="text-sm text-slate-600">Numeral scale checks ready</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/50 hover:shadow-xl hover:border-secondary/30 transition-all duration-300 group">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-secondary/10 to-indigo-100 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <span className="material-symbols-outlined text-secondary text-[24px]">calculate</span>
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-slate-900 mb-1">USP/MRP</h4>
                <p className="text-sm text-slate-600">Pricing syntax monitored</p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard 
            icon="check_circle" 
            title="Total Scans" 
            value={stats.totalScans} 
            subtitle="Latest inspection batch"
            trend={stats.totalScans > 0 ? `${Math.round((stats.compliant/stats.totalScans)*100)}% success` : 'No data'}
            color="primary"
          />
          <StatCard 
            icon="verified" 
            title="Compliant" 
            value={stats.compliant} 
            subtitle="Passed statutory checks"
            trend="Zero violations"
            color="success"
          />
          <StatCard 
            icon="warning" 
            title="Violations" 
            value={stats.violations} 
            subtitle="Need remediation"
            trend={stats.violations === 0 ? 'All clear' : 'Action required'}
            color="error"
          />
          <StatCard 
            icon="pending_actions" 
            title="Pending" 
            value={stats.pending} 
            subtitle="Awaiting review"
            color="secondary"
            trend={stats.pending === 0 ? 'Up to date' : 'Review needed'}
          />
        </div>

        {/* Quick Scan + Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Upload CTA */}
          <Link to="/dashboard/scan" className="lg:col-span-2 group">
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200/50 hover:shadow-2xl hover:border-primary/30 transition-all duration-300 h-full">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 mb-2">Quick Scan</h2>
                  <p className="text-slate-600">Upload packaging for instant compliance check</p>
                </div>
                <span className="px-4 py-2 rounded-full bg-gradient-to-r from-primary/10 to-primary-container/10 text-primary text-xs font-bold border border-primary/20 shadow-sm">
                  AI-Powered
                </span>
              </div>
              
              <div className="border-2 border-dashed border-slate-300 rounded-2xl p-12 text-center group-hover:border-primary/50 group-hover:bg-gradient-to-br from-primary/5 to-primary-container/5 transition-all duration-300">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/20 to-primary-container/20 flex items-center justify-center mx-auto mb-5 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 shadow-lg">
                  <span className="material-symbols-outlined text-primary text-[40px]">cloud_upload</span>
                </div>
                <h3 className="font-bold text-slate-900 mb-2 text-lg">Drop packaging image here</h3>
                <p className="text-sm text-slate-600">or click to browse • JPG, PNG, WEBP up to 10MB</p>
              </div>
            </div>
          </Link>

          {/* Recent Activity */}
          <div className="bg-white rounded-3xl p-7 shadow-sm border border-slate-200/50">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-900">Recent Activity</h2>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse"></span>
                <span className="text-xs text-slate-600 font-medium">Live</span>
              </div>
            </div>
            
            {inspections.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                  <span className="material-symbols-outlined text-4xl text-slate-400">inbox</span>
                </div>
                <p className="text-sm text-slate-600 mb-4">No activity yet</p>
                <Link to="/dashboard/scan" className="inline-block text-primary text-sm font-bold hover:underline">
                  Start your first scan →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {inspections.slice(0, 4).map((inspection, idx) => (
                  <Link 
                    key={idx} 
                    to={`/dashboard/inspections/${inspection.id}`}
                    className="flex items-start gap-3 p-3 rounded-xl hover:bg-slate-50 transition-all group"
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      inspection.status === 'compliant' ? 'bg-emerald-100' : 'bg-red-100'
                    }`}>
                      <span className={`material-symbols-outlined text-[18px] ${
                        inspection.status === 'compliant' ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {inspection.status === 'compliant' ? 'check_circle' : 'warning'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 group-hover:text-primary transition-colors truncate">
                        {inspection.productName || 'Compliance Scan'}
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {inspection.createdAt
                          ? new Date(inspection.createdAt).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : '—'}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Inspections Table */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-200/50 overflow-hidden">
          <div className="p-7 border-b border-slate-200/50 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Recent Inspections</h2>
              <p className="text-sm text-slate-600 mt-1">Your latest compliance scans</p>
            </div>
            <Link to="/dashboard/inspections" className="inline-flex items-center gap-1 text-primary font-bold text-sm hover:gap-2 transition-all">
              View All
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Link>
          </div>
          
          {inspections.length === 0 ? (
            <div className="p-16 text-center">
              <div className="w-20 h-20 rounded-3xl bg-slate-100 flex items-center justify-center mx-auto mb-5">
                <span className="material-symbols-outlined text-5xl text-slate-400">fact_check</span>
              </div>
              <h3 className="font-bold text-slate-900 mb-2 text-lg">No inspections yet</h3>
              <p className="text-sm text-slate-600 mb-6">Start your first compliance scan to see results here</p>
              <Link to="/dashboard/scan" className="inline-flex items-center gap-2 px-7 py-3.5 bg-gradient-to-r from-primary to-primary-container text-white rounded-2xl font-bold shadow-xl hover:shadow-2xl hover:scale-105 transition-all">
                <span className="material-symbols-outlined text-[20px]">add</span>
                New Scan
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="text-left px-7 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider">Product</th>
                    <th className="text-left px-7 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider">Date</th>
                    <th className="text-left px-7 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider">Status</th>
                    <th className="text-left px-7 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider">Violations</th>
                    <th className="text-left px-7 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/50">
                  {inspections.map((inspection) => (
                    <tr key={inspection.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-7 py-5">
                        <div className="flex items-center gap-4">
                          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/10 to-primary-container/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                            <span className="material-symbols-outlined text-primary text-[22px]">package</span>
                          </div>
                          <span className="font-semibold text-slate-900">{inspection.productName || 'Unnamed Scan'}</span>
                        </div>
                      </td>
                      <td className="px-7 py-5 text-sm text-slate-600">
                        {inspection.createdAt
                          ? new Date(inspection.createdAt).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric'
                            })
                          : '—'}
                      </td>
                      <td className="px-7 py-5">
                        <span className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold ${
                          inspection.status === 'compliant' 
                            ? 'bg-emerald-100 text-emerald-700' 
                            : 'bg-red-100 text-red-700'
                        }`}>
                          <span className="material-symbols-outlined text-[14px]">
                            {inspection.status === 'compliant' ? 'check_circle' : 'error'}
                          </span>
                          {inspection.status === 'compliant' ? 'Compliant' : 'Non-Compliant'}
                        </span>
                      </td>
                      <td className="px-7 py-5 text-sm font-bold text-slate-900">
                        {inspection.violationsCount ?? 0}
                      </td>
                      <td className="px-7 py-5">
                        <Link to={`/dashboard/inspections/${inspection.id}`} className="text-primary font-bold text-sm hover:underline">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </DashboardLayout>
  );
}

// Stat Card Component
function StatCard({ icon, title, value, subtitle, trend, color }) {
  const colors = {
    primary: {
      bg: 'from-primary to-primary-container',
      light: 'bg-primary/10',
      text: 'text-primary'
    },
    success: {
      bg: 'from-success to-emerald-600',
      light: 'bg-emerald-100',
      text: 'text-emerald-700'
    },
    error: {
      bg: 'from-error to-red-600',
      light: 'bg-red-100',
      text: 'text-red-700'
    },
    secondary: {
      bg: 'from-secondary to-indigo-600',
      light: 'bg-indigo-100',
      text: 'text-indigo-700'
    }
  };

  const colorScheme = colors[color];

  return (
    <div className="bg-white rounded-3xl p-7 shadow-sm border border-slate-200/50 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">
      <div className="flex items-start justify-between mb-5">
        <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${colorScheme.bg} flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:rotate-3 transition-all duration-300`}>
          <span className="material-symbols-outlined text-white text-[26px]">{icon}</span>
        </div>
        <span className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-full">
          {trend}
        </span>
      </div>
      <div className="text-4xl font-bold text-slate-900 mb-2 tracking-tight">{value}</div>
      <div className="text-sm font-bold text-slate-900 mb-1">{title}</div>
      <div className="text-xs text-slate-600">{subtitle}</div>
    </div>
  );
}