import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';

export default function Solutions() {
  const features = [
    { icon: 'document_scanner', tag: 'Rule 6(1) Protocol', title: 'Mandatory Declaration OCR', desc: 'Identifies and confirms all 8 statutory packaging fields: generic product name, manufacturer/packer postal address, importer address, country of origin, consumer care coordinates, and commodity weight.', valid: 'Section 6 Mandate Validated' },
    { icon: 'straighten', tag: 'Geometric PDP Ratios', title: 'Font Height & Area Ratio', desc: 'Instant sub-millimeter geometric verification checking that numeral heights on Net Quantity and MRP conform to mandatory statutory scales based on total Principal Display Panel area.', valid: 'Min. 1.0mm - 6.0mm Scale Check' },
    { icon: 'calculate', tag: 'Statutory Pricing Formula', title: 'Unit Sale Price (USP) Engine', desc: 'Ensures required "₹ per g", "₹ per ml", or "₹ per item" calculation follows round-off standards up to two decimal places, preventing heavy statutory fines on consumer misdirection.', valid: '2022 Amendment Standard Compliant' },
    { icon: 'barcode_scanner', tag: 'Pricing & Lot Control', title: 'MRP & Batch Code Inspection', desc: 'Precise syntax inspection verifying mandatory "MRP inclusive of all taxes" phraseology, legible manufacture dates, standardized expiration windows, and indelible lot serialization.', valid: 'Tax Inclusivity Text Assured' },
    { icon: 'shield_with_heart', tag: 'Legal Dispute Defense', title: 'Automated LMPC Notice Defense', desc: 'Produces cryptographically stamped, time-stamped proof logs and detailed statutory declaration records ready to append directly to legal notices or controller inquiries.', valid: 'Audit Ready Export (PDF/CSV)' },
    { icon: 'layers', tag: 'Pre-Press Integration', title: 'Multi-SKU Pipeline Connect', desc: 'Integrates directly with Adobe Illustrator, ArtiosCAD, and enterprise Digital Asset Management systems to batch-validate hundreds of SKUs during artwork finalization.', valid: 'Native Vector Parsing' },
  ];

  return (
    <div className="min-h-screen bg-surface font-body-md text-on-surface antialiased">
      <Navbar />
      <main className="pt-[6.75rem]">
        <section className="py-space-3xl bg-surface-container-lowest">
          <div className="max-w-[1440px] mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin-desktop">
            <div className="max-w-3xl mx-auto text-center mb-space-2xl">
              <span className="px-space-sm py-1 rounded bg-surface-container text-primary font-label-sm text-label-sm uppercase tracking-wider font-semibold">Comprehensive Precision Engine</span>
              <h1 className="font-display-lg text-display-lg text-on-surface mt-space-md">Our Solutions</h1>
              <p className="font-body-lg text-body-lg text-on-surface-variant mt-space-sm">Everything required for 100% packaged commodities compliance. Detect violations before artwork is etched into expensive printing plates.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-lg">
              {features.map((feature, idx) => (
                <div key={idx} className="p-space-lg rounded-xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-all border border-outline-variant/30 flex flex-col justify-between">
                  <div className="space-y-space-sm">
                    <div className="w-12 h-12 rounded-lg bg-surface-container-low flex items-center justify-center text-primary">
                      <span className="material-symbols-outlined text-[28px]">{feature.icon}</span>
                    </div>
                    <div className="space-y-1">
                      <span className="font-label-sm text-label-sm text-primary font-semibold tracking-wider uppercase">{feature.tag}</span>
                      <h3 className="font-headline-sm text-headline-sm text-on-surface">{feature.title}</h3>
                    </div>
                    <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">{feature.desc}</p>
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
      </main>
      <Footer />
    </div>
  );
}