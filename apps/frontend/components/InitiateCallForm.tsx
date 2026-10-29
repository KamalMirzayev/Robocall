'use client';

import { useState } from 'react';
import apiClient from '@/lib/api-client';
import { useAgents } from '@/hooks/useCallbot';
import { useTelephony } from '@/hooks/useTelephony';
import { useLanguage } from '@/lib/language';
import CustomerSearchSelect from './CustomerSearchSelect';
import type { Customer } from '@/types/callbot';

interface InitiateCallFormProps {
  onSuccess?: () => void;
}

export default function InitiateCallForm({ onSuccess }: InitiateCallFormProps) {
  const { t } = useLanguage();
  const { agents } = useAgents();
  const { accounts: sipAccounts, trunks: sipTrunks } = useTelephony();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState({
    customerId: '',
    agentId: '',
    phone: '',
    trunkId: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (!formData.customerId || !formData.agentId) {
        setError(t('initiateCallForm.customerAgentRequired'));
        setLoading(false);
        return;
      }

      const response = await apiClient.post('/callbot/telephony/jobs', {
        customerId: Number(formData.customerId),
        agentId: Number(formData.agentId),
        phone: formData.phone,
        trunkId: formData.trunkId || undefined,
      });

      setSuccess(`${t('initiateCallForm.callInitiatedSuccess')} ${response.data.job?.id}`);
      setFormData({
        customerId: '',
        agentId: '',
        phone: '',
        trunkId: '',
      });
      setSelectedCustomer(null);

      setTimeout(() => {
        setSuccess(null);
        onSuccess?.();
      }, 2000);
    } catch (err) {
      const errorMsg = (err as any)?.response?.data?.error ||
                       (err instanceof Error ? err.message : t('initiateCallForm.failedToInitiateCall'));
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const defaultPhone = selectedCustomer?.phone || '';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-500/20 border border-green-500 rounded-lg p-4 text-green-400">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Customer Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">
            {t('initiateCallForm.customerLabel')}
          </label>
          <CustomerSearchSelect
            value={selectedCustomer}
            onChange={(customer) => {
              setSelectedCustomer(customer);
              setFormData({
                ...formData,
                customerId: customer ? String(customer.id) : '',
                phone: customer?.phone || '',
              });
            }}
            placeholder={t('initiateCallForm.selectCustomerPlaceholder')}
          />
        </div>

        {/* Agent Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">
            {t('initiateCallForm.agentLabel')}
          </label>
          <select
            required
            value={formData.agentId}
            onChange={(e) => setFormData({ ...formData, agentId: e.target.value })}
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">{t('initiateCallForm.selectAgentPlaceholder')}</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>

        {/* Phone Number */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">
            {t('initiateCallForm.phoneNumberLabel')}
          </label>
          <input
            type="tel"
            value={formData.phone || defaultPhone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            placeholder={defaultPhone || t('initiateCallForm.phonePlaceholder')}
          />
          <p className="text-xs text-gray-500 mt-1">
            {t('initiateCallForm.autoFilledNote')}
          </p>
        </div>

        {/* Outbound Channel */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">
            {t('initiateCallForm.outboundChannelLabel')}
          </label>
          <select
            value={formData.trunkId}
            onChange={(e) => setFormData({ ...formData, trunkId: e.target.value })}
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">{t('initiateCallForm.autoTrunkOption')}</option>
            {sipTrunks && sipTrunks.length > 0 ? (
              sipTrunks.map((trunk) => (
                <option key={trunk.id} value={trunk.id}>
                  {trunk.name} ({trunk.trunk_type}{trunk.enabled ? '' : ` — ${t('initiateCallForm.disabledSuffix')}`})
                </option>
              ))
            ) : (
              <option disabled>{t('initiateCallForm.noTrunksAvailable')}</option>
            )}
          </select>
        </div>
      </div>

      {/* SIP Account Info */}
      {sipAccounts && sipAccounts.length > 0 && (
        <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">{t('initiateCallForm.availableSipAccounts')}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sipAccounts.map((account) => (
              <div key={account.id} className="flex items-center gap-2 p-2 bg-slate-800 rounded border border-slate-600">
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">{account.name}</p>
                  <p className="text-xs text-gray-400">{account.extension}</p>
                </div>
                <div className={`px-2 py-1 rounded text-xs font-medium ${
                  account.enabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                }`}>
                  {account.enabled ? t('initiateCallForm.active') : t('initiateCallForm.inactive')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
      >
        {loading ? t('initiateCallForm.initiatingCall') : t('initiateCallForm.initiateCall')}
      </button>
    </form>
  );
}
