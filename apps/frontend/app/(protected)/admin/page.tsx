'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useLanguage } from '@/lib/language';
import apiClient from '@/lib/api-client';
import { AxiosError } from 'axios';

// ─── Password Change ──────────────────────────────────────────────────────────

function ChangePasswordSection() {
  const { t } = useLanguage();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setStatus('error');
      setMessage(t('admin.passwordMismatch'));
      return;
    }
    if (newPassword.length < 8) {
      setStatus('error');
      setMessage(t('admin.passwordTooShort'));
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      await apiClient.post('/callbot/auth/change-password', { currentPassword, newPassword });
      setStatus('success');
      setMessage(t('admin.passwordChangeSuccess'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: string }>;
      setStatus('error');
      setMessage(axiosErr.response?.data?.error || t('admin.passwordChangeFailed'));
    }
  };

  return (
    <section className="bg-slate-800 rounded-lg p-6 mb-6">
      <h2 className="text-xl font-semibold text-white mb-4">{t('admin.changePassword')}</h2>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">{t('admin.currentPassword')}</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">{t('admin.newPassword')}</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">{t('admin.confirmNewPassword')}</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        {message && (
          <p className={`text-sm ${status === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {message}
          </p>
        )}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-[#fff] font-medium rounded transition"
        >
          {status === 'loading' ? t('admin.saving') : t('admin.changePassword')}
        </button>
      </form>
    </section>
  );
}

// ─── User Management (admin only) ────────────────────────────────────────────

type AppUser = {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'campaign_manager' | 'viewer';
  active: boolean;
};

function UserManagementSection() {
  const { t } = useLanguage();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // New user form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'campaign_manager' | 'viewer'>('viewer');
  const [createStatus, setCreateStatus] = useState('');
  const [createError, setCreateError] = useState('');

  // Edit form
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'campaign_manager' | 'viewer'>('viewer');
  const [editActive, setEditActive] = useState(true);
  const [editPassword, setEditPassword] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editError, setEditError] = useState('');

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get<AppUser[]>('/callbot/auth/users');
      setUsers(res.data);
      setLoaded(true);
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: string }>;
      setError(axiosErr.response?.data?.error || t('admin.loadUsersFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateStatus('loading');
    setCreateError('');
    try {
      await apiClient.post('/callbot/auth/users', {
        username: newUsername,
        displayName: newDisplayName || newUsername,
        password: newPassword,
        role: newRole,
      });
      setCreateStatus('success');
      setNewUsername('');
      setNewDisplayName('');
      setNewPassword('');
      setNewRole('viewer');
      setShowCreateForm(false);
      await loadUsers();
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: string }>;
      setCreateStatus('error');
      setCreateError(axiosErr.response?.data?.error || t('admin.createUserFailed'));
    }
  };

  const openEdit = (u: AppUser) => {
    setEditUser(u);
    setEditDisplayName(u.displayName);
    setEditRole(u.role);
    setEditActive(u.active);
    setEditPassword('');
    setEditStatus('');
    setEditError('');
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setEditStatus('loading');
    setEditError('');
    try {
      const body: Record<string, unknown> = { displayName: editDisplayName, role: editRole, active: editActive };
      if (editPassword) body.password = editPassword;
      await apiClient.put(`/callbot/auth/users/${editUser.id}`, body);
      setEditStatus('success');
      setEditUser(null);
      await loadUsers();
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: string }>;
      setEditStatus('error');
      setEditError(axiosErr.response?.data?.error || t('admin.updateUserFailed'));
    }
  };

  const handleDelete = async (u: AppUser) => {
    if (!confirm(`${t('admin.deleteUserConfirmPrefix')}"${u.username}"${t('admin.deleteUserConfirmSuffix')}`)) return;
    try {
      await apiClient.delete(`/callbot/auth/users/${u.id}`);
      await loadUsers();
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: string }>;
      alert(axiosErr.response?.data?.error || t('admin.deleteUserFailed'));
    }
  };

  if (!loaded) {
    return (
      <section className="bg-slate-800 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold text-white mb-4">{t('admin.userManagement')}</h2>
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <button
          onClick={loadUsers}
          disabled={loading}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded transition"
        >
          {loading ? t('admin.loading') : t('admin.loadUsers')}
        </button>
      </section>
    );
  }

  return (
    <section className="bg-slate-800 rounded-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-white">{t('admin.userManagement')}</h2>
        <button
          onClick={() => { setShowCreateForm(true); setCreateStatus(''); setCreateError(''); }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[#fff] text-sm font-medium rounded transition"
        >
          + {t('admin.newUser')}
        </button>
      </div>

      {/* User table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-left border-b border-slate-700">
              <th className="pb-2 pr-4">{t('admin.username')}</th>
              <th className="pb-2 pr-4">{t('admin.displayName')}</th>
              <th className="pb-2 pr-4">{t('admin.role')}</th>
              <th className="pb-2 pr-4">{t('admin.status')}</th>
              <th className="pb-2">{t('admin.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-700/50">
                <td className="py-2 pr-4 text-white font-mono">
                  {u.username}
                  {u.username === currentUser?.username && (
                    <span className="ml-2 text-xs text-blue-400">{t('admin.you')}</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-gray-300">{u.displayName}</td>
                <td className="py-2 pr-4">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${u.role === 'admin' ? 'bg-purple-600/30 text-purple-300' : 'bg-slate-700 text-gray-300'}`}>
                    {u.role}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${u.active ? 'bg-green-600/30 text-green-400' : 'bg-red-600/30 text-red-400'}`}>
                    {u.active ? t('admin.statusActive') : t('admin.statusInactive')}
                  </span>
                </td>
                <td className="py-2 flex gap-2">
                  <button
                    onClick={() => openEdit(u)}
                    className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-gray-300 text-xs rounded transition"
                  >
                    {t('admin.edit')}
                  </button>
                  {u.username !== currentUser?.username && (
                    <button
                      onClick={() => handleDelete(u)}
                      className="px-3 py-1 bg-red-700/40 hover:bg-red-700 text-red-300 text-xs rounded transition"
                    >
                      {t('admin.delete')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create user modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-white mb-4">{t('admin.createNewUser')}</h3>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-sm text-gray-300 mb-1">{t('admin.username')}</label>
                <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} required
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">{t('admin.displayName')}</label>
                <input type="text" value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder={t('admin.sameAsUsername')} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">{t('admin.password')}</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">{t('admin.role')}</label>
                <select value={newRole} onChange={(e) => setNewRole(e.target.value as 'admin' | 'campaign_manager' | 'viewer')}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500">
                  <option value="viewer">{t('admin.viewer')}</option>
                  <option value="campaign_manager">{t('admin.campaignManager')}</option>
                  <option value="admin">{t('admin.admin')}</option>
                </select>
              </div>
              {createError && <p className="text-red-400 text-sm">{createError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={createStatus === 'loading'}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-[#fff] text-sm font-medium rounded transition">
                  {createStatus === 'loading' ? t('admin.creating') : t('admin.createUser')}
                </button>
                <button type="button" onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-gray-300 text-sm rounded transition">
                  {t('admin.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit user modal */}
      {editUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-white mb-1">{t('admin.editUser')}</h3>
            <p className="text-gray-400 text-sm mb-4 font-mono">{editUser.username}</p>
            <form onSubmit={handleEdit} className="space-y-3">
              <div>
                <label className="block text-sm text-gray-300 mb-1">{t('admin.displayName')}</label>
                <input type="text" value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} required
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">{t('admin.role')}</label>
                <select value={editRole} onChange={(e) => setEditRole(e.target.value as 'admin' | 'campaign_manager' | 'viewer')}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500">
                  <option value="viewer">{t('admin.viewer')}</option>
                  <option value="campaign_manager">{t('admin.campaignManager')}</option>
                  <option value="admin">{t('admin.admin')}</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="editActive" checked={editActive} onChange={(e) => setEditActive(e.target.checked)}
                  className="w-4 h-4 accent-blue-500" />
                <label htmlFor="editActive" className="text-sm text-gray-300">{t('admin.activeCheckbox')}</label>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">{t('admin.newPassword')} <span className="text-gray-500">{t('admin.leaveBlankToKeep')}</span></label>
                <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} minLength={8}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500" />
              </div>
              {editError && <p className="text-red-400 text-sm">{editError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={editStatus === 'loading'}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-[#fff] text-sm font-medium rounded transition">
                  {editStatus === 'loading' ? t('admin.saving') : t('admin.saveChanges')}
                </button>
                <button type="button" onClick={() => setEditUser(null)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-gray-300 text-sm rounded transition">
                  {t('admin.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-white mb-6">{t('admin.title')}</h1>

      <ChangePasswordSection />

      {user?.role === 'admin' && <UserManagementSection />}
    </div>
  );
}
