import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import api from '../../services/api';
import logo from '../../assets/logo.png';

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/';
  const user = api.getUser();
  
  // State for the sliding line
  const [lineStyle, setLineStyle] = useState({ left: 0, width: 0 });
  const navRef = useRef(null);

  const handleSolutionsClick = (e) => {
    if (isHome) {
      e.preventDefault();
      const featuresSection = document.getElementById('features-section');
      if (featuresSection) {
        featuresSection.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  const handleLogout = () => {
    api.removeToken();
    api.removeUser();
    navigate('/');
    window.location.reload();
  };

  const navLinks = [
    { name: 'Solutions', path: '/', onClick: handleSolutionsClick },
    { name: 'Regulatory Standards', path: '/regulatory-standards' },
    { name: 'Case Studies', path: '/case-studies' },
    { name: 'Documentation', path: '/documentation' }
  ];

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path;
  };

  // Function to move the line
  const moveLine = useCallback((element) => {
    if (element && navRef.current) {
      const navRect = navRef.current.getBoundingClientRect();
      const elRect = element.getBoundingClientRect();
      setLineStyle({
        left: elRect.left - navRect.left,
        width: elRect.width
      });
    }
  }, []);

  // Reset line to active page when mouse leaves nav
  const handleNavLeave = useCallback(() => {
    const activeLink = navLinks.find(link => isActive(link.path));
    if (activeLink && navRef.current) {
      // Find the DOM element for the active link
      const links = navRef.current.querySelectorAll('a');
      links.forEach(link => {
        if (link.getAttribute('href') === activeLink.path) {
          moveLine(link);
        }
      });
    }
  }, [location.pathname, moveLine]);

  // Initialize line on active page on load
  useEffect(() => {
    handleNavLeave();
  }, [location.pathname, handleNavLeave]);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-surface-container-lowest border-b border-outline-variant/40 shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      {/* Top Institutional Bar */}
      <div className="w-full bg-surface-container-low border-b border-outline-variant/40 px-margin-mobile md:px-margin-tablet lg:px-margin-desktop py-1.5 flex items-center justify-between text-[11px] text-on-surface-variant font-label-sm tracking-wide">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 bg-surface-container-lowest border border-outline-variant/40">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#FF9933' }}></span>
            <span className="w-2 h-2 rounded-full border border-outline-variant/30" style={{ backgroundColor: '#FFFFFF' }}></span>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#138808' }}></span>
          </span>
          <span className="font-medium">Aligned with the Legal Metrology (Packaged Commodities) Rules, 2011 • Dept. of Consumer Affairs, Govt. of India</span>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <span className="material-symbols-outlined text-[14px] text-primary">account_balance</span>
          <span className="font-medium">Official Regulatory Standard • Gazette of India Compliant</span>
        </div>
      </div>

      {/* Main Nav */}
      <div className="h-20 max-w-[1440px] mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin-desktop flex items-center justify-between gap-gutter-desktop">
        <Link to="/" className="flex items-center gap-space-sm flex-shrink-0">
          <div className="flex items-center gap-space-xs">
            <img 
  src={logo}
  alt="ALMAC Logo" 
  className="w-12 h-12 object-cover object-center"
/>
            <span className="font-headline-sm text-headline-sm text-on-surface tracking-tight font-bold">ALMAC</span>
            <span className="px-space-xs py-space-2xs rounded bg-surface-container-low text-primary border border-outline-variant font-label-sm text-label-sm uppercase tracking-wide">Compliance Engine</span>
          </div>
        </Link>
        
        {/*  NAVIGATION WITH SLIDING LINE ✨ */}
        <nav 
          ref={navRef}
          className="hidden lg:flex items-center gap-space-lg relative"
          onMouseLeave={handleNavLeave}
        >
          {navLinks.map((link) => (
            <Link
              key={link.name}
              to={link.path}
              onClick={link.onClick}
              state={{ scrollToFeatures: link.path === '/' && !isHome }}
              onMouseEnter={(e) => moveLine(e.currentTarget)}
              className={`relative font-label-lg text-label-lg py-2 transition-colors duration-300 z-10 ${
                isActive(link.path)
                  ? 'text-primary'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              {link.name}
            </Link>
          ))}

          {/* The Single Traveling Green Line */}
          <span
            className="absolute bottom-0 h-[2px] bg-primary transition-all duration-300 ease-out z-0"
            style={{
              left: `${lineStyle.left}px`,
              width: `${lineStyle.width}px`,
            }}
          />
        </nav>

        <div className="flex items-center gap-space-md flex-shrink-0">
          {user ? (
            <div className="flex items-center gap-space-md">
              <Link to="/dashboard" className="font-label-lg text-label-lg text-on-surface-variant hover:text-on-surface transition-colors hidden sm:inline-block">
                Dashboard
              </Link>
              <div className="flex items-center gap-2 px-space-sm py-space-xs rounded-lg bg-surface-container-low border border-outline-variant/30">
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-on-primary text-[16px]">person</span>
                </div>
                <span className="font-label-md text-label-md text-on-surface font-medium hidden sm:inline-block">
                  {user.fullName}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="font-label-md text-label-md text-on-surface-variant hover:text-error transition-colors"
                title="Logout"
              >
                <span className="material-symbols-outlined text-[20px]">logout</span>
              </button>
            </div>
          ) : (
            <>
              <Link to="/login" className="font-label-lg text-label-lg text-on-surface-variant hover:text-on-surface transition-colors hidden sm:inline-block">Sign In</Link>
              <Link to="/register" className="px-space-md py-space-xs rounded-lg bg-primary-container hover:bg-primary text-on-primary font-label-lg text-label-lg shadow-[0_1px_3px_0_rgba(15,23,42,0.05)] transition-all flex items-center justify-center">
                Get Started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
