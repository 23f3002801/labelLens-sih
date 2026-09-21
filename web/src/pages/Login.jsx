import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import logo from '../assets/logo.png';

export default function Login() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.login(formData.email, formData.password);
      
      api.setToken(response.token);
      api.setUser(response.user);
      
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface font-body-md text-on-surface antialiased flex">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary flex-col justify-between p-space-3xl relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="login-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#FFFFFF" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect fill="url(#login-grid)" width="100%" height="100%"></rect>
          </svg>
        </div>

        <Link to="/" className="relative z-10 flex items-center gap-space-xs">
          <img src={logo} alt="ALMAC logo" className="w-20 h-20 object-cover object-center" />
          <span className="font-display-lg text-display-lg text-on-primary font-bold">ALMAC</span>
          <span className="px-space-xs py-space-2xs rounded bg-surface-container-lowest/20 text-on-primary border border-on-primary/30 font-label-sm text-label-sm uppercase tracking-wide">Compliance Engine</span>
        </Link>

        <div className="relative z-10 space-y-space-lg">
          <div className="space-y-space-sm">
            <h1 className="font-display-lg text-display-lg text-on-primary leading-tight">
              Welcome to the Future of Legal Metrology Compliance.
            </h1>
            <p className="font-body-lg text-body-lg text-on-primary/90 max-w-md">
              Sub-millimeter precision. Zero-recall guarantee. Instant audit certification.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-space-md max-w-md">
            <div className="p-space-md rounded-xl bg-surface-container-lowest/10 backdrop-blur border border-on-primary/20">
              <div className="font-display-lg-mobile text-display-lg-mobile text-on-primary font-bold">99.8%</div>
              <div className="font-label-sm text-label-sm text-on-primary/80">Audit Accuracy</div>
            </div>
            <div className="p-space-md rounded-xl bg-surface-container-lowest/10 backdrop-blur border border-on-primary/20">
              <div className="font-display-lg-mobile text-display-lg-mobile text-on-primary font-bold">&lt;1.5s</div>
              <div className="font-label-sm text-label-sm text-on-primary/80">Analysis Latency</div>
            </div>
          </div>
        </div>

        <div className="relative z-10 font-label-sm text-label-sm text-on-primary/70">
          © 2026 ALMAC Technologies Inc. All rights reserved.
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-space-xl md:p-space-3xl bg-surface-container-lowest">
        <div className="w-full max-w-md space-y-space-lg">
          <Link to="/" className="lg:hidden flex items-center gap-space-xs mb-space-md">
            <img src={logo} alt="ALMAC logo" className="w-20 h-20 object-cover object-center" />
            <span className="font-display-lg text-display-lg text-on-surface font-bold">ALMAC</span>
            <span className="px-space-xs py-space-2xs rounded bg-surface-container-low text-primary border border-outline-variant font-label-sm text-label-sm uppercase tracking-wide">Compliance Engine</span>
          </Link>

          <div className="space-y-space-xs">
            <h2 className="font-display-lg-mobile text-display-lg-mobile text-on-surface">Sign in to ALMAC</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Access your compliance dashboard and inspection history.
            </p>
          </div>

          {error && (
            <div className="p-space-md rounded-lg bg-error-container border border-error/30 flex items-start gap-2">
              <span className="material-symbols-outlined text-error text-[20px]">error</span>
              <p className="font-body-sm text-body-sm text-on-error">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-space-md">
            <div className="space-y-space-xs">
              <label htmlFor="email" className="font-label-md text-label-md text-on-surface">Email Address</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={formData.email}
                onChange={handleChange}
                placeholder="officer.sharma@almac.gov.in"
                className="w-full h-10 px-space-md rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface font-body-md placeholder:text-on-surface-variant/50 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              />
            </div>

            <div className="space-y-space-xs">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="font-label-md text-label-md text-on-surface">Password</label>
                <a href="#" className="font-label-sm text-label-sm text-primary hover:underline">Forgot password?</a>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                required
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                className="w-full h-10 px-space-md rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface font-body-md placeholder:text-on-surface-variant/50 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-lg bg-primary text-on-primary font-label-lg text-label-lg font-semibold shadow-md hover:bg-primary-container transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin"></span>
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="relative py-space-xs">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-outline-variant/30"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="px-space-sm bg-surface-container-lowest font-label-sm text-label-sm text-on-surface-variant">or</span>
            </div>
          </div>

          <div className="text-center">
            <p className="font-body-md text-body-md text-on-surface-variant">
              New to ALMAC?{' '}
              <Link to="/register" className="text-primary font-semibold hover:underline">Create an account</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
