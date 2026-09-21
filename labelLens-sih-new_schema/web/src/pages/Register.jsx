import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import logo from '../assets/logo.png';

export default function Register() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    role: 'INSPECTOR',
    district: '',
    state: '',
    badgeNumber: '',
  });
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
      const governmentRoles = [
        'DIRECTOR',
        'CONTROLLER',
        'REVIEWER',
        'INSPECTOR',
      ];
      const isGovernmentRole = governmentRoles.includes(formData.role);
      const registrationData = {
        email: formData.email.trim(),
        password: formData.password,
        fullName: formData.fullName.trim(),
        role: formData.role,
        ...(isGovernmentRole
          ? {
              badgeNumber: formData.badgeNumber.trim(),
              district: formData.district.trim(),
              state: formData.state.trim(),
            }
          : {}),
      };
      const payload = Object.fromEntries(
        Object.entries(registrationData).filter(([, value]) => value !== '')
      );
      const response = await api.register(payload);
      
      // Auto-login after registration
      api.setToken(response.token);
      api.setUser(response.user);
      
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface font-body-md text-on-surface antialiased flex">
      {/* Left Side - Branding (Same as Login) */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary flex-col justify-between p-space-3xl relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="register-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#FFFFFF" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect fill="url(#register-grid)" width="100%" height="100%"></rect>
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
              Join the Compliance Revolution.
            </h1>
            <p className="font-body-lg text-body-lg text-on-primary/90 max-w-md">
              Create your inspector account and start verifying packaged commodities in seconds.
            </p>
          </div>
        </div>

        <div className="relative z-10 font-label-sm text-label-sm text-on-primary/70">
          © 2026 ALMAC Technologies Inc. All rights reserved.
        </div>
      </div>

      {/* Right Side - Register Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-space-xl md:p-space-2xl bg-surface-container-lowest overflow-y-auto">
        <div className="w-full max-w-md space-y-space-lg">
          <Link to="/" className="lg:hidden flex items-center gap-space-xs mb-space-md">
            <img src={logo} alt="ALMAC logo" className="w-20 h-20 object-cover object-center" />
            <span className="font-display-lg text-display-lg text-on-surface font-bold">ALMAC</span>
            <span className="px-space-xs py-space-2xs rounded bg-surface-container-low text-primary border border-outline-variant font-label-sm text-label-sm uppercase tracking-wide">Compliance Engine</span>
          </Link>

          <div className="space-y-space-xs">
            <h2 className="font-display-lg-mobile text-display-lg-mobile text-on-surface">Create Account</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Register as a compliance inspector or regulatory officer.
            </p>
          </div>

          {error && (
            <div className="p-space-md rounded-lg bg-error-container border border-error/30 flex items-start gap-2">
              <span className="material-symbols-outlined text-error text-[20px]">error</span>
              <p className="font-body-sm text-body-sm text-error-container-on">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-space-md">
            {/* Full Name */}
            <div className="space-y-space-xs">
              <label htmlFor="fullName" className="font-label-md text-label-md text-on-surface">Full Name *</label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                required
                value={formData.fullName}
                onChange={handleChange}
                placeholder="Rajesh Sharma"
                className="w-full h-10 px-space-md rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface font-body-md placeholder:text-on-surface-variant/50 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              />
            </div>

            {/* Email */}
            <div className="space-y-space-xs">
              <label htmlFor="email" className="font-label-md text-label-md text-on-surface">Email Address *</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={formData.email}
                onChange={handleChange}
                placeholder="officer.sharma@labellens.gov.in"
                className="w-full h-10 px-space-md rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface font-body-md placeholder:text-on-surface-variant/50 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              />
            </div>

            {/* Password */}
            <div className="space-y-space-xs">
              <label htmlFor="password" className="font-label-md text-label-md text-on-surface">Password * (min 6 characters)</label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength="6"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                className="w-full h-10 px-space-md rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface font-body-md placeholder:text-on-surface-variant/50 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              />
            </div>

            {/* Role */}
            <div className="space-y-space-xs">
              <label htmlFor="role" className="font-label-md text-label-md text-on-surface">Role *</label>
              <select
                id="role"
                name="role"
                required
                value={formData.role}
                onChange={handleChange}
                className="w-full h-10 px-space-md rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface font-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              >
                <option value="DIRECTOR">Director</option>
                <option value="CONTROLLER">Controller</option>
                <option value="REVIEWER">Reviewer</option>
                <option value="INSPECTOR">Inspector</option>
                <option value="MANUFACTURER">Manufacturer</option>
                <option value="CONSUMER">Consumer</option>
              </select>
            </div>

            {['DIRECTOR', 'CONTROLLER', 'REVIEWER', 'INSPECTOR'].includes(formData.role) && (
              <>
                {/* Badge Number */}
                <div className="space-y-space-xs">
                  <label htmlFor="badgeNumber" className="font-label-md text-label-md text-on-surface">Badge Number</label>
                  <input
                    id="badgeNumber"
                    name="badgeNumber"
                    type="text"
                    value={formData.badgeNumber}
                    onChange={handleChange}
                    placeholder="UP-LM-4821"
                    className="w-full h-10 px-space-md rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface font-body-md placeholder:text-on-surface-variant/50 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                  />
                </div>

                {/* District & State */}
                <div className="grid grid-cols-2 gap-space-md">
                  <div className="space-y-space-xs">
                    <label htmlFor="district" className="font-label-md text-label-md text-on-surface">District{formData.role === 'CONTROLLER' ? ' *' : ''}</label>
                    <input
                      id="district"
                      name="district"
                      type="text"
                      required={formData.role === 'CONTROLLER'}
                      value={formData.district}
                      onChange={handleChange}
                      placeholder="Varanasi"
                      className="w-full h-10 px-space-md rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface font-body-md placeholder:text-on-surface-variant/50 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-space-xs">
                    <label htmlFor="state" className="font-label-md text-label-md text-on-surface">State</label>
                    <input
                      id="state"
                      name="state"
                      type="text"
                      value={formData.state}
                      onChange={handleChange}
                      placeholder="Uttar Pradesh"
                      className="w-full h-10 px-space-md rounded-lg bg-surface-container-lowest border border-outline-variant text-on-surface font-body-md placeholder:text-on-surface-variant/50 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-lg bg-primary text-on-primary font-label-lg text-label-lg font-semibold shadow-md hover:bg-primary-container transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin"></span>
                  Creating account...
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          {/* Login Link */}
          <div className="text-center">
            <p className="font-body-md text-body-md text-on-surface-variant">
              Already have an account?{' '}
              <Link to="/login" className="text-primary font-semibold hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
