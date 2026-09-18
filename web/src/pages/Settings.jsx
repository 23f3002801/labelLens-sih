import { useState, useEffect } from 'react';
import api from '../services/api';
import DashboardLayout from '../components/dashboard/DashboardLayout';

export default function Settings() {
  const [user, setUser] = useState(api.getUser());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const updated = await api.updateProfile({
        fullName: e.target.fullName.value,
        district: e.target.district.value,
        state: e.target.state.value,
      });
      api.setUser(updated.user);
      setUser(updated.user);
      setMessage('Profile updated successfully!');
    } catch (err) {
      setMessage(err.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
        
        <div>
          <h1 className="text-3xl font-bold text-on-surface mb-2">Settings</h1>
          <p className="text-on-surface-variant">Manage your account and preferences</p>
        </div>

        {/* Profile */}
        <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-sm border border-outline-variant/30">
          <h2 className="text-lg font-semibold text-on-surface mb-6">Profile Information</h2>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-on-surface mb-2">Full Name</label>
              <input
                name="fullName"
                defaultValue={user?.fullName || ''}
                className="w-full px-4 py-3 rounded-xl bg-surface-container-low border border-outline-variant/30 text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-on-surface mb-2">Email</label>
              <input
                defaultValue={user?.email || ''}
                disabled
                className="w-full px-4 py-3 rounded-xl bg-surface-container-low border border-outline-variant/30 text-on-surface-variant cursor-not-allowed"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-on-surface mb-2">District</label>
                <input
                  name="district"
                  defaultValue={user?.district || ''}
                  className="w-full px-4 py-3 rounded-xl bg-surface-container-low border border-outline-variant/30 text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface mb-2">State</label>
                <input
                  name="state"
                  defaultValue={user?.state || ''}
                  className="w-full px-4 py-3 rounded-xl bg-surface-container-low border border-outline-variant/30 text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-on-surface mb-2">Role</label>
              <input
                defaultValue={user?.role?.replace('_', ' ') || ''}
                disabled
                className="w-full px-4 py-3 rounded-xl bg-surface-container-low border border-outline-variant/30 text-on-surface-variant cursor-not-allowed"
              />
            </div>

            {message && (
              <div className="p-3 rounded-lg bg-success-container text-on-success-container text-sm">{message}</div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-primary-container text-white font-semibold shadow-lg hover:shadow-xl hover:scale-105 transition-all disabled:opacity-50 disabled:scale-100"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>

      </div>
    </DashboardLayout>
  );
}