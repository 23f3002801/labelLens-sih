import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';

export default function Documentation() {
  const endpoints = [
    { method: 'POST', path: '/api/v1/auth/login', desc: 'Authenticate user and receive JWT token.' },
    { method: 'POST', path: '/api/v1/uploads/image', desc: 'Upload image for OCR and compliance evaluation.' },
    { method: 'POST', path: '/api/v1/video/frames', desc: 'Upload video for 360-degree cylindrical unwrapping and scan.' },
    { method: 'GET', path: '/api/v1/inspections', desc: 'Fetch paginated list of past compliance inspections.' },
    { method: 'GET', path: '/api/v1/uploads/:scanId', desc: 'Retrieve detailed results and violations for a specific scan.' },
  ];

  return (
    <div className="min-h-screen bg-surface font-body-md text-on-surface antialiased">
      <Navbar />
      <main className="pt-[6.75rem]">
        <section className="py-space-3xl bg-surface-container-lowest">
          <div className="max-w-[1440px] mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin-desktop">
            <div className="max-w-3xl mx-auto text-center mb-space-2xl">
              <span className="px-space-sm py-1 rounded bg-surface-container text-primary font-label-sm text-label-sm uppercase tracking-wider font-semibold">Developer Resources</span>
              <h1 className="font-display-lg text-display-lg text-on-surface mt-space-md">API Documentation</h1>
              <p className="font-body-lg text-body-lg text-on-surface-variant mt-space-sm">Integrate ALMAC's compliance engine directly into your ERP, DAM, or packaging workflow.</p>
            </div>

            <div className="max-w-4xl mx-auto bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/30 overflow-hidden">
              <div className="p-space-md bg-surface-container border-b border-outline-variant/30">
                <h3 className="font-label-lg text-label-lg text-on-surface font-semibold mb-2">Base URL</h3>
                <code className="block p-space-sm bg-surface-container-lowest rounded border border-outline-variant/30 text-primary font-body-md font-mono">
                  http://localhost:3000/api/v1
                </code>
              </div>
              
              <div className="divide-y divide-outline-variant/30">
                {endpoints.map((ep, idx) => (
                  <div key={idx} className="p-space-md flex flex-col md:flex-row md:items-center gap-space-md hover:bg-surface-container/50 transition-colors">
                    <span className={`px-3 py-1 rounded text-[11px] font-bold font-label-sm w-16 text-center ${ep.method === 'POST' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface border border-outline-variant/30'}`}>
                      {ep.method}
                    </span>
                    <code className="font-body-md text-on-surface font-semibold flex-1 font-mono text-sm md:text-base">{ep.path}</code>
                    <p className="font-body-sm text-body-sm text-on-surface-variant md:w-1/2 text-right md:text-right">{ep.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}