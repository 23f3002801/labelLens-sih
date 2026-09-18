import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import logo from '../../assets/logo.png';

export default function DashboardLayout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(api.getUser());
  const [lineStyle, setLineStyle] = useState({ top: 0, height: 0 });

  const handleLogout = () => {
    api.removeToken();
    api.removeUser();
    navigate('/');
  };

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: 'dashboard' },
    { name: 'New Scan', path: '/dashboard/scan', icon: 'add_a_photo' },
    { name: 'Inspections', path: '/dashboard/inspections', icon: 'fact_check' },
    { name: 'Reports', path: '/dashboard/reports', icon: 'description' },
    { name: 'Settings', path: '/dashboard/settings', icon: 'settings' }
  ];

  const isActive = (path) => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    return location.pathname.startsWith(path);
  };

  const moveLine = (element) => {
    if (element) {
      const navContainer = document.getElementById('sidebar-nav');
      if (navContainer) {
        const rect = element.getBoundingClientRect();
        const parent = navContainer.getBoundingClientRect();
        setLineStyle({
          top: rect.top - parent.top,
          height: rect.height
        });
      }
    }
  };

  useEffect(() => {
    const activeItem = navItems.find(item => isActive(item.path));
    const navContainer = document.getElementById('sidebar-nav');
    if (navContainer && activeItem) {
      setTimeout(() => {
        const links = navContainer.querySelectorAll('a');
        links.forEach(link => {
          if (link.getAttribute('href') === activeItem.path) {
            moveLine(link);
          }
        });
      }, 50);
    }
  }, [location.pathname]);

  const displayRole = user?.role?.replace('_', ' ') || 'Inspector';

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200/60 fixed h-full flex flex-col z-50 shadow-sm">
        {/* Logo Section */}
        <div className="p-6 border-b border-slate-200/60 flex-shrink-0">
          <Link to="/" className="flex items-center gap-3 group">
            <img
              src={logo}
              alt="ALMAC logo"
              className="w-14 h-14 rounded-2xl object-contain shadow-lg ring-1 ring-slate-200/50 group-hover:scale-105 transition-all duration-300"
            />
            <div>
              <span className="font-bold text-xl text-slate-900 tracking-tight">ALMAC</span>
              <p className="text-[10px] text-slate-600 -mt-0.5 uppercase tracking-wider font-bold">Compliance Engine</p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav id="sidebar-nav" className="p-4 flex-1 relative overflow-y-auto">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl font-semibold text-[15px] transition-all duration-200 relative z-10 mb-1 ${
                isActive(item.path)
                  ? 'text-white shadow-lg'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="material-symbols-outlined text-[22px]">{item.icon}</span>
              {item.name}
            </Link>
          ))}
          
          {/* Sliding indicator */}
          <div
            className="absolute left-4 right-4 bg-gradient-to-r from-primary to-primary-container rounded-2xl shadow-lg transition-all duration-300 ease-out -z-0"
            style={{
              top: `${lineStyle.top}px`,
              height: `${lineStyle.height}px`,
            }}
          />
        </nav>

        {/* User Profile Section */}
        <div className="p-4 border-t border-slate-200/60 flex-shrink-0">
          <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200/50 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-primary-container flex items-center justify-center text-white font-bold shadow-lg">
                {user?.fullName?.charAt(0) || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-slate-900 truncate">{user?.fullName || 'User'}</p>
                <p className="text-xs text-slate-600 truncate font-medium">{displayRole}</p>
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-600 transition-all font-semibold text-sm"
          >
            <span className="material-symbols-outlined text-[18px]">logout</span>
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 ml-64">
        {/* Top Bar */}
        <header className="h-16 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 flex items-center justify-between px-8 sticky top-0 z-40">
          <div>
            <h2 className="font-bold text-lg text-slate-900">Compliance Dashboard</h2>
            <p className="text-xs text-slate-600">Legal Metrology Verification System</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 text-emerald-700 text-sm border border-emerald-200/50">
              <span className="material-symbols-outlined text-primary text-[18px]">verified_user</span>
              <span className="font-bold">Engine online</span>
            </div>
            <button className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-all relative">
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white"></span>
            </button>
            <button className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-all">
              <span className="material-symbols-outlined text-[20px]">help</span>
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-8 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}