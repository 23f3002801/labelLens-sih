import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import DashboardLayout from '../components/dashboard/DashboardLayout';

export default function InspectionDetail() {
  const { id } = useParams();
  // Seed from cache synchronously (fresh or stale) so revisiting a detail
  // page never flashes a skeleton, then revalidate in the background.
  const [inspection, setInspection] = useState(() => api.peekInspection(id)?.data ?? null);
  const [loading, setLoading] = useState(() => !api.peekInspection(id));
  const [error, setError] = useState('');

  useEffect(() => {
    const unsubscribe = api.subscribeInspection(id, (d) => setInspection(d ?? null));
    loadInspection();
    return unsubscribe;
  }, [id]);

  const loadInspection = async () => {
    try {
      const data = await api.getInspection(id);
      setInspection(data);
      setError('');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load inspection');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div className="h-8 w-64 bg-surface-container-low rounded animate-pulse"></div>
          <div className="h-96 bg-surface-container-low rounded-2xl animate-pulse"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Link to="/dashboard/inspections" className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary mb-2 transition-colors">
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back to Inspections
            </Link>
            <h1 className="text-3xl font-bold text-on-surface">Inspection Details</h1>
            <p className="text-on-surface-variant">Scan ID: {id}</p>
          </div>
          {inspection && (
            <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${
              inspection.status === 'compliant' ? 'bg-success-container text-on-success-container' : inspection.status === 'pending' ? 'bg-secondary-container text-on-secondary-container' : 'bg-error-container text-on-error-container'
            }`}>
              <span className="material-symbols-outlined text-[18px]">{inspection.status === 'compliant' ? 'check_circle' : inspection.status === 'pending' ? 'hourglass_top' : 'error'}</span>
              {inspection.status === 'compliant' ? 'Compliant' : inspection.status === 'pending' ? 'Waiting for result' : inspection.status === 'failed' ? 'Processing failed' : 'Non-Compliant'}
            </span>
          )}
        </div>

        {/* Content */}
        {!inspection ? (
          <div className="bg-surface-container-lowest rounded-2xl p-16 text-center border border-outline-variant/30">
            <span className="material-symbols-outlined text-6xl text-on-surface-variant/30 mb-4 block">search_off</span>
            <h3 className="text-xl font-semibold text-on-surface mb-2">{error || 'Inspection not found'}</h3>
            <Link to="/dashboard/inspections" className="text-primary font-medium hover:underline">Back to inspections</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Image */}
            <div className="lg:col-span-2 bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-outline-variant/30">
              <h3 className="font-semibold text-on-surface mb-4">Scanned Image</h3>
              {inspection.imageUrl ? (
                <img src={inspection.imageUrl} alt="Scan" className="w-full rounded-xl" />
              ) : (
                <div className="aspect-video bg-surface-container-low rounded-xl flex items-center justify-center">
                  <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">image</span>
                </div>
              )}
            </div>

            {/* Details */}
            <div className="space-y-6">
              <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-outline-variant/30">
                <h3 className="font-semibold text-on-surface mb-4">Scan Information</h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-1">Date</p>
                    <p className="font-medium text-on-surface">
                      {inspection.createdAt ? new Date(inspection.createdAt).toLocaleString('en-IN') : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-1">Status</p>
                    <p className="font-medium text-on-surface capitalize">{inspection.status.replace(/_/g, ' ')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-1">Compliance Score</p>
                    <p className="font-medium text-on-surface">{Math.round(inspection.complianceScore ?? 0)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-1">Violations</p>
                    <p className="font-medium text-on-surface">{inspection.violations?.length ?? 0}</p>
                  </div>
                </div>
              </div>

              {inspection.status === 'failed' && (
                <div className="bg-error-container rounded-2xl p-5 border border-error/30">
                  <h3 className="font-semibold text-on-error-container mb-1">Processing could not be completed</h3>
                  <p className="text-sm text-on-error-container/80">{inspection.ocrResult?.error || 'Please verify that the Python OCR service is running, then upload the file again.'}</p>
                </div>
              )}

              {/* Violations List */}
              {inspection.violations?.length > 0 && (
                <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-error/30">
                  <h3 className="font-semibold text-on-surface mb-4 flex items-center gap-2">
                    <span className="material-symbols-outlined text-error text-[20px]">warning</span>
                    Violations Found
                  </h3>
                  <div className="space-y-2">
                    {inspection.violations.map((v, idx) => (
                      <div key={v.id ?? idx} className="p-3 rounded-lg bg-error-container/50 border border-error/20">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-on-error-container">{v.title}</p>
                          {v.severity && (
                            <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-error/10 text-error text-[10px] font-bold uppercase tracking-wide">
                              {v.severity.replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                        {v.description && (
                          <p className="text-xs text-on-error-container/80 mt-1">{v.description}</p>
                        )}
                        {v.ruleCode && (
                          <p className="text-[10px] text-on-error-container/60 mt-1 font-mono">{v.ruleCode}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2">
                <button className="w-full px-4 py-3 rounded-xl bg-primary text-white font-medium hover:bg-primary-container transition-all flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">download</span>
                  Download Report
                </button>
                <Link to="/dashboard/scan" className="block w-full px-4 py-3 rounded-xl bg-surface-container-low text-on-surface font-medium hover:bg-surface-container transition-all text-center">
                  New Scan
                </Link>
              </div>
            </div>

          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
