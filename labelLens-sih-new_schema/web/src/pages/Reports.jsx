import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import DashboardLayout from '../components/dashboard/DashboardLayout';
import InspectionReportModal from '../components/InspectionReportModal';

export default function Reports() {
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedInspection, setSelectedInspection] = useState(null);
  const [loadingReportId, setLoadingReportId] = useState(null);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getInspections(1, 100);
      setInspections(data?.items || []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load inspection reports');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenReport = async (inspectionSummary) => {
    setLoadingReportId(inspectionSummary.id);
    try {
      // Fetch complete inspection detail with violations & bounding box image
      const fullDetail = await api.getInspection(inspectionSummary.id);
      setSelectedInspection(fullDetail || inspectionSummary);
    } catch (err) {
      console.warn('Could not fetch full detail, using summary:', err);
      setSelectedInspection(inspectionSummary);
    } finally {
      setLoadingReportId(null);
    }
  };

  const exportCSV = () => {
    if (!inspections.length) return;
    const headers = ['Scan ID', 'Product Name', 'Category', 'Date', 'Status', 'Compliance Score (%)', 'Violations Count', 'Original Image', 'Annotated Image', 'Cloudinary Certificate'];
    const rows = inspections.map((i) => [
      i.id,
      i.productName || 'Packaged Commodity',
      i.category || 'General Pre-Packaged Commodity',
      i.createdAt ? new Date(i.createdAt).toISOString() : '',
      i.status,
      Math.round(i.complianceScore ?? 0),
      i.violationsCount ?? 0,
      i.imageUrl || '',
      i.annotatedImageUrl || i.annotatedImagePath || '',
      i.reportUrl || '',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `ALMAC_Compliance_Audit_Log_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered list
  const filteredInspections = inspections.filter((item) => {
    const matchesSearch =
      !searchQuery ||
      item.id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.productName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category?.toLowerCase().includes(searchQuery.toLowerCase());

    const isPass = item.status === 'compliant' || item.status === 'COMPLIANT';
    const isViolation = item.status === 'non_compliant' || item.status === 'NON_COMPLIANT' || item.status === 'failed' || item.status === 'FAILED';
    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'COMPLIANT' && isPass) ||
      (statusFilter === 'NON_COMPLIANT' && isViolation);

    return matchesSearch && matchesStatus;
  });

  // Analytics
  const totalCount = inspections.length;
  const compliantCount = inspections.filter((i) => i.status === 'compliant' || i.status === 'COMPLIANT').length;
  const violationCount = inspections.filter((i) => i.status === 'non_compliant' || i.status === 'NON_COMPLIANT' || i.status === 'failed' || i.status === 'FAILED').length;
  const avgScore = totalCount
    ? Math.round(inspections.reduce((acc, i) => acc + (i.complianceScore ?? 0), 0) / totalCount)
    : 100;

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-on-surface mb-1">Statutory Compliance Reports</h1>
            <p className="text-on-surface-variant text-sm">
              Generate, print, and export official Legal Metrology PCR 2011 audit certificates with bounding-box evidence.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={exportCSV}
              disabled={!inspections.length}
              className="px-4 py-2 rounded-xl border border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low text-on-surface text-sm font-semibold transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">table_view</span>
              Export Audit CSV
            </button>
            <Link
              to="/dashboard/scan"
              className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container text-white text-sm font-semibold transition-all flex items-center gap-2 shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">add_a_photo</span>
              New Scan
            </Link>
          </div>
        </div>

        {/* Analytics Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Total Inspections</span>
              <span className="material-symbols-outlined text-primary text-xl">assessment</span>
            </div>
            <div className="text-3xl font-bold text-on-surface mt-2">{totalCount}</div>
            <div className="text-xs text-on-surface-variant mt-1">Archived in database</div>
          </div>

          <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Passed Clearances</span>
              <span className="material-symbols-outlined text-emerald-600 text-xl">check_circle</span>
            </div>
            <div className="text-3xl font-bold text-emerald-700 mt-2">{compliantCount}</div>
            <div className="text-xs text-emerald-600/80 mt-1">100% PCR 2011 Compliant</div>
          </div>

          <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-700 uppercase tracking-wider">Violations Flagged</span>
              <span className="material-symbols-outlined text-rose-600 text-xl">warning</span>
            </div>
            <div className="text-3xl font-bold text-rose-700 mt-2">{violationCount}</div>
            <div className="text-xs text-rose-600/80 mt-1">Requiring notice action</div>
          </div>

          <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Average Compliance</span>
              <span className="material-symbols-outlined text-secondary text-xl">speed</span>
            </div>
            <div className="text-3xl font-bold text-on-surface mt-2">{avgScore}%</div>
            <div className="text-xs text-on-surface-variant mt-1">Across all categories</div>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
          
          {/* Search Input */}
          <div className="relative w-full sm:w-80">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Scan ID..."
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-surface-container-low border border-outline-variant/50 text-sm font-medium text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Status Filter Tabs */}
          <div className="flex items-center p-1 bg-surface-container-low rounded-xl border border-outline-variant/40 w-full sm:w-auto">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                statusFilter === 'ALL'
                  ? 'bg-surface-container-lowest text-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              All ({totalCount})
            </button>
            <button
              onClick={() => setStatusFilter('COMPLIANT')}
              className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                statusFilter === 'COMPLIANT'
                  ? 'bg-surface-container-lowest text-emerald-700 shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Compliant ({compliantCount})
            </button>
            <button
              onClick={() => setStatusFilter('NON_COMPLIANT')}
              className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                statusFilter === 'NON_COMPLIANT'
                  ? 'bg-surface-container-lowest text-rose-700 shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Violations ({violationCount})
            </button>
          </div>

        </div>

        {/* Reports Table */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/30 overflow-hidden">
          {loading ? (
            <div className="p-16 text-center space-y-4">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-sm text-on-surface-variant">Loading inspection reports...</p>
            </div>
          ) : error ? (
            <div className="p-12 text-center space-y-3">
              <span className="material-symbols-outlined text-5xl text-rose-500 block">error</span>
              <p className="text-sm font-semibold text-on-surface">{error}</p>
              <button
                onClick={loadReports}
                className="px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg"
              >
                Retry
              </button>
            </div>
          ) : !filteredInspections.length ? (
            <div className="p-16 text-center">
              <span className="material-symbols-outlined text-6xl text-on-surface-variant/30 mb-3 block">description</span>
              <h3 className="text-lg font-semibold text-on-surface mb-1">No reports found</h3>
              <p className="text-sm text-on-surface-variant mb-4">
                {searchQuery ? 'No inspections match your search criteria.' : 'No scans have been performed yet.'}
              </p>
              <Link
                to="/dashboard/scan"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold"
              >
                <span className="material-symbols-outlined text-[18px]">add_a_photo</span>
                Perform First Scan
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant/20 bg-surface-container-low/40 text-on-surface-variant font-label-md text-[11px] uppercase tracking-wider">
                    <th className="py-3.5 px-6">Evidence Sample</th>
                    <th className="py-3.5 px-6">Scan ID & Commodity</th>
                    <th className="py-3.5 px-6">Inspection Date</th>
                    <th className="py-3.5 px-6">Status & Verdict</th>
                    <th className="py-3.5 px-6">Compliance Index</th>
                    <th className="py-3.5 px-6 text-right">Audit Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/20 font-body-sm text-sm">
                  {filteredInspections.map((item) => {
                    const isPass = item.status === 'compliant' || item.status === 'COMPLIANT';
                    const thumbnail = item.annotatedImageUrl || item.annotatedImagePath || item.imageUrl;

                    return (
                      <tr key={item.id} className="hover:bg-surface-container-low/30 transition-colors">
                        {/* Evidence Thumbnail */}
                        <td className="py-3.5 px-6">
                          <div className="w-14 h-14 rounded-xl bg-surface-container-low overflow-hidden border border-outline-variant/40 flex items-center justify-center relative">
                            {thumbnail ? (
                              <img
                                src={thumbnail}
                                alt="Evidence Thumbnail"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="material-symbols-outlined text-on-surface-variant/40">image</span>
                            )}
                            {(item.annotatedImageUrl || item.annotatedImagePath) && (
                              <span className="absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-white" title="AI Bounding Boxes available"></span>
                            )}
                          </div>
                        </td>

                        {/* ID and Commodity */}
                        <td className="py-3.5 px-6">
                          <div className="font-mono text-xs font-bold text-on-surface">
                            {String(item.id).slice(0, 18)}...
                          </div>
                          <div className="text-xs font-semibold text-on-surface mt-0.5">
                            {item.productName || 'Packaged Commodity'}
                          </div>
                          <div className="text-[11px] text-on-surface-variant font-medium">
                            {item.category || 'General Pre-Packaged Commodity'}
                          </div>
                        </td>

                        {/* Date */}
                        <td className="py-3.5 px-6 text-on-surface-variant text-xs">
                          {item.createdAt ? new Date(item.createdAt).toLocaleString('en-IN') : '—'}
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-6">
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                              isPass
                                ? 'bg-success-container text-on-success-container'
                                : 'bg-error-container text-on-error-container'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {isPass ? 'check_circle' : 'warning'}
                            </span>
                            {isPass ? 'Compliant (Pass)' : `${item.violationsCount || 1} Violation(s)`}
                          </span>
                        </td>

                        {/* Compliance Score */}
                        <td className="py-3.5 px-6">
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-surface-container h-2 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${isPass ? 'bg-emerald-500' : 'bg-rose-500'}`}
                                style={{ width: `${Math.min(100, Math.max(0, item.complianceScore ?? 0))}%` }}
                              ></div>
                            </div>
                            <span className="font-mono font-bold text-xs text-on-surface">
                              {Math.round(item.complianceScore ?? 0)}%
                            </span>
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-6 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {item.reportUrl && (
                              <a
                                href={item.reportUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-semibold text-xs transition-all flex items-center gap-1.5 border border-emerald-500/20"
                                title="Open Cloudinary Stored Audit Certificate"
                              >
                                <span className="material-symbols-outlined text-[16px]">verified</span>
                                Cert
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => handleOpenReport(item)}
                              disabled={loadingReportId === item.id}
                              className="px-3.5 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary font-semibold text-xs transition-all flex items-center gap-1.5 border border-primary/20"
                            >
                              {loadingReportId === item.id ? (
                                <>
                                  <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                                  Loading...
                                </>
                              ) : (
                                <>
                                  <span className="material-symbols-outlined text-[16px]">print</span>
                                  Print / PDF Report
                                </>
                              )}
                            </button>
                            <Link
                              to={`/dashboard/inspections/${item.id}`}
                              className="p-1.5 rounded-lg hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-all"
                              title="View Full Inspection Details"
                            >
                              <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {/* Official Printable Report Modal */}
      {selectedInspection && (
        <InspectionReportModal
          inspection={selectedInspection}
          onClose={() => setSelectedInspection(null)}
        />
      )}
    </DashboardLayout>
  );
}