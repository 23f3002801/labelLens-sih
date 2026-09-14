import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import DashboardLayout from '../components/dashboard/DashboardLayout';

export default function Inspections() {
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadInspections();
  }, []);

  const loadInspections = async () => {
    try {
      const data = await api.getInspections(1, 100);
      setInspections(data.items || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const filtered = filter === 'all' ? inspections : inspections.filter(i => i.status === filter);

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-on-surface mb-2">Inspections</h1>
            <p className="text-on-surface-variant">All your compliance scans and results</p>
          </div>
          <Link to="/dashboard/scan" className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary to-primary-container text-white rounded-xl font-semibold shadow-lg hover:shadow-xl hover:scale-105 transition-all">
            <span className="material-symbols-outlined text-[20px]">add</span>
            New Scan
          </Link>
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          {['all', 'compliant', 'non_compliant', 'pending'].map(status => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                filter === status
                  ? 'bg-primary text-white shadow-md'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              {status === 'all' ? 'All' : status === 'non_compliant' ? 'Non-Compliant' : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-surface-container-low rounded-xl animate-pulse"></div>)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-2xl p-16 text-center border border-outline-variant/30">
            <span className="material-symbols-outlined text-6xl text-on-surface-variant/30 mb-4 block">fact_check</span>
            <h3 className="text-xl font-semibold text-on-surface mb-2">No inspections found</h3>
            <p className="text-on-surface-variant mb-6">
              {filter === 'all' ? 'Start your first compliance scan' : `No ${filter} inspections yet`}
            </p>
            <Link to="/dashboard/scan" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-container transition-all">
              <span className="material-symbols-outlined text-[20px]">add</span>
              New Scan
            </Link>
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/30 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-surface-container-low">
                  <tr>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Product</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Date</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Status</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Violations</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {filtered.map((inspection) => (
                    <tr key={inspection.id} className="hover:bg-surface-container-low/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <span className="material-symbols-outlined text-primary text-[20px]">package</span>
                          </div>
                          <span className="font-medium text-on-surface">{inspection.productName || 'Unnamed Scan'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-on-surface-variant">
                        {new Date(inspection.scannedAt || inspection.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${
                          inspection.status === 'compliant' ? 'bg-success-container text-on-success-container' : 
                          inspection.status === 'pending' ? 'bg-secondary-container text-on-secondary-container' :
                          'bg-error-container text-on-error-container'
                        }`}>
                          <span className="material-symbols-outlined text-[14px]">
                            {inspection.status === 'compliant' ? 'check_circle' : inspection.status === 'pending' ? 'pending' : 'error'}
                          </span>
                          {inspection.status === 'compliant' ? 'Compliant' : inspection.status === 'pending' ? 'Pending' : 'Non-Compliant'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-on-surface">{inspection.violations || 0}</td>
                      <td className="px-6 py-4">
                        <Link to={`/dashboard/inspections/${inspection.id}`} className="text-primary font-medium text-sm hover:underline">View Details</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}