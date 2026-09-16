import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';

export default function RegulatoryStandards() {
  const rules = [
    { icon: 'document_scanner', code: 'Rule 6(1)', title: 'Mandatory Declarations', desc: 'Every packaged commodity must display: Name & address of manufacturer/packer/importer, Generic name of commodity, Net quantity, Month & year of manufacture/packing/import, and Maximum Retail Price (MRP).' },
    { icon: 'straighten', code: 'Rule 7', title: 'Declaration of Net Quantity', desc: 'Net quantity shall be declared in terms of weight, measure, volume, number, or length as appropriate. For packages below 50g/ml, font height must be at least 1.0mm.' },
    { icon: 'calculate', code: 'Rule 8', title: 'Font Size & Area Ratio', desc: 'The height of numerals declaring net quantity must be proportional to the Principal Display Panel (PDP) area. Minimum 2.0mm for PDP > 100 sq cm.' },
    { icon: 'barcode_scanner', code: 'Rule 9', title: 'MRP & Retail Sale Price', desc: 'MRP inclusive of all taxes must be displayed. "₹ per unit" (USP) is mandatory for packages > 100g/100ml to prevent consumer misdirection.' },
    { icon: 'shield_with_heart', code: 'Rule 10', title: 'Consumer Care Details', desc: 'A dedicated consumer care contact (phone/email) must be clearly visible for grievance redressal.' },
  ];

  return (
    <div className="min-h-screen bg-surface font-body-md text-on-surface antialiased">
      <Navbar />
      <main className="pt-[6.75rem]">
        <section className="py-space-3xl bg-surface-container-lowest">
          <div className="max-w-[1440px] mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin-desktop">
            <div className="max-w-3xl mx-auto text-center mb-space-2xl">
              <span className="px-space-sm py-1 rounded bg-surface-container text-primary font-label-sm text-label-sm uppercase tracking-wider font-semibold">Legal Framework</span>
              <h1 className="font-display-lg text-display-lg text-on-surface mt-space-md">Regulatory Standards & Compliance Rules</h1>
              <p className="font-body-lg text-body-lg text-on-surface-variant mt-space-sm">ALMAC is strictly aligned with the Legal Metrology (Packaged Commodities) Rules, 2011, and subsequent Gazette notifications.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-lg">
              {rules.map((rule, idx) => (
                <div key={idx} className="p-space-lg rounded-xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-all border border-outline-variant/30 flex flex-col justify-between">
                  <div className="space-y-space-sm">
                    <div className="w-12 h-12 rounded-lg bg-surface-container-low flex items-center justify-center text-primary">
                      <span className="material-symbols-outlined text-[28px]">{rule.icon}</span>
                    </div>
                    <div className="space-y-1">
                      <span className="px-2 py-1 rounded bg-primary-container text-on-primary font-label-sm text-label-sm font-bold inline-block">{rule.code}</span>
                      <h3 className="font-headline-sm text-headline-sm text-on-surface">{rule.title}</h3>
                    </div>
                    <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">{rule.desc}</p>
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