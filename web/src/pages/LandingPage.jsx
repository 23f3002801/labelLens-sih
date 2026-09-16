import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface font-body-md text-on-surface antialiased">
      <Navbar />
      
      <main className="w-full bg-surface min-h-screen" style={{ paddingTop: '6.75rem' }}>
        <div className="flex flex-col w-full">
          
          {/* SECTION 1: HERO */}
          <section className="relative overflow-hidden bg-surface-container-lowest py-16 lg:py-24">
            <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-secondary-fixed/20 blur-3xl pointer-events-none"></div>
            <div className="absolute top-1/2 -right-32 w-[32rem] h-[32rem] rounded-full bg-surface-container/60 blur-3xl pointer-events-none"></div>
            
            <div className="max-w-[1440px] mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin-desktop relative">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter-desktop items-center">
                
                <div className="lg:col-span-7 space-y-space-md">
                  <div className="inline-flex items-center gap-space-xs px-space-sm py-1.5 rounded-lg bg-surface-container-low shadow-sm">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                    <span className="material-symbols-outlined text-primary text-[18px]">verified_user</span>
                    <span className="font-label-sm text-label-sm text-primary uppercase tracking-wider font-semibold">STATUTORY COMPLIANCE • PACKAGED COMMODITIES (LMPC) RULES, 2011 & GAZETTE NOTIFICATIONS</span>
                  </div>

                  <h1 className="font-display-lg text-display-lg text-on-surface tracking-tight leading-tight">
                    Automate <span className="text-primary underline decoration-secondary-container decoration-4 underline-offset-8">Legal Metrology Compliance.</span>
                  </h1>

                  <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl leading-relaxed">
                    Empower packaging, regulatory, and QC teams to instantly verify statutory declarations, mandatory ratios, principal display panels, net quantity standards, and statutory MRP syntax in seconds using automated computer vision.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-sm pt-space-2xs">
                    {[
                      { icon: 'check_circle', text: '99.8% Audit Accuracy' },
                      { icon: 'verified', text: 'Pre-print Pre-Press Parity' },
                      { icon: 'gavel', text: 'Zero Penalty Risk' }
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary text-[20px] bg-surface-container-low p-1 rounded-md">{item.icon}</span>
                        <span className="font-label-md text-label-md text-on-surface font-semibold">{item.text}</span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-space-2xs flex items-center gap-space-xs text-on-surface-variant font-label-sm text-label-sm">
                    <span>No hardware needed</span><span>•</span><span>Enterprise REST API</span><span>•</span><span>ISO/IEC 27001 Certified</span><span>•</span><span>Weights & Measures Validated</span>
                  </div>
                </div>

                <div className="lg:col-span-5 relative mt-8 lg:mt-0">
                  <div className="relative rounded-2xl bg-surface-container-lowest p-2 shadow-xl">
                    <img 
                      className="w-full h-auto rounded-xl object-cover aspect-[4/3]" 
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuBsSjXSjhz9EGKRO3rhKJDbvIp7DlMp96tNmkUVnVwp0pErdRpzlN0mASbhNpCkBPj5tstl7Ag6dW2Pe3fGIt7igKgVyrapOAQure2OYpm5lxzI2EvzorLRHpnVDrn_8U3hrb7UyBuT4Nko5o1GgCUxqD4MZH5LcnVpgxMMgPBJCoRGhSICoBquqFQPvgvmBw_wSMUCo0e9Ezdps3A3UYnqDQt_kGOvNsdrlZROmRDJZpJl96KlnnpJww" 
                      alt="Compliance Scanning Interface" 
                    />
                    
                    <div className="absolute -bottom-6 -left-6 sm:bottom-4 sm:-left-6 max-w-xs bg-surface-container-lowest p-space-md rounded-xl shadow-xl">
                      <div className="flex items-center justify-between gap-space-sm pb-space-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse"></span>
                          <span className="font-label-md text-label-md text-on-surface font-semibold">Batch #ALMAC-001</span>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-surface-container-low text-primary font-label-sm text-label-sm font-semibold">100% Compliant</span>
                      </div>
                      <div className="space-y-1 text-on-surface-variant font-body-sm text-body-sm">
                        <div className="flex justify-between items-center py-0.5"><span>Scan Speed</span><span className="font-semibold text-on-surface font-label-sm text-label-sm">0.42s (Realtime)</span></div>
                        <div className="flex justify-between items-center py-0.5"><span>Mandatory Declarations</span><span className="text-primary font-semibold font-label-sm text-label-sm">8 of 8 Verified</span></div>
                        <div className="flex justify-between items-center py-0.5"><span>Min Numeral Height</span><span className="text-primary font-semibold font-label-sm text-label-sm">3.2mm (Req: 2.0mm)</span></div>
                      </div>
                    </div>

                    <div className="absolute top-4 right-4 bg-surface-container-lowest/95 backdrop-blur px-3 py-1.5 rounded-lg shadow-md flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-[18px]">verified</span>
                      <span className="font-label-sm text-label-sm text-on-surface font-semibold">Legal Metrology Pass</span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </section>

          {/* SECTION 2: TARGET INDUSTRIES (Replaced Trust Strip) */}
<section className="w-full bg-surface-container-low py-space-xl shadow-sm border-b border-outline-variant/30">
  <div className="max-w-[1440px] mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin-desktop">
    <div className="text-center mb-space-lg">
      <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest font-semibold">
        BUILT FOR INDUSTRIES THAT NEED 100% COMPLIANCE
      </span>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-space-md items-center">
      {[
        { icon: 'storefront', name: 'FMCG & Consumer Goods' },
        { icon: 'local_pharmacy', name: 'Pharmaceutical' },
        { icon: 'shopping_bag', name: 'Retail & E-commerce' },
        { icon: 'factory', name: 'Manufacturing' },
        { icon: 'account_balance', name: 'Regulatory Bodies' }
      ].map((industry, idx) => (
        <div key={idx} className="p-space-md rounded-lg bg-surface-container-lowest shadow-sm border border-outline-variant/30 flex flex-col items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[32px]">{industry.icon}</span>
          <span className="font-label-md text-label-md text-on-surface text-center">{industry.name}</span>
        </div>
      ))}
    </div>
  </div>
</section>
          {/* SECTION 3: FEATURES */}
          <section id="features-section" className="py-space-3xl bg-surface scroll-mt-24">
            <div className="max-w-[1440px] mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin-desktop space-y-space-2xl">
              <div className="text-center max-w-3xl mx-auto space-y-space-xs">
                <span className="px-space-sm py-1 rounded bg-surface-container text-primary font-label-sm text-label-sm uppercase tracking-wider font-semibold">Comprehensive Precision Engine</span>
                <h2 className="font-headline-lg text-headline-lg text-on-surface">Everything Required for 100% Packaged Commodities Compliance</h2>
                <p className="font-body-md text-body-md text-on-surface-variant">Detect violations, incorrect numeral heights, and missing statutory coordinates before artwork is etched into expensive printing plates or flagged by market inspectors.</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-lg">
                {[
                  { icon: 'document_scanner', tag: 'Rule 6(1) Protocol', title: 'Mandatory Declaration OCR', desc: 'Identifies and confirms all 8 statutory packaging fields: generic product name, manufacturer/packer postal address, importer address, country of origin, consumer care coordinates, and commodity weight.', valid: 'Section 6 Mandate Validated' },
                  { icon: 'straighten', tag: 'Geometric PDP Ratios', title: 'Font Height & Area Ratio', desc: 'Instant sub-millimeter geometric verification checking that numeral heights on Net Quantity and MRP conform to mandatory statutory scales based on total Principal Display Panel area.', valid: 'Min. 1.0mm - 6.0mm Scale Check' },
                  { icon: 'calculate', tag: 'Statutory Pricing Formula', title: 'Unit Sale Price (USP) Engine', desc: 'Ensures required "₹ per g", "₹ per ml", or "₹ per item" calculation follows round-off standards up to two decimal places, preventing heavy statutory fines on consumer misdirection.', valid: '2022 Amendment Standard Compliant' },
                  { icon: 'barcode_scanner', tag: 'Pricing & Lot Control', title: 'MRP & Batch Code Inspection', desc: 'Precise syntax inspection verifying mandatory "MRP inclusive of all taxes" phraseology, legible manufacture dates, standardized expiration windows, and indelible lot serialization.', valid: 'Tax Inclusivity Text Assured' },
                  { icon: 'shield_with_heart', tag: 'Legal Dispute Defense', title: 'Automated LMPC Notice Defense', desc: 'Produces cryptographically stamped, time-stamped proof logs and detailed statutory declaration records ready to append directly to legal notices or controller inquiries.', valid: 'Audit Ready Export (PDF/CSV)' },
                  { icon: 'layers', tag: 'Pre-Press Integration', title: 'Multi-SKU Pipeline Connect', desc: 'Integrates directly with Adobe Illustrator, ArtiosCAD, and enterprise Digital Asset Management systems to batch-validate hundreds of SKUs during artwork finalization.', valid: 'Native Vector Parsing' }
                ].map((feature, idx) => (
                  <div key={idx} className="p-space-lg rounded-xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-all space-y-space-sm flex flex-col justify-between">
                    <div className="space-y-space-sm">
                      <div className="w-12 h-12 rounded-lg bg-surface-container-low flex items-center justify-center text-primary">
                        <span className="material-symbols-outlined text-[28px]">{feature.icon}</span>
                      </div>
                      <div className="space-y-1">
                        <span className="font-label-sm text-label-sm text-primary font-semibold tracking-wider uppercase">{feature.tag}</span>
                        <h3 className="font-headline-sm text-headline-sm text-on-surface">{feature.title}</h3>
                      </div>
                      <p className="font-body-md text-body-md text-on-surface-variant">{feature.desc}</p>
                    </div>
                    <div className="pt-space-xs">
                      <span className="inline-flex items-center gap-1 font-label-sm text-label-sm text-primary font-semibold">
                        <span>{feature.valid}</span>
                        <span className="material-symbols-outlined text-[14px]">check</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* SECTION 4: PROCESS */}
          <section className="py-space-3xl bg-surface-container-lowest">
            <div className="max-w-[1440px] mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin-desktop space-y-space-2xl">
              <div className="text-center max-w-3xl mx-auto space-y-space-xs">
                <span className="px-space-sm py-1 rounded bg-surface-container text-primary font-label-sm text-label-sm uppercase tracking-wider font-semibold">Streamlined Audit Protocol</span>
                <h2 className="font-headline-lg text-headline-lg text-on-surface">Three Simple Steps to Zero Regulatory Penalties</h2>
                <p className="font-body-md text-body-md text-on-surface-variant">Transform a manual 3-hour legal packaging review into an instantaneous, deterministic algorithmic check.</p>
              </div>

              <div className="relative">
                <div className="hidden lg:block absolute top-1/2 left-1/6 right-1/6 -translate-y-8 z-0">
                  <svg className="w-full h-2 text-outline-variant" fill="none"><line stroke="currentColor" strokeDasharray="6 6" strokeWidth="2" x1="0" x2="100%" y1="1" y2="1"></line></svg>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-xl relative z-10">
                  {[
                    { step: '01', icon: 'cloud_upload', title: 'Upload Artwork or Production Scan', desc: 'Directly upload native PDF, AI, TIFF files or capture packaging samples in real-time from plant camera stations and handheld scanners.', badge: 'Auto-converts print layers to PDP coords' },
                    { step: '02', icon: 'rule', title: 'Automated Metrology Rule Engine', desc: 'Our computer vision models map statutory regulations, check numeral aspect ratios, confirm USP tagging, and verify standard unit spellings.', badge: 'Matches 140+ Legal Metrology clauses' },
                    { step: '03', icon: 'task_alt', title: 'Generate Clearance Certificate', desc: 'Receive an immediate green-flagged statutory clearance pass or prioritized remediation report detailing exact millimeter height discrepancies.', badge: 'Instant digital audit certificate (PDF/JSON)' }
                  ].map((item, idx) => (
                    <div key={idx} className="p-space-lg rounded-xl bg-surface-container-low shadow-sm space-y-space-md flex flex-col items-center text-center">
                      <div className="relative">
                        <div className="w-16 h-16 rounded-full bg-surface-container-lowest flex items-center justify-center text-primary shadow-sm">
                          <span className="material-symbols-outlined text-[32px]">{item.icon}</span>
                        </div>
                        <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary text-on-primary font-label-sm text-label-sm font-bold flex items-center justify-center">{item.step}</span>
                      </div>
                      <div className="space-y-space-xs">
                        <h3 className="font-headline-sm text-headline-sm text-on-surface">{item.title}</h3>
                        <p className="font-body-md text-body-md text-on-surface-variant">{item.desc}</p>
                      </div>
                      <div className="pt-2">
                        <span className="px-space-xs py-1 rounded bg-surface-container-lowest font-label-sm text-label-sm text-on-surface-variant">{item.badge}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-center">
                <div className="inline-flex items-center gap-space-xs px-space-md py-space-xs rounded-full bg-surface-container-low shadow-sm">
                  <span className="material-symbols-outlined text-primary text-[18px]">bolt</span>
                  <span className="font-label-md text-label-md text-on-surface">Average verification turnaround: <strong className="text-primary font-bold">under 1.2 seconds</strong> per SKU</span>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 5: METRICS */}
          <section className="py-space-2xl bg-surface-container-low shadow-sm">
            <div className="max-w-[1440px] mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin-desktop">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-lg divide-y lg:divide-y-0 lg:divide-x divide-outline-variant/30">
                {[
                  { val: '12.4M+', label: 'Packaged Artworks Audited', sub: 'Across FMCG, pharma, cosmetics & imports' },
                  { val: '100%', label: 'Notice Reduction Rate', sub: 'Zero compounding violations on checked SKUs' },
                  { val: '< 1.5s', label: 'Instant Analysis Latency', sub: 'Real-time edge & cloud inference' },
                  { val: '42+', label: 'Jurisdictions Supported', sub: 'State, central, and regional enforcement bodies' }
                ].map((stat, idx) => (
                  <div key={idx} className="p-space-md text-center space-y-1">
                    <div className="font-display-lg text-display-lg text-primary font-bold tracking-tight">{stat.val}</div>
                    <div className="font-label-lg text-label-lg text-on-surface font-semibold">{stat.label}</div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant">{stat.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

        </div>
      </main>

      {/* Tricolor Line */}
      <div className="w-full flex h-[3px] overflow-hidden">
        <div className="flex-1" style={{ backgroundColor: '#FF9933' }}></div>
        <div className="flex-1 bg-surface-container-lowest"></div>
        <div className="flex-1" style={{ backgroundColor: '#138808' }}></div>
      </div>

      <Footer />
    </div>
  );
}
