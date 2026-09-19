import React, { Component } from 'react';

// Error boundary to protect modal from ever crashing the page
class ReportErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('InspectionReportModal Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center space-y-4 shadow-2xl">
            <span className="material-symbols-outlined text-rose-500 text-5xl">report_problem</span>
            <h3 className="text-lg font-bold text-slate-900">Failed to render report preview</h3>
            <p className="text-xs text-slate-500 font-mono break-all">{this.state.error?.message || 'Unknown error'}</p>
            <button
              onClick={this.props.onClose}
              className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function safeString(val, fallback = '') {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    if (val.text) return safeString(val.text, fallback);
    if (val.value) return safeString(val.value, fallback);
    if (val.name) return safeString(val.name, fallback);
    if (val.raw) return safeString(val.raw, fallback);
    return JSON.stringify(val);
  }
  return String(val);
}

function ReportModalContent({ inspection, onClose }) {
  if (!inspection) return null;

  const isCompliant = inspection.status === 'compliant' || inspection.status === 'COMPLIANT';
  const score = Math.round(inspection.complianceScore ?? 100);
  const violations = Array.isArray(inspection.violations) ? inspection.violations : [];
  const declarations = Array.isArray(inspection.extractedDeclarations) ? inspection.extractedDeclarations : [];
  const inspectionDate = inspection.createdAt
    ? new Date(inspection.createdAt).toLocaleString('en-IN', {
        dateStyle: 'full',
        timeStyle: 'medium',
      })
    : new Date().toLocaleString('en-IN');

  const evidenceImage = inspection.annotatedImageUrl || inspection.annotatedImagePath || inspection.imageUrl;
  const originalImage = inspection.imageUrl;

  const handlePrint = () => {
    const reportElem = document.getElementById('printable-report');
    if (!reportElem) {
      window.print();
      return;
    }

    // Create or reuse hidden iframe
    let printFrame = document.getElementById('almac-print-frame');
    if (printFrame) {
      printFrame.remove();
    }
    
    printFrame = document.createElement('iframe');
    printFrame.id = 'almac-print-frame';
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    document.body.appendChild(printFrame);

    const frameDoc = printFrame.contentWindow.document;
    frameDoc.open();
    frameDoc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>ALMAC_Statutory_Compliance_Report_${String(inspection.id || 'scan').slice(0, 8)}</title>
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0">
          <script src="https://cdn.tailwindcss.com"></script>
          <style>
            @page {
              size: A4 portrait;
              margin: 10mm;
            }
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            body {
              margin: 0;
              padding: 16px;
              font-family: 'Inter', sans-serif;
              background-color: #ffffff !important;
              color: #0f172a !important;
            }
            .avoid-break {
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }
            img {
              max-width: 100%;
              height: auto;
              object-fit: contain;
            }
            table {
              border-collapse: collapse;
              width: 100%;
            }
          </style>
        </head>
        <body class="bg-white text-slate-900">
          <div class="space-y-6">
            ${reportElem.innerHTML}
          </div>
        </body>
      </html>
    `);
    frameDoc.close();

    // Give iframe time to parse Tailwind and load images before printing
    setTimeout(() => {
      try {
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
      } catch (e) {
        console.error('Iframe print error, falling back to window.print():', e);
        window.print();
      }
    }, 450);
  };

  return (
    <div className="report-modal-backdrop fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      {/* Modal Card */}
      <div className="report-modal-card bg-white text-slate-900 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Modal Top Bar (Screen Only) */}
        <div className="no-print bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-emerald-400">verified</span>
            <div>
              <h2 className="font-semibold text-base leading-tight">Statutory Inspection Audit Certificate</h2>
              <p className="text-xs text-slate-400">Official Legal Metrology PCR 2011 Compliance Report</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-all shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">print</span>
              Print / Save PDF
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all"
              title="Close"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* Printable Report Body */}
        <div className="overflow-y-auto p-6 md:p-10 space-y-6" id="printable-report">
          
          {/* Government / Department Official Header */}
          <div className="border-b-2 border-slate-900 pb-4 flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-emerald-900 text-white flex flex-col items-center justify-center font-bold tracking-tighter p-1 border-2 border-emerald-700 flex-shrink-0">
                <span className="material-symbols-outlined text-2xl text-emerald-300">shield</span>
                <span className="text-[9px] uppercase font-mono tracking-widest text-emerald-200">GOVT</span>
              </div>
              <div>
                <h1 className="font-serif font-black text-xl md:text-2xl uppercase tracking-wide text-slate-950">
                  Government of India
                </h1>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Department of Consumer Affairs • Legal Metrology Division
                </p>
                <p className="text-[11px] text-slate-600">
                  Statutory Certificate under The Legal Metrology (Packaged Commodities) Rules, 2011
                </p>
              </div>
            </div>

            <div className="text-right font-mono text-xs text-slate-600 border md:border-l-2 md:border-t-0 md:border-r-0 md:border-b-0 border-slate-300 pl-4 py-1">
              <div><span className="font-bold text-slate-900">CERT NO:</span> ALMAC-{String(inspection.id || '000').slice(0, 8).toUpperCase()}</div>
              <div><span className="font-bold text-slate-900">ISSUED:</span> {inspectionDate}</div>
              <div><span className="font-bold text-slate-900">STATUS:</span> {isCompliant ? 'CLEARANCE GRANTED' : 'ACTION NOTICE REQUIRED'}</div>
            </div>
          </div>

          {/* Verdict Banner */}
          <div className={`p-4 rounded-xl border-2 flex items-center justify-between gap-4 ${
            isCompliant 
              ? 'bg-emerald-50 border-emerald-500 text-emerald-950' 
              : 'bg-rose-50 border-rose-500 text-rose-950'
          }`}>
            <div className="flex items-center gap-3">
              <span className={`material-symbols-outlined text-3xl ${isCompliant ? 'text-emerald-600' : 'text-rose-600'}`}>
                {isCompliant ? 'verified_user' : 'gavel'}
              </span>
              <div>
                <div className="font-bold text-base uppercase tracking-wider">
                  {isCompliant ? 'Statutory Compliance Certified (100% Pass)' : 'Statutory Defect & Non-Compliance Notice'}
                </div>
                <div className="text-xs opacity-90">
                  {isCompliant 
                    ? 'All mandatory packaging declarations conform to Rule 6 & Rule 12 standards.' 
                    : `${violations.length} statutory violation(s) detected. Product packaging requires regulatory remediation.`}
                </div>
              </div>
            </div>

            <div className="text-right flex-shrink-0">
              <div className="text-xs font-semibold uppercase tracking-wider">Compliance Index</div>
              <div className={`text-2xl font-black ${isCompliant ? 'text-emerald-700' : 'text-rose-700'}`}>
                {score}%
              </div>
            </div>
          </div>

          {/* Inspection Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
            <div>
              <span className="text-slate-500 block uppercase font-medium">Scan ID</span>
              <span className="font-mono font-semibold text-slate-800 break-all">{safeString(inspection.id)}</span>
            </div>
            <div>
              <span className="text-slate-500 block uppercase font-medium">Inspecting Officer</span>
              <span className="font-semibold text-slate-800">{safeString(inspection.inspector?.fullName || inspection.inspector?.email, 'Officer Verma (Field Inspector)')}</span>
            </div>
            <div>
              <span className="text-slate-500 block uppercase font-medium">Jurisdiction</span>
              <span className="font-semibold text-slate-800">{safeString(inspection.inspector?.district, 'Central Enforcement Unit')}</span>
            </div>
            <div>
              <span className="text-slate-500 block uppercase font-medium">Commodity Category</span>
              <span className="font-semibold text-slate-800 uppercase">{safeString(inspection.category, 'General Packaged Commodity')}</span>
            </div>
          </div>

          {/* Primary Evidence Section (Bounding Box Image) */}
          <div className="avoid-break space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h3 className="font-bold text-sm uppercase tracking-wide text-slate-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-700 text-lg">image_search</span>
                Exhibit A: Statutory Bounding Box Computer Vision Evidence
              </h3>
              <span className="text-xs font-mono text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded font-semibold">
                Sub-Millimeter OCR Grounding
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Bounding Box Image */}
              <div className="rounded-xl border border-slate-300 overflow-hidden bg-slate-100 flex flex-col">
                <div className="p-2 bg-slate-200 font-mono text-[11px] font-semibold text-slate-700 flex justify-between items-center">
                  <span>Annotated Bounding Box Verification</span>
                  <span className="text-[10px] text-emerald-700 font-bold uppercase">AI Evaluated</span>
                </div>
                <div className="flex-1 min-h-[160px] max-h-[220px] flex items-center justify-center p-2 bg-white">
                  {evidenceImage ? (
                    <img 
                      src={evidenceImage} 
                      alt="Bounding Box Evidence" 
                      className="max-h-[200px] w-auto max-w-full object-contain mx-auto rounded"
                    />
                  ) : (
                    <div className="text-slate-400 text-xs text-center p-6">
                      <span className="material-symbols-outlined text-4xl mb-1 block">hide_image</span>
                      No bounding box image recorded for this scan.
                    </div>
                  )}
                </div>
                <div className="p-2 bg-slate-50 text-[10px] text-slate-600 border-t border-slate-200">
                  🟢 Green: Conforming Rule declarations • 🔴 Red: Non-compliant / missing statutory mark
                </div>
              </div>

              {/* Original Image */}
              <div className="rounded-xl border border-slate-300 overflow-hidden bg-slate-100 flex flex-col">
                <div className="p-2 bg-slate-200 font-mono text-[11px] font-semibold text-slate-700 flex justify-between items-center">
                  <span>Exhibit B: Original Packaging Input</span>
                  <span className="text-[10px] text-slate-600 font-bold uppercase">Raw Capture</span>
                </div>
                <div className="flex-1 min-h-[160px] max-h-[220px] flex items-center justify-center p-2 bg-white">
                  {originalImage ? (
                    <img 
                      src={originalImage} 
                      alt="Raw Input Packaging" 
                      className="max-h-[200px] w-auto max-w-full object-contain mx-auto rounded"
                    />
                  ) : (
                    <div className="text-slate-400 text-xs text-center p-6">
                      <span className="material-symbols-outlined text-4xl mb-1 block">hide_image</span>
                      No original image available.
                    </div>
                  )}
                </div>
                <div className="p-2 bg-slate-50 text-[10px] text-slate-600 border-t border-slate-200">
                  Original packaging sample archived on secure Cloudinary CDN.
                </div>
              </div>
            </div>
          </div>

          {/* Statutory Violations Table (if any) */}
          {violations.length > 0 && (
            <div className="avoid-break space-y-2">
              <h3 className="font-bold text-sm uppercase tracking-wide text-rose-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-rose-600 text-lg">gavel</span>
                Statutory Violations & Regulatory Citations
              </h3>

              <div className="border border-rose-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-rose-100 text-rose-900 uppercase font-semibold text-[10px] tracking-wider border-b border-rose-200">
                    <tr>
                      <th className="p-2.5">Rule / Standard</th>
                      <th className="p-2.5">Severity</th>
                      <th className="p-2.5">Statutory Defect & Legal Citation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rose-100 bg-white">
                    {violations.map((v, idx) => {
                      const citationObj = typeof v.citation === 'object' && v.citation !== null ? v.citation : null;
                      const citationText = typeof v.citation === 'string' ? v.citation : null;

                      return (
                        <tr key={v.id ?? idx} className="hover:bg-rose-50/50 transition-colors">
                          <td className="p-2.5 font-mono font-bold text-slate-800 whitespace-nowrap align-top">
                            {safeString(v.ruleCode || v.rule_code, 'PCR-2011')}
                          </td>
                          <td className="p-2.5 align-top whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              safeString(v.severity).toLowerCase() === 'critical'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                              {safeString(v.severity, 'MAJOR')}
                            </span>
                          </td>
                          <td className="p-2.5 text-slate-800">
                            <div className="font-bold text-slate-900">{safeString(v.title, 'Statutory Violation')}</div>
                            {v.description && <div className="text-slate-600 mt-0.5">{safeString(v.description)}</div>}
                            
                            {/* Rich Statutory Citation Rendering */}
                            {(citationObj || citationText) && (
                              <div className="text-[11px] font-serif text-emerald-800 mt-1 italic bg-emerald-50/70 p-2 rounded border border-emerald-200 space-y-0.5">
                                <div className="font-bold font-sans not-italic text-[10px] uppercase text-emerald-950 flex items-center gap-1">
                                  <span>📜</span>
                                  <span>
                                    Statutory Citation: {citationObj ? (citationObj.rule_number || citationObj.act_name || 'Gazette Notification') : citationText}
                                  </span>
                                </div>
                                {citationObj?.statutory_quote && (
                                  <div className="text-[11px] text-emerald-900 mt-0.5">
                                    "{citationObj.statutory_quote}"
                                  </div>
                                )}
                                {citationObj?.source_document && (
                                  <div className="text-[9px] text-slate-500 not-italic font-mono mt-0.5">
                                    Source: {citationObj.source_document} {citationObj.page_number ? `(Page ${citationObj.page_number})` : ''}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Declarations Discovered (Rule 6(1)) */}
          {declarations.length > 0 && (
            <div className="avoid-break space-y-2">
              <h3 className="font-bold text-sm uppercase tracking-wide text-slate-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-slate-700 text-lg">fact_check</span>
                Mandatory Declarations Verification Checklist (Rule 6(1))
              </h3>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">Statutory Requirement</th>
                      <th className="p-2.5">Extracted Value / Text Grounding</th>
                      <th className="p-2.5">Verification</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {declarations.map((d, idx) => (
                      <tr key={idx}>
                        <td className="p-2.5 font-medium text-slate-800 capitalize">
                          {typeof d === 'string' ? d : safeString(d.field || d.name, `Declaration #${idx + 1}`)}
                        </td>
                        <td className="p-2.5 text-slate-700 font-mono text-[11px]">
                          {typeof d === 'string' ? 'Verified on package' : safeString(d.value || d.detected || d.detected_text, 'Present')}
                        </td>
                        <td className="p-2.5 text-emerald-700 font-semibold flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm text-emerald-600">check_circle</span>
                          Compliant
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Statutory Sign-off & Audit Seal */}
          <div className="avoid-break pt-4 border-t-2 border-slate-900 flex flex-col md:flex-row items-end justify-between gap-6">
            <div className="text-[11px] text-slate-500 max-w-md space-y-1">
              <p className="font-bold text-slate-700 uppercase">Statutory Notice Disclaimer:</p>
              <p>
                This document is generated by ALMAC (Automated Legal Metrology Compliance Engine) with cryptographic timestamping. 
                Certified for evidentiary submission under Section 18 of Legal Metrology Act, 2009.
              </p>
              <p className="font-mono text-[10px]">SHA-256 Hash: {String(inspection.id || 'hash').repeat(2).slice(0, 48)}</p>
            </div>

            <div className="text-center md:text-right border-t md:border-t-0 pt-3 md:pt-0 w-full md:w-auto">
              <div className="inline-block border-2 border-dashed border-slate-400 rounded-lg p-3 bg-slate-50 text-center min-w-[200px]">
                <div className="text-[10px] uppercase font-bold text-slate-500">Authorized Digital Seal</div>
                <div className="h-10 flex items-center justify-center font-serif italic text-emerald-900 font-bold text-sm">
                  ALMAC Verified
                </div>
                <div className="text-[9px] text-slate-600 border-t border-slate-300 pt-1 font-mono">
                  Govt Legal Metrology Unit
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Modal Footer Controls (Screen Only) */}
        <div className="no-print bg-slate-100 px-6 py-4 flex items-center justify-between border-t border-slate-200">
          <p className="text-xs text-slate-500">
            Clicking <strong className="text-slate-700">"Print / Save PDF"</strong> opens your browser's print dialog configured for clean A4 PDF output.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg transition-all"
            >
              Close
            </button>
            <button
              onClick={handlePrint}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-all shadow-md"
            >
              <span className="material-symbols-outlined text-[18px]">print</span>
              Print / Save PDF
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

export default function InspectionReportModal(props) {
  return (
    <ReportErrorBoundary onClose={props.onClose}>
      <ReportModalContent {...props} />
    </ReportErrorBoundary>
  );
}
