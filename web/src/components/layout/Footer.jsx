export default function Footer() {
  return (
    <footer className="w-full bg-surface-container-lowest border-t border-outline-variant/30 py-space-3xl">
      <div className="max-w-[1440px] mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin-desktop">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-space-xl pb-space-2xl border-b border-outline-variant/30">
          <div className="lg:col-span-2 space-y-space-md">
            <div className="flex items-center gap-space-xs">
              <span className="font-headline-sm text-headline-sm text-on-surface font-bold">ALMAC</span>
              <span className="px-space-xs py-space-2xs rounded bg-surface-container-low text-primary border border-outline-variant font-label-sm text-label-sm uppercase tracking-wide">AUTOMATED COMPLIANCE</span>
            </div>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-md">
              Enterprise statutory verification platform automating compliance inspection across Legal Metrology Acts, Packaged Commodities Rules, and regional packaging mandates.
            </p>
            <div className="flex flex-wrap items-center gap-space-xs pt-space-xs">
              <span className="px-space-xs py-space-2xs rounded bg-surface-container-low border border-outline-variant font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-primary">verified</span>ISO/IEC 27001 Certified
              </span>
              <span className="px-space-xs py-space-2xs rounded bg-surface-container-low border border-outline-variant font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-primary">balance</span>Weights & Measures Compliant
              </span>
            </div>
          </div>

          <div>
            <h4 className="font-label-lg text-label-lg text-on-surface mb-space-sm uppercase tracking-wider">Legal & Statutory</h4>
            <ul className="space-y-space-xs">
              <li className="font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface"><a href="#">Legal Metrology Act (2009)</a></li>
              <li className="font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface"><a href="#">Packaged Commodities Rules</a></li>
              <li className="font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface"><a href="#">Statutory Disclaimers</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-label-lg text-label-lg text-on-surface mb-space-sm uppercase tracking-wider">Platform</h4>
            <ul className="space-y-space-xs">
              <li className="font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface"><a href="#">Verification Engine</a></li>
              <li className="font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface"><a href="#">API Reference</a></li>
              <li className="font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface"><a href="#">Rule Mapping Matrix</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-label-lg text-label-lg text-on-surface mb-space-sm uppercase tracking-wider">Governance</h4>
            <ul className="space-y-space-xs">
              <li className="font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface"><a href="#">Privacy Policy</a></li>
              <li className="font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface"><a href="#">Data Integrity & Security</a></li>
              <li className="font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface"><a href="#">Regulatory Helpdesk</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-space-lg flex flex-col md:flex-row items-center justify-between gap-space-md">
          <p className="font-body-sm text-body-sm text-on-surface-variant text-center md:text-left">
            Disclaimer: This platform performs automated statutory checks against Gazette notifications. Outputs do not constitute formal legal certification by the Legal Metrology Department.
          </p>
          <p className="font-body-sm text-body-sm text-on-surface-variant flex-shrink-0">
            © 2026 ALMAC Technologies Inc. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}