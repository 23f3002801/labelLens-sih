import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import DashboardLayout from '../components/dashboard/DashboardLayout';

export default function NewScan() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = (selectedFile) => {
    setError('');
    if (selectedFile && selectedFile.size <= 10 * 1024 * 1024) {
      setFile(selectedFile);
      setPreview(URL.createObjectURL(selectedFile));
    } else {
      setError('File must be under 10MB');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setError('');

    try {
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 10, 90));
      }, 200);

      const result = await api.uploadImage(file);
      clearInterval(progressInterval);
      setProgress(100);

      setTimeout(() => {
        navigate(`/dashboard/inspections/${result.scan_id || result.scanId || result.id}`);
      }, 500);
    } catch (err) {
      setError(err.message || 'Upload failed');
      setUploading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
        
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-on-surface mb-2">New Compliance Scan</h1>
          <p className="text-on-surface-variant">Upload packaging artwork for instant Legal Metrology verification</p>
        </div>

        {/* Upload Area */}
        <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-sm border border-outline-variant/30">
          {!preview ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all ${
                dragActive ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-outline-variant/40 hover:border-primary/60 hover:bg-primary/5'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
              />
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary-container/20 flex items-center justify-center mx-auto mb-6">
                <span className="material-symbols-outlined text-primary text-[40px]">cloud_upload</span>
              </div>
              <h3 className="text-xl font-semibold text-on-surface mb-2">Drop your packaging image here</h3>
              <p className="text-on-surface-variant mb-6">or click to browse from your device</p>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-surface-container-low rounded-lg text-sm text-on-surface-variant">
                <span className="material-symbols-outlined text-[16px]">info</span>
                Supports JPG, PNG, PDF • Max 10MB
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="relative rounded-2xl overflow-hidden bg-surface-container-low">
                <img src={preview} alt="Preview" className="w-full h-96 object-contain" />
                <button
                  onClick={() => { setFile(null); setPreview(null); }}
                  className="absolute top-4 right-4 w-10 h-10 rounded-full bg-surface-container-lowest/90 backdrop-blur flex items-center justify-center text-on-surface hover:bg-error hover:text-white transition-all shadow-lg"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              <div className="flex items-center justify-between p-4 bg-surface-container-low rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-primary text-[24px]">image</span>
                  </div>
                  <div>
                    <p className="font-medium text-on-surface">{file.name}</p>
                    <p className="text-sm text-on-surface-variant">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                {uploading && (
                  <div className="flex items-center gap-3">
                    <div className="w-32 h-2 bg-surface-container rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-primary to-primary-container transition-all duration-300" style={{ width: `${progress}%` }}></div>
                    </div>
                    <span className="text-sm font-medium text-on-surface">{progress}%</span>
                  </div>
                )}
              </div>

              {error && (
                <div className="p-4 rounded-xl bg-error-container border border-error/30 flex items-start gap-2">
                  <span className="material-symbols-outlined text-error text-[20px]">error</span>
                  <p className="text-sm text-on-error-container">{error}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => { setFile(null); setPreview(null); }}
                  disabled={uploading}
                  className="flex-1 px-6 py-3 rounded-xl bg-surface-container-low text-on-surface font-medium hover:bg-surface-container transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="flex-1 px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-primary-container text-white font-semibold shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
                >
                  {uploading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
                      Start Compliance Scan
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { icon: 'speed', title: 'Fast Analysis', desc: 'Results in under 2 seconds' },
            { icon: 'verified', title: '100% Accurate', desc: '99.8% detection rate' },
            { icon: 'security', title: 'Secure', desc: 'End-to-end encrypted' }
          ].map((item, idx) => (
            <div key={idx} className="p-5 rounded-xl bg-surface-container-lowest border border-outline-variant/30">
              <span className="material-symbols-outlined text-primary text-[24px] mb-2 block">{item.icon}</span>
              <h4 className="font-semibold text-on-surface mb-1">{item.title}</h4>
              <p className="text-sm text-on-surface-variant">{item.desc}</p>
            </div>
          ))}
        </div>

      </div>
    </DashboardLayout>
  );
}
