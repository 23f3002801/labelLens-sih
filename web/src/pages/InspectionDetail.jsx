import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import DashboardLayout from '../components/dashboard/DashboardLayout';
import InspectionReportModal, { resolveDeclarationInfo } from '../components/InspectionReportModal';

export default function InspectionDetail() {
  const { id } = useParams();
  const [inspection, setInspection] = useState(() => api.peekInspection(id)?.data ?? null);
  const [loading, setLoading] = useState(() => !api.peekInspection(id));
  const [error, setError] = useState('');
  const [activeImageTab, setActiveImageTab] = useState('annotated');
  const [activeFaceIndex, setActiveFaceIndex] = useState(0);
  const [showReportModal, setShowReportModal] = useState(false);

  useEffect(() => {
    const unsubscribe = api.subscribeInspection(id, (d) => {
      if (d) {
        setInspection(d);
        if (d.annotatedImageUrl || d.annotatedImagePath) {
          setActiveImageTab('annotated');
        } else {
          setActiveImageTab('original');
        }
      }
    });
    loadInspection();
    return unsubscribe;
  }, [id]);

  const loadInspection = async () => {
    try {
      const data = await api.getInspection(id);
      setInspection(data);
      if (data?.annotatedImageUrl || data?.annotatedImagePath) {
        setActiveImageTab('annotated');
      } else {
        setActiveImageTab('original');
      }
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

  const isCompliant = inspection?.status === 'compliant' || inspection?.status === 'COMPLIANT';
  const declarations = Array.isArray(inspection?.extractedDeclarations)
    ? inspection.extractedDeclarations
    : Array.isArray(inspection?.extracted_declarations)
      ? inspection.extracted_declarations
      : [];

  const productName =
    inspection?.productName ||
    inspection?.product_name ||
    inspection?.product?.brandName ||
    inspection?.product?.commodityName ||
    (declarations.find(d => (d.field_name || d.field || d.name) === 'commodity_name' || (d.field_name || d.field || d.name) === 'product_name')?.extracted_text) ||
    'Packaged Consumer Commodity';

  const category =
    inspection?.category ||
    inspection?.product?.category ||
    'General Pre-Packaged Commodity';

  const faceImages = Array.isArray(inspection?.faceImages) ? inspection.faceImages : [];
  const activeFace = faceImages[activeFaceIndex] || null;
  const hasAnnotated = !!(activeFace?.annotated_image_path || inspection?.annotatedImageUrl || inspection?.annotatedImagePath);
  const faceDeclarations = activeFace?.extracted_declarations || declarations;
  const faceViolations = activeFace?.violations || inspection?.violations || [];
  const faceScore = activeFace?.compliance_score ?? inspection?.complianceScore ?? 0;
  const faceIsCompliant = activeFace ? activeFace.overall_result === 'PASS' : isCompliant;
  const displayedImage =
    activeImageTab === 'annotated'
      ? (activeFace?.annotated_image_path || inspection?.annotatedImageUrl || inspection?.annotatedImagePath || activeFace?.image_url || inspection?.imageUrl)
      : (activeFace?.image_url || inspection?.imageUrl);

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Link to="/dashboard/inspections" className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary mb-2 transition-colors">
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back to Inspections
            </Link>
            <h1 className="text-3xl font-bold text-on-surface">{productName}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap text-xs">
              <span className="px-2.5 py-0.5 rounded-full font-semibold bg-primary/10 text-primary uppercase">
                {category}
              </span>
              <span className="text-on-surface-variant">•</span>
              <span className="text-on-surface-variant font-mono">Scan ID: {id}</span>
            </div>
          </div>
          {inspection && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowReportModal(true)}
                className="px-4 py-2 bg-primary hover:bg-primary-container text-white text-sm font-semibold rounded-xl flex items-center gap-2 transition-all shadow-sm"
              >
                <span className="material-symbols-outlined text-[18px]">print</span>
                Download / Print PDF Report
              </button>
              <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${
                inspection.status === 'compliant' ? 'bg-success-container text-on-success-container' :
                inspection.status === 'pending' ? 'bg-secondary-container text-on-secondary-container' :
                'bg-error-container text-on-error-container'
              }`}>
                <span className="material-symbols-outlined text-[18px]">
                  {inspection.status === 'compliant' ? 'check_circle' : inspection.status === 'pending' ? 'hourglass_top' : 'error'}
                </span>
                {inspection.status === 'compliant' ? '100% Compliant' : inspection.status === 'pending' ? 'Waiting for result' : inspection.status === 'failed' ? 'Processing failed' : 'Violations Found'}
              </span>
            </div>
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

            {/* Image Viewer with Dual-Mode Tabs */}
            <div className="lg:col-span-2 bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-outline-variant/30 flex flex-col">
              {faceImages.length > 1 && (
                <div className="mb-5 pb-4 border-b border-outline-variant/30">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <h3 className="font-semibold text-on-surface">Product Faces</h3>
                      <p className="text-xs text-on-surface-variant">Face {activeFaceIndex + 1} of {faceImages.length} · Each face has its own compliance result</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${faceIsCompliant ? 'bg-success-container text-on-success-container' : 'bg-error-container text-on-error-container'}`}>
                      {Math.round(faceScore)}% {faceIsCompliant ? 'Compliant' : 'Needs attention'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label="Previous product face" disabled={activeFaceIndex === 0} onClick={() => setActiveFaceIndex((index) => Math.max(0, index - 1))} className="p-2 rounded-lg bg-surface-container-low text-on-surface-variant disabled:opacity-40">
                      <span className="material-symbols-outlined">chevron_left</span>
                    </button>
                    <div className="flex-1 flex gap-2 overflow-x-auto pb-1">
                      {faceImages.map((face, index) => {
                        const thumbnail = face.annotated_image_path || face.image_url;
                        return (
                          <button type="button" key={`${face.face_index ?? index}-${face.filename || index}`} onClick={() => setActiveFaceIndex(index)} className={`relative flex-shrink-0 w-20 h-16 rounded-lg overflow-hidden border-2 ${index === activeFaceIndex ? 'border-primary' : 'border-outline-variant/40'}`} aria-label={`Show product face ${index + 1}`}>
                            {thumbnail ? <img src={thumbnail} alt={`Face ${index + 1}`} className="w-full h-full object-cover" /> : <span className="material-symbols-outlined text-on-surface-variant">hide_image</span>}
                            <span className="absolute bottom-0 inset-x-0 bg-slate-900/75 text-white text-[10px] font-semibold py-0.5">Face {index + 1}</span>
                          </button>
                        );
                      })}
                    </div>
                    <button type="button" aria-label="Next product face" disabled={activeFaceIndex === faceImages.length - 1} onClick={() => setActiveFaceIndex((index) => Math.min(faceImages.length - 1, index + 1))} className="p-2 rounded-lg bg-surface-container-low text-on-surface-variant disabled:opacity-40">
                      <span className="material-symbols-outlined">chevron_right</span>
                    </button>
                  </div>
                </div>
              )}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-outline-variant/20">
                <div>
                  <h3 className="font-semibold text-on-surface flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-xl">image_search</span>
                    Packaging Evidence View
                  </h3>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    {activeImageTab === 'annotated'
                      ? 'AI Bounding Boxes highlighting detected declarations and violations'
                      : 'Raw packaging capture archived on Cloudinary'}
                  </p>
                </div>

                {/* Tab Switcher */}
                <div className="flex items-center p-1 bg-surface-container-low rounded-xl border border-outline-variant/40">
                  <button
                    type="button"
                    onClick={() => setActiveImageTab('annotated')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      activeImageTab === 'annotated'
                        ? 'bg-surface-container-lowest text-primary shadow-sm'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Bounding Boxes
                    {hasAnnotated && (
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.2 rounded font-mono">AI</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveImageTab('original')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      activeImageTab === 'original'
                        ? 'bg-surface-container-lowest text-primary shadow-sm'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                    Original Photo
                  </button>
                </div>
              </div>

              {/* Image Canvas */}
              <div className="flex-1 min-h-[380px] bg-surface-container-low/50 rounded-xl overflow-hidden flex items-center justify-center p-3 relative border border-outline-variant/20">
                {displayedImage ? (
                  <img
                    src={displayedImage}
                    alt={activeImageTab === 'annotated' ? 'Bounding Box Annotated Evidence' : 'Original Packaging'}
                    className="max-h-[540px] w-auto max-w-full object-contain mx-auto rounded-lg shadow-sm"
                  />
                ) : (
                  <div className="text-center p-8">
                    <span className="material-symbols-outlined text-5xl text-on-surface-variant/30 mb-2 block">hide_image</span>
                    <p className="text-sm font-medium text-on-surface-variant">
                      {activeImageTab === 'annotated'
                        ? 'Bounding box image was not generated for this scan.'
                        : 'Original packaging image unavailable.'}
                    </p>
                  </div>
                )}

                {/* Floating active badge */}
                {displayedImage && (
                  <div className="absolute bottom-5 left-5 bg-slate-900/80 backdrop-blur text-white text-[11px] px-3 py-1 rounded-full font-medium flex items-center gap-1.5 shadow-md">
                    <span className={`w-2 h-2 rounded-full ${activeImageTab === 'annotated' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-300'}`}></span>
                    {activeImageTab === 'annotated' ? 'Active: Statutory Bounding Boxes' : 'Active: Original Packaging'}
                  </div>
                )}
              </div>

              {/* Mandatory Statutory Declarations Card */}
              {declarations.length > 0 && (
                <div className="mt-6 pt-6 border-t border-outline-variant/30">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-semibold text-on-surface flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-xl">fact_check</span>
                      Mandatory Statutory Declarations (Legal Metrology PCR Rule 6)
                    </h4>
                    <span className="text-xs text-on-surface-variant font-mono bg-surface-container-low px-2 py-0.5 rounded">
                      {faceDeclarations.length} Marks Evaluated
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {faceDeclarations.map((d, idx) => {
                      const decl = resolveDeclarationInfo(d, idx);
                      return (
                        <div
                          key={idx}
                          className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/30 flex flex-col justify-between gap-2"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-on-surface">{decl.title}</span>
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-surface-container-highest text-on-surface-variant">
                                {decl.rule}
                              </span>
                            </div>
                            <p className="text-[11px] text-on-surface-variant mt-0.5 leading-snug">
                              {decl.description}
                            </p>
                          </div>
                          <div className="pt-2 border-t border-outline-variant/20 flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-semibold text-primary truncate max-w-[200px]" title={decl.extractedValue}>
                              {decl.extractedValue}
                            </span>
                            <span className="flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-full">
                              <span className="material-symbols-outlined text-xs">check_circle</span>
                              Verified
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>

            {/* Details & Actions Column */}
            <div className="space-y-6">
              
              {/* Scan Information Card */}
              <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-outline-variant/30">
                <h3 className="font-semibold text-on-surface mb-4 flex items-center justify-between">
                  <span>Inspection Summary</span>
                  <span className="text-xs font-mono font-normal text-on-surface-variant">
                    #{String(inspection.id).slice(0, 8)}
                  </span>
                </h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-1">Product Name</p>
                    <p className="font-bold text-on-surface text-base">
                      {productName}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-1">Product Category</p>
                    <span className="inline-block px-2.5 py-1 rounded-lg bg-surface-container-low border border-outline-variant/40 text-xs font-bold text-primary uppercase">
                      {category}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-1">Date & Time</p>
                    <p className="font-medium text-on-surface">
                      {inspection.createdAt ? new Date(inspection.createdAt).toLocaleString('en-IN') : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-1">Status</p>
                    <p className={`font-semibold capitalize ${isCompliant ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {inspection.status.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-1">Compliance Index</p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-surface-container h-2.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isCompliant ? 'bg-emerald-600' : 'bg-rose-600'}`}
                          style={{ width: `${Math.min(100, Math.max(0, inspection.complianceScore ?? 0))}%` }}
                        ></div>
                      </div>
                      <span className="font-bold text-sm text-on-surface">{Math.round(inspection.complianceScore ?? 0)}%</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-on-surface-variant uppercase tracking-wider mb-1">Statutory Violations</p>
                      <p className="font-medium text-on-surface">{faceViolations.length} defects flagged</p>
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
                    Violations Found ({inspection.violations.length})
                  </h3>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {faceViolations.map((v, idx) => (
                      <div key={v.id ?? idx} className="p-3 rounded-lg bg-error-container/40 border border-error/20">
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
                        {(v.citation?.rule_number || v.ruleCode) && (
                          <p className="text-[10px] text-on-error-container/70 mt-1 font-mono font-semibold">
                            📜 {v.citation?.rule_number || v.ruleCode.replace(/_/g, ' ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setShowReportModal(true)}
                  className="w-full px-4 py-3.5 rounded-xl bg-primary text-white font-semibold hover:bg-primary-container transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
                >
                  <span className="material-symbols-outlined text-[20px]">print</span>
                  Generate & Download PDF Report
                </button>
                <Link
                  to="/dashboard/scan"
                  className="block w-full px-4 py-3 rounded-xl bg-surface-container-low text-on-surface font-medium hover:bg-surface-container transition-all text-center border border-outline-variant/30"
                >
                  Start New Scan
                </Link>
              </div>

            </div>

          </div>
        )}

      </div>

      {/* Official Inspection Report Modal */}
      {showReportModal && inspection && (
        <InspectionReportModal
          inspection={inspection}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </DashboardLayout>
  );
}
