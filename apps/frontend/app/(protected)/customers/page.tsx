'use client';

import { useState } from 'react';
import { useCustomersPage } from '@/hooks/useCallbot';
import AddCustomerForm from '@/components/AddCustomerForm';
import callbotApi from '@/lib/callbot-api';
import { useLanguage } from '@/lib/language';

export default function CustomersPage() {
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchImportedDays, setBatchImportedDays] = useState('');
  const [batchOrganizations, setBatchOrganizations] = useState('');
  const [batchCampaignId, setBatchCampaignId] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { customers, total, page, pageSize, pageCount, setPage, loading, error, refetch } = useCustomersPage(50);

  const formatValue = (value: unknown): string => {
    if (value == null) return '-';
    const text = String(value).trim();
    return text ? text : '-';
  };

  const formatDate = (value: unknown): string => {
    if (!value) return '-';
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  };

  const deleteSingleCustomer = async (id: number, label: string) => {
    const confirmed = window.confirm(
      `${t('customers.confirmDeleteCustomerPrefix')} ${label} (ID ${id})? ${t('customers.confirmDeleteSuffix')}`
    );
    if (!confirmed) return;

    setActionMessage(null);
    setActionError(null);
    setDeletingId(id);
    try {
      const ok = await callbotApi.deleteCustomer(String(id));
      if (!ok) {
        setActionError(t('customers.deleteFailedError'));
        return;
      }
      setActionMessage(`${t('customers.customerLabel')} ${label} ${t('customers.deletedSuffix')}`);
      await refetch?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('customers.deleteFailedError'));
    } finally {
      setDeletingId(null);
    }
  };

  const deleteCustomersByFilters = async () => {
    const organizations = batchOrganizations
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const importedDays = batchImportedDays.trim() ? Number(batchImportedDays.trim()) : undefined;
    const campaignId = batchCampaignId.trim() ? Number(batchCampaignId.trim()) : undefined;

    if (importedDays == null && organizations.length === 0 && campaignId == null) {
      setActionError(t('customers.batchNoFilterError'));
      setActionMessage(null);
      return;
    }

    if (importedDays != null && (!Number.isInteger(importedDays) || importedDays <= 0)) {
      setActionError(t('customers.importedDaysInvalidError'));
      setActionMessage(null);
      return;
    }

    if (campaignId != null && (!Number.isInteger(campaignId) || campaignId <= 0)) {
      setActionError(t('customers.campaignIdInvalidError'));
      setActionMessage(null);
      return;
    }

    const confirmed = window.confirm(t('customers.confirmBatchDelete'));
    if (!confirmed) return;

    setBatchDeleting(true);
    setActionMessage(null);
    setActionError(null);
    try {
      const result = await callbotApi.deleteCustomersByFilters({
        importedDays,
        organizations,
        campaignId,
      });
      if (!result) {
        setActionError(t('customers.batchDeleteFailedError'));
        return;
      }
      setActionMessage(
        `${t('customers.batchResultMatched')} ${result.matchedCount}, ${t('customers.batchResultDeletedCustomers')} ${result.deletedCustomers}, ${t('customers.batchResultDeletedCampaignLinks')} ${result.deletedCampaignCalls}.`
      );
      await refetch?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('customers.batchDeleteFailedError'));
    } finally {
      setBatchDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-white mb-4">{t('customers.heading')}</h1>
        <div className="bg-slate-800 rounded-lg p-8 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-400">{t('customers.loading')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-white mb-4">{t('customers.heading')}</h1>
        <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 text-red-400">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-white">{t('customers.heading')}</h1>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-blue-600 text-[#fff] rounded hover:bg-blue-700 transition font-medium"
        >
          + {t('customers.addCustomer')}
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-red-800/60 bg-red-950/20 p-4">
        <h2 className="text-sm font-semibold text-red-300 mb-3">{t('customers.batchDeleteHeading')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('customers.importedDaysLabel')}</label>
            <input
              value={batchImportedDays}
              onChange={(e) => setBatchImportedDays(e.target.value)}
              placeholder={t('customers.importedDaysPlaceholder')}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('customers.campaignIdLabel')}</label>
            <input
              value={batchCampaignId}
              onChange={(e) => setBatchCampaignId(e.target.value)}
              placeholder={t('customers.campaignIdPlaceholder')}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-400 mb-1">{t('customers.organizationsLabel')}</label>
            <textarea
              value={batchOrganizations}
              onChange={(e) => setBatchOrganizations(e.target.value)}
              placeholder="Kollekta-Azpul, Kollekta-Ferrum"
              rows={2}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={deleteCustomersByFilters}
            disabled={batchDeleting}
            className="px-4 py-2 rounded bg-red-700 hover:bg-red-800 text-[#fff] disabled:opacity-60"
          >
            {batchDeleting ? t('customers.deleting') : t('customers.deleteByFiltersButton')}
          </button>
          <button
            onClick={() => {
              setBatchImportedDays('');
              setBatchOrganizations('');
              setBatchCampaignId('');
              setActionError(null);
              setActionMessage(null);
            }}
            className="px-4 py-2 rounded border border-slate-600 text-gray-300 hover:bg-slate-700"
          >
            {t('customers.clearFiltersButton')}
          </button>
        </div>
      </div>

      {actionError && (
        <div className="mb-4 rounded border border-red-700 bg-red-950/40 px-3 py-2 text-red-300 text-sm">
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div className="mb-4 rounded border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-emerald-200 text-sm">
          {actionMessage}
        </div>
      )}
      
      <div className="bg-slate-800 rounded-lg overflow-hidden">
        {customers.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            {t('customers.noCustomersFound')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-700 border-b border-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.id')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.name')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.surname')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.fatherName')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.phone')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.mobilePhone')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.debtAmount')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.overdueDays')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.daysDue')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.organization')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.contractNo')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.sourceFullName')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.fin')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.monthlyPayment')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.employeeCode')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.reference')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.branch')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.category')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.pksStatus')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.pksComment')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.commentTemplate')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.statusCategory')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.activeContracts')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.last3PaymentDates')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.last3PaymentAmounts')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.totalPaidLast90Days')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.keptPromises90d')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.brokenPromises90d')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.collectorOrganization')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.sourceOrganization')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.lastPaymentDate')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.lastPaymentAmount')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.sourceSystem')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.importedAt')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.lastSyncedAt')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.createdAt')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} className="border-b border-slate-700 hover:bg-slate-700/50 transition">
                    <td className="px-4 py-3 text-gray-400">{formatValue(customer.id)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue(customer.name)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue(customer.surname)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).fatherName ?? (customer as any).father_name)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue(customer.phone)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).mobilePhone ?? (customer as any).mobile_phone)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).debtAmount ?? (customer as any).debt_amount)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).overdueDays ?? (customer as any).overdue_days)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).daysDue ?? (customer as any).days_due)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).organization)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).contractNo ?? (customer as any).contract_no)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).sourceFullName ?? (customer as any).source_full_name)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).fin)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).monthlyPayment ?? (customer as any).monthly_payment)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).employeeCode ?? (customer as any).employee_code)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).reference)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).branch)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).category)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).pksStatus ?? (customer as any).pks_status)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).pksComment ?? (customer as any).pks_comment)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).commentTemplateName ?? (customer as any).comment_template_name)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).pksStatusCategory ?? (customer as any).pks_status_category)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).activeContractCount ?? (customer as any).active_contract_count)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).last3PaymentDates ?? (customer as any).last_3_payment_dates)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).last3PaymentAmounts ?? (customer as any).last_3_payment_amounts)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).totalPaidLast90Days ?? (customer as any).total_paid_last_90_days)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).keptPromiseCount90d ?? (customer as any).kept_promise_count_90d)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).brokenPromiseCount90d ?? (customer as any).broken_promise_count_90d)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).collectorOrganization ?? (customer as any).collector_organization)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).sourceOrganization ?? (customer as any).source_organization)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).lastPaymentDate ?? (customer as any).last_payment_date)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).lastPaymentAmount ?? (customer as any).last_payment_amount)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatValue((customer as any).sourceSystem ?? (customer as any).source_system)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatDate((customer as any).importedAt ?? (customer as any).imported_at)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatDate((customer as any).lastSyncedAt ?? (customer as any).last_synced_at)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatDate((customer as any).createdAt ?? (customer as any).created_at)}</td>
                    <td className="px-4 py-3 text-gray-400">
                      <button
                        onClick={() => deleteSingleCustomer(Number(customer.id), `${customer.name} ${customer.surname ?? ''}`.trim())}
                        disabled={deletingId === Number(customer.id)}
                        className="px-2 py-1 rounded border border-red-700 text-red-300 hover:bg-red-900/40 disabled:opacity-60"
                      >
                        {deletingId === Number(customer.id) ? t('customers.deleting') : t('customers.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
          <span>{t('customers.totalLabel')}: {total}</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1 || loading}
              className="px-3 py-1.5 rounded border border-slate-600 text-gray-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('customers.previousPage')}
            </button>
            <span>{t('customers.pageLabel')} {page} {t('customers.ofLabel')} {pageCount}</span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= pageCount || loading}
              className="px-3 py-1.5 rounded border border-slate-600 text-gray-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('customers.nextPage')}
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <AddCustomerForm
          onSuccess={() => {
            setShowForm(false);
            refetch?.();
          }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
