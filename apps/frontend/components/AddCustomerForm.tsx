'use client';

import { useState } from 'react';
import callbotApi from '@/lib/callbot-api';
import { useLanguage } from '@/lib/language';

interface AddCustomerFormProps {
  onSuccess: () => void;
  onClose: () => void;
}

export default function AddCustomerForm({ onSuccess, onClose }: AddCustomerFormProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    surname: '',
    phone: '',
    email: '',
    debtAmount: 0,
    overdueDays: 0,
    daysDue: 0,
    status: 'active' as 'active' | 'inactive' | 'completed',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await callbotApi.createCustomer(formData);
      if (result) {
        onSuccess();
        onClose();
      } else {
        setError(t('customerForm.errorCreateFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('customerForm.errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg max-w-md w-full">
        <div className="p-6 border-b border-slate-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">{t('customerForm.heading')}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-500/20 border border-red-500 rounded p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('customerForm.firstName')}
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder={t('customerForm.firstNamePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('customerForm.lastName')}
            </label>
            <input
              type="text"
              required
              value={formData.surname}
              onChange={(e) => setFormData({ ...formData, surname: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder={t('customerForm.lastNamePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('customerForm.phone')}
            </label>
            <input
              type="tel"
              required
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder={t('customerForm.phonePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('customerForm.email')}
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder={t('customerForm.emailPlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('customerForm.debtAmount')}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.debtAmount}
                onChange={(e) => setFormData({ ...formData, debtAmount: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('customerForm.overdueDays')}
              </label>
              <input
                type="number"
                min="0"
                value={formData.overdueDays}
                onChange={(e) => setFormData({ ...formData, overdueDays: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('customerForm.daysDue')}
            </label>
            <input
              type="number"
              min="0"
              value={formData.daysDue}
              onChange={(e) => setFormData({ ...formData, daysDue: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('customerForm.status')}
            </label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' | 'completed' })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500"
            >
              <option value="active">{t('customerForm.statusActive')}</option>
              <option value="inactive">{t('customerForm.statusInactive')}</option>
              <option value="completed">{t('customerForm.statusCompleted')}</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600 transition"
            >
              {t('customerForm.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-[#fff] rounded hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t('customerForm.submitting') : t('customerForm.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
