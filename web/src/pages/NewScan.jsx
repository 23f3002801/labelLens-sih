import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import DashboardLayout from '../components/dashboard/DashboardLayout';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm'];
const MAX_FILES = 10;

export default function NewScan() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
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
    setUploading(true); setProgress(0); setError('');
    try {
      // This is triggered by the user's Upload click, which browsers require
      // before they will show the notification-permission prompt.
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      const images = files.filter((file) => IMAGE_TYPES.includes(file.type));
      const videos = files.filter((file) => VIDEO_TYPES.includes(file.type));
      const scans = [];
      if (images.length) {
        scans.push(await api.uploadImages(images, (fileProgress) => setProgress(Math.round(fileProgress * (videos.length ? 0.8 : 1)))));
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

  return <DashboardLayout><div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
    <div><h1 className="text-3xl font-bold text-on-surface mb-2">New Product Inspection</h1><p className="text-on-surface-variant">Add photos of every product face, or a 360° video. Results will appear in Inspections when ready.</p></div>
    <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-sm border border-outline-variant/30">
      <div onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={(event) => { event.preventDefault(); setDragActive(false); addFiles(event.dataTransfer.files); }} onClick={() => !uploading && inputRef.current?.click()} className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${dragActive ? 'border-primary bg-primary/5' : 'border-outline-variant/40 hover:border-primary/60 hover:bg-primary/5'} ${uploading ? 'opacity-60 cursor-wait' : ''}`}>
        <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm" className="hidden" onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
        <span className="material-symbols-outlined text-primary text-[40px]">add_photo_alternate</span><h3 className="text-xl font-semibold text-on-surface mt-3">Upload product faces or a product video</h3><p className="text-on-surface-variant mt-2">Drop files here or click to browse</p><p className="text-sm text-on-surface-variant mt-3">Up to 10 files · Images up to 10 MB · Videos up to 100 MB</p>
      </div>
      {files.length > 0 && <div className="mt-6 space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold text-on-surface">Selected files ({files.length}/{MAX_FILES})</h3>{uploading && <span className="text-sm font-medium text-primary">Uploading {progress}%</span>}</div>{files.map((file, index) => { const isVideo = VIDEO_TYPES.includes(file.type); return <div key={`${file.name}-${index}`} className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low"><div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center"><span className="material-symbols-outlined text-primary">{isVideo ? 'movie' : 'image'}</span></div><div className="min-w-0 flex-1"><p className="font-medium text-on-surface truncate">{file.name}</p><p className="text-xs text-on-surface-variant">{isVideo ? 'Product video' : 'Product face image'} · {(file.size / 1024 / 1024).toFixed(1)} MB</p></div><button type="button" disabled={uploading} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="p-2 text-on-surface-variant hover:text-error disabled:opacity-50"><span className="material-symbols-outlined">close</span></button></div>; })}{uploading && <div className="h-2 bg-surface-container rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-primary to-primary-container transition-all" style={{ width: `${progress}%` }} /></div>}</div>}
      {error && <div className="mt-5 p-4 rounded-xl bg-error-container border border-error/30 text-sm text-on-error-container">{error}</div>}
      <div className="flex gap-3 mt-6"><button type="button" disabled={uploading || !files.length} onClick={() => setFiles([])} className="flex-1 px-6 py-3 rounded-xl bg-surface-container-low text-on-surface font-medium disabled:opacity-50">Clear</button><button type="button" disabled={uploading || !files.length} onClick={handleUpload} className="flex-1 px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-primary-container text-white font-semibold disabled:opacity-50 flex justify-center items-center gap-2">{uploading ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Uploading…</> : <><span className="material-symbols-outlined">cloud_upload</span> Upload & inspect</>}</button></div>
    </div>
  </div></DashboardLayout>;
}
