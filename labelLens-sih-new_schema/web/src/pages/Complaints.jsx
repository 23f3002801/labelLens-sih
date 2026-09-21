import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import DashboardLayout from '../components/dashboard/DashboardLayout';

const COMPLAINT_STATUSES = ['PENDING', 'TRIAGED', 'ESCALATED', 'RESOLVED', 'DISMISSED'];

const statusStyles = {
  PENDING: 'bg-secondary-container text-on-secondary-container',
  TRIAGED: 'bg-primary/10 text-primary',
  ESCALATED: 'bg-error-container text-on-error-container',
  RESOLVED: 'bg-success-container text-on-success-container',
  DISMISSED: 'bg-surface-container text-on-surface-variant',
};

function formatStatus(status) {
  return String(status || 'PENDING').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function Complaints() {
  const user = api.getUser();
  const role = user?.role?.toUpperCase();
  const isConsumer = role === 'CONSUMER';
  const canTriage = role === 'CONSUMER';
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    inspectionId: '',
    district: user?.district || '',
    state: user?.state || '',
  });

  const loadComplaints = useCallback(async () => {
    try {
      const data = await api.getComplaints(1, 100, statusFilter);
      setComplaints(data?.items || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load complaints');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadComplaints();
  }, [loadComplaints]);

  const summary = useMemo(() => ({
    total: complaints.length,
    pending: complaints.filter((complaint) => complaint.status === 'PENDING').length,
    escalated: complaints.filter((complaint) => complaint.status === 'ESCALATED').length,
    resolved: complaints.filter((complaint) => complaint.status === 'RESOLVED').length,
  }), [complaints]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const payload = Object.fromEntries(
        Object.entries(formData)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value !== '')
      );
      await api.fileComplaint(payload);
      setFormData({ title: '', description: '', inspectionId: '', district: user?.district || '', state: user?.state || '' });
      setFormOpen(false);
      await loadComplaints();
    } catch (err) {
      setError(err.message || 'Failed to file complaint');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTriage = async (complaintId, status) => {
    setUpdatingId(complaintId);
    setError('');
    try {
      const response = await api.triageComplaint(complaintId, { status });
      setComplaints((current) => current.map((complaint) => (
        complaint.id === complaintId ? response.complaint : complaint
      )));
    } catch (err) {
      setError(err.message || 'Failed to update complaint');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-on-surface mb-1">Complaints</h1>
            <p className="text-on-surface-variant text-sm">
              {isConsumer ? 'File and track your Legal Metrology complaints.' : 'Monitor complaints within your permitted jurisdiction.'}
            </p>
          </div>
          {isConsumer && (
            <button
              onClick={() => setFormOpen((open) => !open)}
              className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container text-white text-sm font-semibold transition-all flex items-center gap-2 shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              File Complaint
            </button>
          )}
        </div>

        {error && (
          <div className="flex items-start justify-between gap-3 p-4 rounded-xl bg-error-container border border-error/30 text-on-error-container">
            <p className="text-sm flex items-center gap-2"><span className="material-symbols-outlined text-[18px]">error</span>{error}</p>
            <button onClick={loadComplaints} className="text-sm font-semibold hover:underline">Retry</button>
          </div>
        )}

        {isConsumer && formOpen && (
          <form onSubmit={handleSubmit} className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-on-surface">New complaint</h2>
              <button type="button" onClick={() => setFormOpen(false)} className="text-on-surface-variant hover:text-on-surface transition-colors" aria-label="Close complaint form">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="title" className="text-sm font-semibold text-on-surface">Subject *</label>
              <input id="title" name="title" required maxLength="200" value={formData.title} onChange={(event) => setFormData({ ...formData, title: event.target.value })} placeholder="Issue with a packaged commodity" className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface text-sm placeholder:text-on-surface-variant/50 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="description" className="text-sm font-semibold text-on-surface">Description *</label>
              <textarea id="description" name="description" required maxLength="1000" rows="4" value={formData.description} onChange={(event) => setFormData({ ...formData, description: event.target.value })} placeholder="Describe the issue, product details, and where it was found." className="w-full px-3 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface text-sm placeholder:text-on-surface-variant/50 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all resize-y" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5"><label htmlFor="inspectionId" className="text-sm font-semibold text-on-surface">Inspection ID</label><input id="inspectionId" name="inspectionId" value={formData.inspectionId} onChange={(event) => setFormData({ ...formData, inspectionId: event.target.value })} placeholder="Optional" className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface text-sm placeholder:text-on-surface-variant/50 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all" /></div>
              <div className="space-y-1.5"><label htmlFor="district" className="text-sm font-semibold text-on-surface">District</label><input id="district" name="district" value={formData.district} onChange={(event) => setFormData({ ...formData, district: event.target.value })} placeholder="Optional" className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface text-sm placeholder:text-on-surface-variant/50 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all" /></div>
              <div className="space-y-1.5"><label htmlFor="state" className="text-sm font-semibold text-on-surface">State</label><input id="state" name="state" value={formData.state} onChange={(event) => setFormData({ ...formData, state: event.target.value })} placeholder="Optional" className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface text-sm placeholder:text-on-surface-variant/50 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all" /></div>
            </div>
            <div className="flex justify-end gap-3"><button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 rounded-xl bg-surface-container-low text-on-surface text-sm font-semibold hover:bg-surface-container transition-all">Cancel</button><button type="submit" disabled={submitting} className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container text-white text-sm font-semibold transition-all disabled:opacity-50">{submitting ? 'Submitting...' : 'Submit Complaint'}</button></div>
          </form>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[['Total', summary.total, 'gavel', 'text-primary'], ['Pending', summary.pending, 'hourglass_top', 'text-amber-600'], ['Escalated', summary.escalated, 'priority_high', 'text-error'], ['Resolved', summary.resolved, 'task_alt', 'text-emerald-600']].map(([label, value, icon, color]) => (
            <div key={label} className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">{label}</span><span className={`material-symbols-outlined text-xl ${color}`}>{icon}</span></div><div className="text-3xl font-bold text-on-surface mt-2">{value}</div></div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {['ALL', ...COMPLAINT_STATUSES].map((status) => <button key={status} onClick={() => setStatusFilter(status)} className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${statusFilter === status ? 'bg-primary text-white shadow-md' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'}`}>{status === 'ALL' ? 'All' : formatStatus(status)}</button>)}
        </div>

        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/30 overflow-hidden">
          {loading ? <div className="space-y-3 p-6">{[1, 2, 3].map((item) => <div key={item} className="h-20 bg-surface-container-low rounded-xl animate-pulse" />)}</div> : complaints.length === 0 ? <div className="p-16 text-center"><span className="material-symbols-outlined text-6xl text-on-surface-variant/30 mb-4 block">gavel</span><h2 className="text-xl font-semibold text-on-surface mb-2">No complaints found</h2><p className="text-on-surface-variant">{isConsumer ? 'File a complaint to begin tracking it here.' : 'There are no complaints in your current scope.'}</p></div> : <div className="overflow-x-auto"><table className="w-full"><thead className="bg-surface-container-low"><tr><th className="text-left px-6 py-4 text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Complaint</th><th className="text-left px-6 py-4 text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Consumer / Location</th><th className="text-left px-6 py-4 text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Filed</th><th className="text-left px-6 py-4 text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Status</th>{canTriage && <th className="text-right px-6 py-4 text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Triage</th>}</tr></thead><tbody className="divide-y divide-outline-variant/30">{complaints.map((complaint) => <tr key={complaint.id} className="hover:bg-surface-container-low/50 transition-colors"><td className="px-6 py-4"><p className="font-semibold text-on-surface">{complaint.title}</p><p className="text-sm text-on-surface-variant mt-1 max-w-md">{complaint.description}</p>{complaint.inspectionId && <p className="text-xs text-primary font-mono mt-1">Inspection: {complaint.inspectionId.slice(0, 12)}...</p>}</td><td className="px-6 py-4 text-sm text-on-surface-variant"><p>{complaint.consumer?.fullName || 'Consumer'}</p><p className="text-xs mt-1">{[complaint.district, complaint.state].filter(Boolean).join(', ') || 'Location not provided'}</p></td><td className="px-6 py-4 text-sm text-on-surface-variant">{complaint.createdAt ? new Date(complaint.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td><td className="px-6 py-4"><span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${statusStyles[complaint.status] || statusStyles.PENDING}`}>{formatStatus(complaint.status)}</span></td>{canTriage && <td className="px-6 py-4 text-right"><select aria-label={`Update status for ${complaint.title}`} value={complaint.status} disabled={updatingId === complaint.id} onChange={(event) => handleTriage(complaint.id, event.target.value)} className="h-9 px-2 rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface text-xs font-semibold focus:border-primary outline-none disabled:opacity-50">{COMPLAINT_STATUSES.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}</select></td>}</tr>)}</tbody></table></div>}
        </div>
      </div>
    </DashboardLayout>
  );
}
