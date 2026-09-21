import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import api from "../services/api";
import Navbar from "../components/layout/Navbar";

const CATEGORIES = [
  { id: "general", label: "General Commodities", icon: "inventory_2", desc: "Base Legal Metrology 2011 Rules (7 declarations)" },
  { id: "food", label: "Food & Beverages", icon: "restaurant", desc: "FSSAI Lic, Veg/Non-Veg, Nutrition, Ingredients" },
  { id: "cosmetics", label: "Cosmetics & Skincare", icon: "spa", desc: "Mfg Lic, Batch, How to Use, Precautionary" },
  { id: "textile", label: "Textiles & Apparel", icon: "apparel", desc: "Fibre Composition %, Dimensions, Wash Care" },
  { id: "electronics", label: "Electronics", icon: "devices", desc: "BIS Registration, Power/Voltage Ratings" },
];

export default function InspectorConsole() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);

  // Scan states
  const [selectedCategory, setSelectedCategory] = useState("general");
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanStep, setScanStep] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState("");

  // Inspection history states
  const [inspections, setInspections] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyFilter, setHistoryFilter] = useState("ALL");
  const [activeTab, setActiveTab] = useState("declarations"); // 'declarations' | 'violations' | 'ocr'
  const [imageViewMode, setImageViewMode] = useState("annotated"); // 'annotated' | 'original'

  const fileInputRef = useRef(null);

  // Authenticate user on mount (with guest officer fallback for demo/testing)
  useEffect(() => {
    const currentUser = api.getUser();
    if (currentUser) {
      setUser(currentUser);
    } else {
      setUser({
        name: "Officer Verma",
        fullName: "Officer Verma",
        email: "inspector.metrology@nic.in",
        role: "INSPECTOR",
        jurisdiction: "Zone 4, Legal Metrology Dept"
      });
    }
    setLoadingUser(false);
    loadInspectionHistory();
  }, [navigate]);

  const loadInspectionHistory = async (status = "ALL") => {
    setLoadingHistory(true);
    setHistoryError("");
    try {
      const data = await api.getInspections({ limit: 15, status });
      if (data && data.items) {
        setInspections(data.items);
      }
    } catch (err) {
      console.warn("Could not load past inspections history:", err);
      setHistoryError(err.message || "Failed to connect to backend");
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setScanResult(null);
      setScanError("");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setScanResult(null);
      setScanError("");
    }
  };

  const handleRunScan = async () => {
    if (!selectedFile) {
      setScanError("Please select or drop a product label image to evaluate.");
      return;
    }

    setScanning(true);
    setScanError("");
    setScanResult(null);
    setScanStep("Uploading label image to inspection pipeline...");

    try {
      const result = await api.uploadAndScan(selectedFile, selectedCategory, (stepText) => {
        if (stepText) setScanStep(stepText);
      });

      const annotatedImg =
        result.annotated_image_path ||
        result.annotated_image_base64 ||
        result.ocr_result?.annotated_image_base64 ||
        null;

      setScanResult({
        ...result,
        overall_result: (result.status === "COMPLIANT" || result.overall_result === "PASS") ? "PASS" : "FAIL",
        annotated_image_base64: annotatedImg,
      });

      if (annotatedImg) {
        setImageViewMode("annotated");
      } else if (result.image_path) {
        setImageViewMode("original");
      }

      // Refresh history
      loadInspectionHistory(historyFilter);
    } catch (err) {
      setScanError(err.message || "Compliance evaluation failed. Please try again.");
    } finally {
      setScanning(false);
      setScanStep("");
    }
  };

  const resolveImageSrc = (val) => {
    if (!val || val === "null") return null;
    if (val.startsWith("http") || val.startsWith("data:") || val.startsWith("blob:")) return val;
    return `data:image/jpeg;base64,${val}`;
  };

  const handleViewPastScan = async (scanId) => {
    try {
      const detail = await api.getScanById(scanId);
      const annotatedImg =
        detail.annotated_image_path ||
        detail.annotated_image_base64 ||
        detail.ocr_result?.annotated_image_base64 ||
        null;
      setScanResult({
        scan_id: detail.scan_id,
        status: detail.status,
        compliance_score: detail.compliance_score,
        overall_result: detail.status === "COMPLIANT" ? "PASS" : "FAIL",
        image_path: detail.image_path,
        annotated_image_path: detail.annotated_image_path || null,
        annotated_image_base64: annotatedImg,
        created_at: detail.created_at,
        extracted_declarations: detail.extracted_declarations || [],
        violations: detail.violations || [],
        ocr_result: detail.ocr_result || null,
        category: detail.category || "general",
      });
      if (annotatedImg) {
        setImageViewMode("annotated");
      } else if (detail.image_path) {
        setImageViewMode("original");
      }
      if (detail.image_path) {
        setPreviewUrl(detail.image_path);
      } else if (annotatedImg) {
        setPreviewUrl(resolveImageSrc(annotatedImg));
      }
      window.scrollTo({ top: 400, behavior: "smooth" });
    } catch (err) {
      alert("Failed to load inspection details: " + err.message);
    }
  };

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-on-surface-variant font-medium">Verifying Inspector Credentials...</p>
        </div>
      </div>
    );
  }

  // Calculate quick stats
  const totalScans = inspections.length;
  const compliantScans = inspections.filter((i) => i.status === "COMPLIANT").length;
  const complianceRate = totalScans > 0 ? Math.round((compliantScans / totalScans) * 100) : 100;
  const totalViolations = inspections.reduce((acc, curr) => acc + (curr.violations_count || 0), 0);

  return (
    <div className="min-h-screen bg-surface font-body-md text-on-surface antialiased flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Officer Profile & Jurisdiction Header */}
        <section className="bg-gradient-to-r from-primary to-primary-container rounded-2xl p-6 sm:p-8 text-on-primary shadow-sm relative overflow-hidden">
          <div className="absolute right-0 top-0 bottom-0 opacity-10 pointer-events-none flex items-center pr-8">
            <span className="material-symbols-outlined text-9xl">verified</span>
          </div>

          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full bg-surface-container-lowest/20 backdrop-blur-sm text-xs font-semibold uppercase tracking-wider border border-white/20">
                  {user?.role || "FIELD_INSPECTOR"}
                </span>
                <span className="text-sm opacity-90 flex items-center gap-1">
                  <span className="material-symbols-outlined text-base">badge</span>
                  Badge: {user?.badgeNumber || "DOCA-LM-7741"}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold font-display-lg tracking-tight">
                Welcome, Officer {user?.fullName || user?.email?.split("@")[0] || "Inspector"}
              </h1>
              <p className="text-sm opacity-90 flex items-center gap-2">
                <span className="material-symbols-outlined text-base">location_on</span>
                Jurisdiction: <strong className="font-semibold">{user?.district || "National Inspection Pool"}</strong>, {user?.state || "India"}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  fileInputRef.current?.click();
                  window.scrollTo({ top: 450, behavior: "smooth" });
                }}
                className="px-5 py-2.5 rounded-xl bg-surface text-primary font-semibold text-sm hover:bg-surface-container-low transition-all shadow-sm flex items-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">add_a_photo</span>
                New Label Scan
              </button>
            </div>
          </div>
        </section>

        {/* Stats Grid */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant/30 shadow-xs">
            <div className="flex items-center justify-between text-on-surface-variant mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">Total Inspections</span>
              <span className="material-symbols-outlined text-primary text-xl">fact_check</span>
            </div>
            <div className="text-2xl font-bold text-on-surface">{totalScans}</div>
            <p className="text-xs text-on-surface-variant mt-1">Logged in NeonDB</p>
          </div>

          <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant/30 shadow-xs">
            <div className="flex items-center justify-between text-on-surface-variant mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">Compliance Rate</span>
              <span className="material-symbols-outlined text-emerald-600 text-xl">check_circle</span>
            </div>
            <div className="text-2xl font-bold text-emerald-600">{complianceRate}%</div>
            <p className="text-xs text-on-surface-variant mt-1">{compliantScans} compliant packs</p>
          </div>

          <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant/30 shadow-xs">
            <div className="flex items-center justify-between text-on-surface-variant mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">Flagged Violations</span>
              <span className="material-symbols-outlined text-error text-xl">warning</span>
            </div>
            <div className="text-2xl font-bold text-error">{totalViolations}</div>
            <p className="text-xs text-on-surface-variant mt-1">Under Sec 36(1) penalty</p>
          </div>

          <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant/30 shadow-xs">
            <div className="flex items-center justify-between text-on-surface-variant mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">Statutory Rules</span>
              <span className="material-symbols-outlined text-primary text-xl">gavel</span>
            </div>
            <div className="text-2xl font-bold text-on-surface">27 Active</div>
            <p className="text-xs text-on-surface-variant mt-1">PCR 2011 & FSSAI gazettes</p>
          </div>
        </section>

        {/* Scan & Evaluation Studio */}
        <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 p-6 sm:p-8 shadow-xs space-y-6">
          <div className="border-b border-outline-variant/20 pb-4">
            <h2 className="text-xl font-bold font-display-lg text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-2xl">document_scanner</span>
              Legal Metrology Compliance Scan Studio
            </h2>
            <p className="text-sm text-on-surface-variant mt-1">
              Upload any product packaging photo to evaluate mandatory declarations, OCR font size, and official Gazette citations.
            </p>
          </div>

          {/* Step 1: Category Selector */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              1. Select Regulated Commodity Category
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {CATEGORIES.map((cat) => {
                const active = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                      active
                        ? "border-primary bg-primary-fixed/15 ring-2 ring-primary/20"
                        : "border-outline-variant/30 hover:border-outline hover:bg-surface-container-low"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`material-symbols-outlined text-xl ${active ? "text-primary" : "text-on-surface-variant"}`}>
                        {cat.icon}
                      </span>
                      <span className={`font-semibold text-xs ${active ? "text-primary font-bold" : "text-on-surface"}`}>
                        {cat.label}
                      </span>
                    </div>
                    <span className="text-[11px] text-on-surface-variant line-clamp-2">{cat.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Image Uploader */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              2. Upload Label Photo / Packaging Image
            </label>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                previewUrl
                  ? "border-primary/40 bg-surface-container-low/40"
                  : "border-outline-variant/60 hover:border-primary hover:bg-surface-container-low/30"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />

              {previewUrl ? (
                <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
                  <div className="relative group">
                    <img
                      src={previewUrl}
                      alt="Uploaded label preview"
                      className="w-48 h-48 object-contain rounded-xl border border-outline-variant/40 bg-black/5 shadow-xs"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center text-white text-xs font-semibold">
                      Click to Change
                    </div>
                  </div>
                  <div className="text-left space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-emerald-600">check_circle</span>
                      <span className="font-semibold text-sm text-on-surface">{selectedFile?.name || "Product Label"}</span>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      Ready for automated RapidOCR + Legal Metrology 2011 compliance evaluation.
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                        setPreviewUrl(null);
                        setScanResult(null);
                      }}
                      className="text-xs text-error hover:underline flex items-center gap-1 cursor-pointer pt-2"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                      Remove Image
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined text-3xl">cloud_upload</span>
                  </div>
                  <div>
                    <span className="font-semibold text-sm text-primary hover:underline">Click to upload packaging photo</span>
                    <span className="text-sm text-on-surface-variant"> or drag and drop</span>
                  </div>
                  <p className="text-xs text-on-surface-variant">PNG, JPG, WEBP, or BMP (Clear front/back label view)</p>
                </div>
              )}
            </div>
          </div>

          {/* Scan Action & Loader */}
          {scanError && (
            <div className="p-4 rounded-xl bg-error-container text-on-error-container text-sm flex items-center gap-3">
              <span className="material-symbols-outlined">error</span>
              <span>{scanError}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
            <div className="text-xs text-on-surface-variant flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base text-primary">shield_check</span>
              Governed by Legal Metrology (Packaged Commodities) Rules, 2011 & Gazette citations.
            </div>

            <button
              onClick={handleRunScan}
              disabled={scanning || !selectedFile}
              className={`w-full sm:w-auto px-8 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2.5 transition-all shadow-sm ${
                scanning || !selectedFile
                  ? "bg-outline-variant/30 text-outline cursor-not-allowed"
                  : "bg-primary text-on-primary hover:bg-primary-container cursor-pointer"
              }`}
            >
              {scanning ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Evaluating Compliance...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-lg">policy</span>
                  <span>Run Legal Metrology Inspection</span>
                </>
              )}
            </button>
          </div>

          {/* Scanning Progress Bar */}
          {scanning && (
            <div className="p-4 rounded-xl bg-surface-container border border-outline-variant/30 space-y-2 animate-pulse">
              <div className="flex items-center justify-between text-xs font-semibold text-primary">
                <span>{scanStep}</span>
                <span>Active</span>
              </div>
              <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden">
                <div className="bg-primary h-full rounded-full w-2/3 animate-indeterminate"></div>
              </div>
            </div>
          )}
        </section>

        {/* Live Inspection Results Inspector */}
        {scanResult && (
          <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 p-6 sm:p-8 shadow-sm space-y-6">
            {/* Status Banner */}
            <div
              className={`p-6 rounded-2xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
                scanResult.overall_result === "PASS" || scanResult.status === "COMPLIANT"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-950"
                  : "bg-rose-50 border-rose-200 text-rose-950"
              }`}
            >
              <div className="flex items-center gap-4">
                <div
                  className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white ${
                    scanResult.overall_result === "PASS" || scanResult.status === "COMPLIANT"
                      ? "bg-emerald-600 shadow-emerald-200 shadow-md"
                      : "bg-rose-600 shadow-rose-200 shadow-md"
                  }`}
                >
                  <span className="material-symbols-outlined text-3xl">
                    {scanResult.overall_result === "PASS" || scanResult.status === "COMPLIANT" ? "verified" : "warning"}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold uppercase tracking-wide font-display-lg">
                      {scanResult.overall_result === "PASS" || scanResult.status === "COMPLIANT"
                        ? "COMPLIANT"
                        : "NON-COMPLIANT"}
                    </span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/80 font-semibold border">
                      Category: {scanResult.category?.toUpperCase() || selectedCategory.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs opacity-80 mt-1">
                    {scanResult.overall_result === "PASS" || scanResult.status === "COMPLIANT"
                      ? "All mandatory statutory declarations conform to Legal Metrology Act, 2009 & Packaged Commodities Rules, 2011."
                      : `${scanResult.violations?.length || 0} violations detected. Packaging is liable under Section 36(1).`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 bg-white/80 px-5 py-3 rounded-xl border border-black/5 shadow-xs">
                <div className="text-right">
                  <div className="text-xs uppercase font-semibold text-on-surface-variant">Compliance Score</div>
                  <div
                    className={`text-2xl font-extrabold ${
                      (scanResult.compliance_score || 0) >= 80 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {scanResult.compliance_score || 0}%
                  </div>
                </div>
              </div>
            </div>

            {/* Evidence Image and Findings View */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Evidence / Annotated Image */}
              <div className="lg:col-span-5 bg-surface-container-low p-4 rounded-xl border border-outline-variant/30 flex flex-col justify-between">
                <div>
                  {/* Mode Selector Header */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm">visibility</span>
                      Packaging Evidence
                    </h3>
                    <div className="flex bg-surface-container rounded-lg p-0.5 border border-outline-variant/30 text-xs">
                      <button
                        type="button"
                        onClick={() => setImageViewMode("annotated")}
                        className={`px-2.5 py-1 rounded-md font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                          imageViewMode === "annotated"
                            ? "bg-primary text-white shadow-xs"
                            : "text-on-surface-variant hover:text-on-surface"
                        }`}
                      >
                        <span className="material-symbols-outlined text-xs">crop_free</span>
                        Bounding Boxes
                      </button>
                      <button
                        type="button"
                        onClick={() => setImageViewMode("original")}
                        className={`px-2.5 py-1 rounded-md font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                          imageViewMode === "original"
                            ? "bg-primary text-white shadow-xs"
                            : "text-on-surface-variant hover:text-on-surface"
                        }`}
                      >
                        <span className="material-symbols-outlined text-xs">image</span>
                        Original Upload
                      </button>
                    </div>
                  </div>

                  {/* Image Display Container */}
                  <div className="w-full min-h-[300px] max-h-[420px] flex items-center justify-center bg-white rounded-lg border border-outline-variant/30 overflow-hidden relative group">
                    {(() => {
                      const annotatedSrc = resolveImageSrc(
                        scanResult.annotated_image_path ||
                        scanResult.annotated_image_base64 ||
                        scanResult.ocr_result?.annotated_image_base64
                      );
                      const originalSrc = resolveImageSrc(
                        (scanResult.image_path && scanResult.image_path !== "null")
                          ? scanResult.image_path
                          : previewUrl
                      );

                      const activeSrc =
                        imageViewMode === "annotated"
                          ? (annotatedSrc || originalSrc)
                          : (originalSrc || annotatedSrc);

                      if (!activeSrc) {
                        return (
                          <div className="py-16 text-center text-on-surface-variant text-xs space-y-1">
                            <span className="material-symbols-outlined text-3xl text-outline-variant">image_not_supported</span>
                            <p>No image preview available for this record</p>
                          </div>
                        );
                      }

                      return (
                        <img
                          src={activeSrc}
                          alt={
                            imageViewMode === "annotated"
                              ? "Annotated inspection evidence with bounding boxes"
                              : "Original uploaded packaging"
                          }
                          className="w-full max-h-[400px] object-contain rounded-lg transition-all"
                        />
                      );
                    })()}
                  </div>
                </div>

                {/* Footer status & open full-size */}
                <div className="w-full flex items-center justify-between text-[11px] text-on-surface-variant mt-3 pt-2 border-t border-outline-variant/20">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className={`w-2 h-2 rounded-full ${imageViewMode === "annotated" ? "bg-amber-500" : "bg-emerald-500"}`}></span>
                    {imageViewMode === "annotated"
                      ? "AI Bounding Boxes & Detected Regions"
                      : "Original Raw Packaging Photo"}
                  </span>

                  {(() => {
                    const annotatedSrc = resolveImageSrc(
                      scanResult.annotated_image_path ||
                      scanResult.annotated_image_base64 ||
                      scanResult.ocr_result?.annotated_image_base64
                    );
                    const originalSrc = resolveImageSrc(
                      (scanResult.image_path && scanResult.image_path !== "null")
                        ? scanResult.image_path
                        : previewUrl
                    );
                    const currentImg =
                      imageViewMode === "annotated"
                        ? (annotatedSrc || originalSrc)
                        : (originalSrc || annotatedSrc);
                    return currentImg ? (
                      <a
                        href={currentImg}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline font-semibold flex items-center gap-0.5 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-xs">open_in_new</span>
                        Open Full Size
                      </a>
                    ) : null;
                  })()}
                </div>
              </div>

              {/* Tabs & Details */}
              <div className="lg:col-span-7 space-y-4">
                {/* Tab Navigation */}
                <div className="flex border-b border-outline-variant/30">
                  <button
                    onClick={() => setActiveTab("declarations")}
                    className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeTab === "declarations"
                        ? "border-primary text-primary"
                        : "border-transparent text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    Found Declarations ({scanResult.extracted_declarations?.length || 0})
                  </button>

                  <button
                    onClick={() => setActiveTab("violations")}
                    className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeTab === "violations"
                        ? "border-error text-error"
                        : "border-transparent text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">warning</span>
                    Violations & Citations ({scanResult.violations?.length || 0})
                  </button>

                  <button
                    onClick={() => setActiveTab("ocr")}
                    className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeTab === "ocr"
                        ? "border-primary text-primary"
                        : "border-transparent text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">format_align_left</span>
                    Raw OCR Output
                  </button>
                </div>

                {/* Tab 1: Found Declarations */}
                {activeTab === "declarations" && (
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {scanResult.extracted_declarations && scanResult.extracted_declarations.length > 0 ? (
                      scanResult.extracted_declarations.map((decl, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 rounded-xl border border-outline-variant/30 bg-surface-container-low/40 flex items-start justify-between gap-3"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-xs text-on-surface">{decl.field_name}</span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                {decl.status || "COMPLIANT"}
                              </span>
                            </div>
                            <div className="text-xs text-on-surface font-mono bg-white/80 px-2 py-1 rounded border border-outline-variant/20 inline-block">
                              "{decl.extracted_text}"
                            </div>
                            {decl.citation && (
                              <p className="text-[11px] text-primary flex items-center gap-1">
                                <span className="material-symbols-outlined text-xs">gavel</span>
                                {decl.citation.rule_number} ({decl.citation.source_document})
                              </p>
                            )}
                          </div>

                          <div className="text-right text-[11px] text-on-surface-variant space-y-0.5 shrink-0">
                            <div>Confidence: <strong className="text-on-surface">{Math.round((decl.confidence || 0.9) * 100)}%</strong></div>
                            <div>Font: <strong className="text-on-surface">{decl.font_size_mm_est || "2.0"} mm</strong></div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-on-surface-variant text-center py-8">No declarations detected on label.</p>
                    )}
                  </div>
                )}

                {/* Tab 2: Violations & Statutory Citations */}
                {activeTab === "violations" && (
                  <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
                    {scanResult.violations && scanResult.violations.length > 0 ? (
                      scanResult.violations.map((viol, idx) => (
                        <div
                          key={idx}
                          className="p-4 rounded-xl border border-rose-200 bg-rose-50/40 space-y-3 shadow-2xs"
                        >
                          {/* Violation Title & Severity */}
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold text-xs text-rose-950 flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-rose-600 text-sm">error</span>
                              {viol.title || viol.rule_code}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-200 text-rose-900 uppercase">
                              {viol.severity || "CRITICAL"}
                            </span>
                          </div>

                          {/* Specific Package Component Violated */}
                          <div className="flex items-center gap-1.5 flex-wrap text-xs">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-rose-200 text-rose-900 font-semibold text-[11px] shadow-2xs">
                              <span className="material-symbols-outlined text-[14px] text-rose-600">inventory_2</span>
                              <span>Package Area: <strong>{viol.package_element || "Principal Display Panel (PDP)"}</strong></span>
                            </span>
                          </div>

                          {/* Rationale / Explanation */}
                          <p className="text-xs text-on-surface leading-relaxed">
                            {viol.description}
                          </p>

                          {/* Dual Comparison Box: What in the Package is Violated vs What is Mandated */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-0.5">
                            {/* What was detected / printed on the physical package */}
                            <div className="p-2.5 rounded-lg bg-white/90 border border-rose-200 shadow-2xs space-y-1">
                              <div className="text-[10px] font-bold uppercase tracking-wider text-rose-700 flex items-center gap-1">
                                <span className="material-symbols-outlined text-xs text-rose-600">search</span>
                                Detected on Packaging
                              </div>
                              <div className="font-mono text-[11px] text-rose-950 font-medium break-words bg-rose-50/80 p-2 rounded border border-rose-200/60">
                                {viol.detected_on_package ||
                                  (viol.violation_type === "missing"
                                    ? "Not printed anywhere on package (Missing from label)"
                                    : "Non-compliant text on packaging")}
                              </div>
                            </div>

                            {/* What the Legal Metrology regulation requires */}
                            <div className="p-2.5 rounded-lg bg-white/90 border border-emerald-200 shadow-2xs space-y-1">
                              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
                                <span className="material-symbols-outlined text-xs text-emerald-600">verified</span>
                                Mandated by Regulation
                              </div>
                              <div className="font-mono text-[11px] text-emerald-950 font-medium break-words bg-emerald-50/80 p-2 rounded border border-emerald-200/60">
                                {viol.expected_on_package ||
                                  "Must conform strictly to prescribed Legal Metrology 2011 format"}
                              </div>
                            </div>
                          </div>

                          {/* Official Statutory Citation Accordion Box */}
                          {viol.citation && (
                            <div className="p-3 rounded-lg bg-white border border-rose-200/80 space-y-1.5">
                              <div className="flex items-center justify-between text-[11px] font-bold text-primary">
                                <span className="flex items-center gap-1">
                                  <span className="material-symbols-outlined text-sm">menu_book</span>
                                  {viol.citation.act_name}
                                </span>
                                <span className="bg-primary/10 px-2 py-0.5 rounded text-[10px]">
                                  {viol.citation.rule_number}
                                </span>
                              </div>

                              <p className="text-[11px] text-on-surface-variant italic bg-surface-container-low p-2 rounded">
                                "{viol.citation.statutory_quote}"
                              </p>

                              <div className="flex items-center justify-between text-[10px] text-on-surface-variant pt-1">
                                <span>Source: {viol.citation.source_document}</span>
                                <span className="text-error font-semibold">Liable under Sec 36(1) penalty</span>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 space-y-2">
                        <span className="material-symbols-outlined text-4xl text-emerald-600">verified_user</span>
                        <p className="text-xs font-semibold text-emerald-800">Zero violations detected on this label!</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Tab 3: Raw OCR */}
                {activeTab === "ocr" && (
                  <div className="max-h-96 overflow-y-auto p-3 rounded-xl bg-surface-container-low border border-outline-variant/30 font-mono text-xs text-on-surface leading-relaxed whitespace-pre-wrap">
                    {scanResult.ocr_result?.raw_text ||
                      scanResult.extracted_declarations?.map((d) => d.extracted_text).join("\n") ||
                      "No raw OCR output available."}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Past Inspections History Table */}
        <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 p-6 sm:p-8 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-4">
            <div>
              <h2 className="text-lg font-bold font-display-lg text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">history</span>
                Inspection Logs & Audit Trail
              </h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Full cryptographic history stored in NeonDB PostgreSQL with Cloudinary asset backing.
              </p>
            </div>

            {/* Filter buttons */}
            <div className="flex items-center gap-1.5 bg-surface-container p-1 rounded-xl border border-outline-variant/20">
              {["ALL", "COMPLIANT", "NON_COMPLIANT"].map((filter) => (
                <button
                  key={filter}
                  onClick={() => {
                    setHistoryFilter(filter);
                    loadInspectionHistory(filter);
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    historyFilter === filter
                      ? "bg-surface text-primary shadow-xs"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {loadingHistory ? (
            <div className="py-12 text-center text-xs text-on-surface-variant">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
              Loading inspection logs...
            </div>
          ) : historyError ? (
            <div className="py-10 text-center space-y-3 px-4">
              <span className="material-symbols-outlined text-3xl text-amber-500">cloud_off</span>
              <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                Unable to load previous inspection history. The Node.js Fastify backend on <code className="bg-surface-container px-1 py-0.5 rounded text-primary">http://localhost:3000</code> may not be running.
              </p>
              <button
                onClick={() => loadInspectionHistory(historyFilter)}
                className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">refresh</span>
                Retry Connection
              </button>
            </div>
          ) : inspections.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <span className="material-symbols-outlined text-4xl text-outline-variant">folder_open</span>
              <p className="text-xs text-on-surface-variant">No inspections found matching filter '{historyFilter}'.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-on-surface">
                <thead className="bg-surface-container-low text-on-surface-variant uppercase text-[10px] font-bold tracking-wider">
                  <tr>
                    <th className="py-3 px-4 rounded-l-lg">Scan ID</th>
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Compliance Score</th>
                    <th className="py-3 px-4">Violations</th>
                    <th className="py-3 px-4 text-right rounded-r-lg">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/20">
                  {inspections.map((row) => (
                    <tr key={row.scan_id} className="hover:bg-surface-container-low/50 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-medium text-primary">
                        {row.scan_id?.slice(0, 8)}...
                      </td>
                      <td className="py-3.5 px-4 text-on-surface-variant">
                        {row.created_at ? new Date(row.created_at).toLocaleString() : "Recent"}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                            row.status === "COMPLIANT"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-semibold">
                        {row.compliance_score || 0}%
                      </td>
                      <td className="py-3.5 px-4 text-on-surface-variant">
                        {row.violations_count > 0 ? (
                          <span className="text-error font-semibold">{row.violations_count} violations</span>
                        ) : (
                          <span className="text-emerald-700">0 violations</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => handleViewPastScan(row.scan_id)}
                          className="px-3 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-primary font-semibold transition-all cursor-pointer"
                        >
                          View Report
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
