import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';

export default function CaseStudies() {
  const scenarios = [
    { 
      title: 'Font Size Violation Detection', 
      problem: '60% of packaged goods have incorrect font sizes',
      solution: 'ALMAC detects sub-millimeter discrepancies in Net Quantity and MRP font heights, ensuring compliance with Rule 8 of Legal Metrology Rules 2011.',
      impact: 'Prevents ₹10-50 lakh fines per violation'
    },
    { 
      title: 'Missing Mandatory Declarations', 
      problem: 'Consumer care details often missing or incomplete',
      solution: 'Automated OCR validates all 8 mandatory declarations under Rule 6(1), flagging missing fields before packaging goes to print.',
      impact: 'Avoids product recalls and market seizures'
    },
    { 
      title: 'MRP Syntax Compliance', 
      problem: 'Incorrect "inclusive of taxes" phrasing leads to penalties',
      solution: 'Validates exact statutory phrasing requirements and decimal precision for Unit Sale Price calculations.',
      impact: 'Ensures 100% regulatory compliance'
    },
  ];

  return (
    <div className="min-h-screen bg-surface font-body-md text-on-surface antialiased">
      <Navbar />
      <main className="pt-[6.75rem]">
        <section className="py-space-3xl bg-surface-container-lowest">
          <div className="max-w-[1440px] mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin-desktop">
            <div className="max-w-3xl mx-auto text-center mb-space-2xl">
              <span className="px-space-sm py-1 rounded bg-surface-container text-primary font-label-sm text-label-sm uppercase tracking-wider font-semibold">Real-World Applications</span>
              <h1 className="font-display-lg text-display-lg text-on-surface mt-space-md">Common Compliance Challenges & Solutions</h1>
              <p className="font-body-lg text-body-lg text-on-surface-variant mt-space-sm">See how ALMAC addresses critical packaging compliance issues faced by manufacturers and regulators.</p>
            </div>

            <div className="space-y-space-xl max-w-5xl mx-auto">
              {scenarios.map((scenario, idx) => (
                <div key={idx} className="p-space-lg rounded-xl bg-surface-container-lowest shadow-sm border border-outline-variant/30">
                  <h3 className="font-headline-lg text-headline-lg text-on-surface mb-space-sm">{scenario.title}</h3>
                  <div className="space-y-space-md">
                    <div className="p-space-md rounded-lg bg-error-container/30 border border-error/30">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="material-symbols-outlined text-[18px] text-error">error</span>
                        <span className="font-label-md text-label-md font-semibold text-error">Problem</span>
                      </div>
                      <p className="font-body-md text-body-md text-on-surface-variant">{scenario.problem}</p>
                    </div>
                    <div className="p-space-md rounded-lg bg-primary-container/20 border border-primary/30">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="material-symbols-outlined text-[18px] text-primary">check_circle</span>
                        <span className="font-label-md text-label-md font-semibold text-primary">ALMAC Solution</span>
                      </div>
                      <p className="font-body-md text-body-md text-on-surface-variant">{scenario.solution}</p>
                    </div>
                    <div className="p-space-md rounded-lg bg-surface-container-low border border-outline-variant/30">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[18px] text-primary">trending_up</span>
                        <span className="font-label-md text-label-md font-semibold text-on-surface">Impact:</span>
                        <span className="font-body-md text-body-md text-primary">{scenario.impact}</span>
                      </div>
                    </div>
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