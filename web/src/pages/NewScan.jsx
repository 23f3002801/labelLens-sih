import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import DashboardLayout from '../components/dashboard/DashboardLayout';

const CATEGORIES = [
  { id: 'general', label: 'General Commodities', icon: 'inventory_2', desc: 'Base Legal Metrology 2011 Rules (7 declarations)' },
  { id: 'food', label: 'Food & Beverages', icon: 'restaurant', desc: 'FSSAI Lic, Veg/Non-Veg, Nutrition, Ingredients' },
  { id: 'cosmetics', label: 'Cosmetics & Skincare', icon: 'spa', desc: 'Mfg Lic, Batch, How to Use, Precautionary' },
  { id: 'textile', label: 'Textiles & Apparel', icon: 'apparel', desc: 'Fibre Composition %, Dimensions, Wash Care' },
  { id: 'electronics', label: 'Electronics', icon: 'devices', desc: 'BIS Registration, Power/Voltage Ratings' },
];

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm'];
const MAX_FILES = 10;

export default function NewScan() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [selectedCategory, setSelectedCategory] = useState('general');
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const addFiles = (incoming) => {
    setError('');
    const next = Array.from(incoming || []);
    if (!next.length) return;
    if (files.length + next.length > MAX_FILES) return setError(`You can upload up to ${MAX_FILES} files in one inspection.`);
    const invalid = next.find((file) => !IMAGE_TYPES.includes(file.type) && !VIDEO_TYPES.includes(file.type));
    if (invalid) return setError('Unsupported file. Use JPG, PNG, WEBP, GIF, BMP, MP4, MOV, AVI, MKV or WEBM.');
    const tooLarge = next.find((file) => file.size > (VIDEO_TYPES.includes(file.type) ? 100 : 10) * 1024 * 1024);
    if (tooLarge) return setError(`${tooLarge.name} exceeds the upload size limit.`);
    setFiles((current) => [...current, ...next]);
  };

  const handleUpload = async () => {
    if (!files.length) return;
    setUploading(true);
    setProgress(0);
    setError('');
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      const images = files.filter((file) => IMAGE_TYPES.includes(file.type));
      const videos = files.filter((file) => VIDEO_TYPES.includes(file.type));
      const scans = [];

      if (images.length === 1) {
        const result = await api.uploadImage(
          images[0],
          (fileProgress) => setProgress(Math.round(fileProgress * (videos.length ? 0.8 : 1))),
          selectedCategory
        );
        scans.push(result);
      } else if (images.length > 1) {
        const result = await api.uploadImages(
          images,
          (fileProgress) => setProgress(Math.round(fileProgress * (videos.length ? 0.8 : 1))),
          selectedCategory
        );
        scans.push(result);
      }

      for (let index = 0; index < videos.length; index += 1) {
        const result = await api.uploadVideo(videos[index], (fileProgress) => {
          const base = images.length ? 80 : 0;
          setProgress(Math.round(base + ((index + fileProgress / 100) / videos.length) * (100 - base)));
        });
        scans.push(result);
      }

      api.trackPendingScans(scans);
      navigate('/dashboard/inspections', { state: { queued: scans.length } });
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.');
      setUploading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold text-on-surface mb-2">New Product Inspection</h1>
          <p className="text-on-surface-variant">
            Select the regulated commodity category and upload package photos or a 360° video.
          </p>
        </div>

        {/* Category Selector */}
        <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-outline-variant/30 space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
            1. Regulated Commodity Category
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {CATEGORIES.map((cat) => {
              const active = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  disabled={uploading}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    active
                      ? 'border-primary bg-primary/10 ring-2 ring-primary/20 text-primary'
                      : 'border-outline-variant/30 hover:border-outline hover:bg-surface-container-low text-on-surface'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="material-symbols-outlined text-xl">{cat.icon}</span>
                    <span className="font-semibold text-xs">{cat.label}</span>
                  </div>
                  <span className="text-[11px] text-on-surface-variant line-clamp-2">{cat.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Uploader Card */}
        <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-sm border border-outline-variant/30">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              addFiles(event.dataTransfer.files);
            }}
            onClick={() => !uploading && inputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
              dragActive
                ? 'border-primary bg-primary/5'
                : 'border-outline-variant/40 hover:border-primary/60 hover:bg-primary/5'
            } ${uploading ? 'opacity-60 cursor-wait' : ''}`}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm"
              className="hidden"
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <span className="material-symbols-outlined text-primary text-[40px]">add_photo_alternate</span>
            <h3 className="text-xl font-semibold text-on-surface mt-3">Upload product faces or a product video</h3>
            <p className="text-on-surface-variant mt-2">Drop files here or click to browse</p>
            <p className="text-sm text-on-surface-variant mt-3">Up to 10 files · Images up to 10 MB · Videos up to 100 MB</p>
          </div>

          {files.length > 0 && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-on-surface">
                  Selected files ({files.length}/{MAX_FILES})
                </h3>
                {uploading && <span className="text-sm font-medium text-primary">Uploading {progress}%</span>}
              </div>
              {files.map((file, index) => {
                const isVideo = VIDEO_TYPES.includes(file.type);
                return (
                  <div key={`${file.name}-${index}`} className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low">
                    <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center">
                      <span className="material-symbols-outlined text-primary">{isVideo ? 'movie' : 'image'}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-on-surface truncate">{file.name}</p>
                      <p className="text-xs text-on-surface-variant">
                        {isVideo ? 'Product video' : 'Product face image'} · {(file.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      className="p-2 text-on-surface-variant hover:text-error disabled:opacity-50 cursor-pointer"
                    >
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </div>
                );
              })}
              {uploading && (
                <div className="h-2 bg-surface-container rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-primary-container transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-5 p-4 rounded-xl bg-error-container border border-error/30 text-sm text-on-error-container">
              {error}
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              disabled={uploading || !files.length}
              onClick={() => setFiles([])}
              className="flex-1 px-6 py-3 rounded-xl bg-surface-container-low text-on-surface font-medium disabled:opacity-50 cursor-pointer"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={uploading || !files.length}
              onClick={handleUpload}
              className="flex-1 px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-primary-container text-white font-semibold disabled:opacity-50 flex justify-center items-center gap-2 cursor-pointer shadow-sm"
            >
              {uploading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Uploading…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined">cloud_upload</span> Upload & inspect ({selectedCategory.toUpperCase()})
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
