import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import DashboardLayout from '../components/dashboard/DashboardLayout';

export default function InspectionDetail() {
  const { id } = useParams();
  const [inspection, setInspection] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadInspection();
  }, [id]);

  const loadInspection = async () => {
    try {
      const data = await api.getInspection(id);
      setInspection(data);
    } catch (error) {
      console.error(error);
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
              inspection.status === 'compliant' ? 'bg-success-container text-on-success-container' : 'bg-error-container text-on-error-container'
            }`}>
              <span className="material-symbols-outlined text-[18px]">{inspection.status === 'compliant' ? 'check_circle' : 'error'}</span>
              {inspection.status === 'compliant' ? '100% Compliant' : 'Violations Found'}
            </span>
          )}
        </div>

        {/* Content */}
        {!inspection ? (
          <div className="bg-surface-container-lowest rounded-2xl p-16 text-center border border-outline-variant/30">
            <span className="material-symbols-outlined text-6xl text-on-surface-variant/30 mb-4 block">search_off</span>
            <h3 className="text-xl font-semibold text-on-surface mb-2">Inspection not found</h3>
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
                      {new Date(inspection.scannedAt || inspection.createdAt).toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-1">Status</p>
                    <p className="font-medium text-on-surface capitalize">{inspection.status}</p>
                  </div>
                  <div>
                    <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-1">Violations</p>
                    <p className="font-medium text-on-surface">{inspection.violations || 0}</p>
                  </div>
                </div>
              </div>

              {/* Violations List */}
              {inspection.violations && inspection.violations.length > 0 && (
                <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-error/30">
                  <h3 className="font-semibold text-on-surface mb-4 flex items-center gap-2">
                    <span className="material-symbols-outlined text-error text-[20px]">warning</span>
                    Violations Found
                  </h3>
                  <div className="space-y-2">
                    {inspection.violations.map((v, idx) => (
                      <div key={idx} className="p-3 rounded-lg bg-error-container/50 border border-error/20">
                        <p className="text-sm font-medium text-on-error-container">{v.message || v}</p>
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