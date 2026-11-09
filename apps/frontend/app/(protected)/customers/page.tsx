'use client';

import { useEffect, useState } from 'react';
import { useCustomersPage } from '@/hooks/useCallbot';
import AddCustomerForm from '@/components/AddCustomerForm';
import callbotApi from '@/lib/callbot-api';
import { useLanguage } from '@/lib/language';
import type { ArzoomTerms, Customer } from '@/types/callbot';

// Two column sets: ARZOOM leasing applications (default) and the PKS/collections template
// the team keeps for later credit and debt-collection work.
type CustomerView = 'arzoom' | 'pks';
const VIEW_KEY = 'robocall.customers.view';

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
  const [view, setView] = useState<CustomerView>('arzoom');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === 'arzoom' || saved === 'pks') setView(saved);
    } catch {
      // storage unavailable: keep the default view
    }
  }, []);
  const changeView = (next: CustomerView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // ignore
    }
  };
  const { customers, total, page, pageSize, pageCount, setPage, loading, error, refetch } = useCustomersPage(
    50,
    view === 'arzoom' ? 'arzoom' : 'other'
  );

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

  // The PKS/collections template: every column of the old customer list, unchanged.
  const pksColumns: Array<{ key: string; label: string; render: (customer: Customer) => React.ReactNode }> = [
    { key: 'id', label: t('customers.columns.id'), render: (customer: Customer) => formatValue(customer.id) },
    { key: 'name', label: t('customers.columns.name'), render: (customer: Customer) => formatValue(customer.name) },
    { key: 'surname', label: t('customers.columns.surname'), render: (customer: Customer) => formatValue(customer.surname) },
    { key: 'fatherName', label: t('customers.columns.fatherName'), render: (customer: Customer) => formatValue((customer as any).fatherName ?? (customer as any).father_name) },
    { key: 'phone', label: t('customers.columns.phone'), render: (customer: Customer) => formatValue(customer.phone) },
    { key: 'mobilePhone', label: t('customers.columns.mobilePhone'), render: (customer: Customer) => formatValue((customer as any).mobilePhone ?? (customer as any).mobile_phone) },
    { key: 'debtAmount', label: t('customers.columns.debtAmount'), render: (customer: Customer) => formatValue((customer as any).debtAmount ?? (customer as any).debt_amount) },
    { key: 'overdueDays', label: t('customers.columns.overdueDays'), render: (customer: Customer) => formatValue((customer as any).overdueDays ?? (customer as any).overdue_days) },
    { key: 'daysDue', label: t('customers.columns.daysDue'), render: (customer: Customer) => formatValue((customer as any).daysDue ?? (customer as any).days_due) },
    { key: 'organization', label: t('customers.columns.organization'), render: (customer: Customer) => formatValue((customer as any).organization) },
    { key: 'contractNo', label: t('customers.columns.contractNo'), render: (customer: Customer) => formatValue((customer as any).contractNo ?? (customer as any).contract_no) },
    { key: 'sourceFullName', label: t('customers.columns.sourceFullName'), render: (customer: Customer) => formatValue((customer as any).sourceFullName ?? (customer as any).source_full_name) },
    { key: 'fin', label: t('customers.columns.fin'), render: (customer: Customer) => formatValue((customer as any).fin) },
    { key: 'monthlyPayment', label: t('customers.columns.monthlyPayment'), render: (customer: Customer) => formatValue((customer as any).monthlyPayment ?? (customer as any).monthly_payment) },
    { key: 'employeeCode', label: t('customers.columns.employeeCode'), render: (customer: Customer) => formatValue((customer as any).employeeCode ?? (customer as any).employee_code) },
    { key: 'reference', label: t('customers.columns.reference'), render: (customer: Customer) => formatValue((customer as any).reference) },
    { key: 'branch', label: t('customers.columns.branch'), render: (customer: Customer) => formatValue((customer as any).branch) },
    { key: 'category', label: t('customers.columns.category'), render: (customer: Customer) => formatValue((customer as any).category) },
    { key: 'pksStatus', label: t('customers.columns.pksStatus'), render: (customer: Customer) => formatValue((customer as any).pksStatus ?? (customer as any).pks_status) },
    { key: 'pksComment', label: t('customers.columns.pksComment'), render: (customer: Customer) => formatValue((customer as any).pksComment ?? (customer as any).pks_comment) },
    { key: 'commentTemplate', label: t('customers.columns.commentTemplate'), render: (customer: Customer) => formatValue((customer as any).commentTemplateName ?? (customer as any).comment_template_name) },
    { key: 'statusCategory', label: t('customers.columns.statusCategory'), render: (customer: Customer) => formatValue((customer as any).pksStatusCategory ?? (customer as any).pks_status_category) },
    { key: 'activeContracts', label: t('customers.columns.activeContracts'), render: (customer: Customer) => formatValue((customer as any).activeContractCount ?? (customer as any).active_contract_count) },
    { key: 'last3PaymentDates', label: t('customers.columns.last3PaymentDates'), render: (customer: Customer) => formatValue((customer as any).last3PaymentDates ?? (customer as any).last_3_payment_dates) },
    { key: 'last3PaymentAmounts', label: t('customers.columns.last3PaymentAmounts'), render: (customer: Customer) => formatValue((customer as any).last3PaymentAmounts ?? (customer as any).last_3_payment_amounts) },
    { key: 'totalPaidLast90Days', label: t('customers.columns.totalPaidLast90Days'), render: (customer: Customer) => formatValue((customer as any).totalPaidLast90Days ?? (customer as any).total_paid_last_90_days) },
    { key: 'keptPromises90d', label: t('customers.columns.keptPromises90d'), render: (customer: Customer) => formatValue((customer as any).keptPromiseCount90d ?? (customer as any).kept_promise_count_90d) },
    { key: 'brokenPromises90d', label: t('customers.columns.brokenPromises90d'), render: (customer: Customer) => formatValue((customer as any).brokenPromiseCount90d ?? (customer as any).broken_promise_count_90d) },
    { key: 'collectorOrganization', label: t('customers.columns.collectorOrganization'), render: (customer: Customer) => formatValue((customer as any).collectorOrganization ?? (customer as any).collector_organization) },
    { key: 'sourceOrganization', label: t('customers.columns.sourceOrganization'), render: (customer: Customer) => formatValue((customer as any).sourceOrganization ?? (customer as any).source_organization) },
    { key: 'lastPaymentDate', label: t('customers.columns.lastPaymentDate'), render: (customer: Customer) => formatValue((customer as any).lastPaymentDate ?? (customer as any).last_payment_date) },
    { key: 'lastPaymentAmount', label: t('customers.columns.lastPaymentAmount'), render: (customer: Customer) => formatValue((customer as any).lastPaymentAmount ?? (customer as any).last_payment_amount) },
    { key: 'sourceSystem', label: t('customers.columns.sourceSystem'), render: (customer: Customer) => formatValue((customer as any).sourceSystem ?? (customer as any).source_system) },
    { key: 'importedAt', label: t('customers.columns.importedAt'), render: (customer: Customer) => formatDate((customer as any).importedAt ?? (customer as any).imported_at) },
    { key: 'lastSyncedAt', label: t('customers.columns.lastSyncedAt'), render: (customer: Customer) => formatDate((customer as any).lastSyncedAt ?? (customer as any).last_synced_at) },
    { key: 'createdAt', label: t('customers.columns.createdAt'), render: (customer: Customer) => formatDate((customer as any).createdAt ?? (customer as any).created_at) },
  ];

  const money = (v: unknown) =>
    v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? '-' : `${Number(v).toLocaleString()} AZN`;
  const termsText = (terms?: ArzoomTerms | null) => {
    if (!terms) return '-';
    const parts = [
      terms.down_payment != null ? `${t('customers.arzoom.down')} ${money(terms.down_payment)}${terms.down_payment_pct != null ? ` (${terms.down_payment_pct}%)` : ''}` : null,
      terms.months != null ? `${terms.months} ${t('customers.arzoom.months')}` : null,
      terms.monthly_payment != null ? `${money(terms.monthly_payment)}/${t('customers.arzoom.perMonth')}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : '-';
  };
  const statusTone: Record<string, string> = {
    review: 'bg-slate-600/40 text-gray-300',
    info: 'bg-amber-500/20 text-amber-300',
    offer: 'bg-blue-500/20 text-blue-300',
    accepted: 'bg-green-500/20 text-green-300',
    rejected: 'bg-red-500/20 text-red-300',
    declined: 'bg-red-500/20 text-red-300',
    cancelled: 'bg-slate-600/40 text-gray-400',
    deleted: 'bg-slate-600/40 text-gray-500',
  };

  // ARZOOM applications. Reuses the template's Telefon, FIN, İstinad, Mənbə Təşkilatı,
  // Mənbə Sistemi and date columns; the rest comes from the stored application.
  const arzoomColumns: Array<{ key: string; label: string; render: (customer: Customer) => React.ReactNode }> = [
    { key: 'id', label: t('customers.columns.id'), render: (c) => formatValue(c.id) },
    { key: 'application', label: t('customers.arzoom.application'), render: (c) => formatValue(c.arzoomData?.id ?? c.contractNo) },
    { key: 'phone', label: t('customers.columns.phone'), render: (c) => formatValue(c.phone) },
    {
      key: 'status',
      label: t('customers.arzoom.status'),
      render: (c) => {
        const code = c.applicationStatus || c.arzoomData?.status || '';
        const label = code === 'deleted' ? t('customers.arzoom.deleted') : c.arzoomData?.status_label || code;
        return label ? (
          <span className={`inline-flex px-2 py-0.5 rounded text-[11px] whitespace-nowrap ${statusTone[code] || 'bg-slate-600/40 text-gray-300'}`}>{label}</span>
        ) : '-';
      },
    },
    { key: 'car', label: t('customers.arzoom.car'), render: (c) => formatValue([c.arzoomData?.brand, c.arzoomData?.model].filter(Boolean).join(' ')) },
    { key: 'carPrice', label: t('customers.arzoom.carPrice'), render: (c) => money(c.arzoomData?.car_price) },
    { key: 'terms', label: t('customers.arzoom.terms'), render: (c) => <span className="whitespace-nowrap">{termsText(c.arzoomData?.final_terms || c.arzoomData?.offer)}</span> },
    {
      key: 'note',
      label: t('customers.arzoom.note'),
      render: (c) => <span className="block max-w-xs truncate" title={c.commentTemplateName || ''}>{formatValue(c.commentTemplateName)}</span>,
    },
    { key: 'guarantor', label: t('customers.arzoom.guarantor'), render: (c) => (c.arzoomData?.guarantor == null ? '-' : c.arzoomData.guarantor ? t('customers.arzoom.yes') : t('customers.arzoom.no')) },
    { key: 'fin', label: t('customers.columns.fin'), render: (c) => formatValue(c.fin) },
    { key: 'reference', label: t('customers.columns.reference'), render: (c) => formatValue(c.reference) },
    { key: 'sourceOrganization', label: t('customers.columns.sourceOrganization'), render: (c) => formatValue(c.sourceOrganization) },
    {
      key: 'lastCall',
      label: t('customers.arzoom.lastCall'),
      render: (c) => <span className="block max-w-xs truncate" title={c.pksComment || ''}>{formatValue(c.pksStatus)}</span>,
    },
    { key: 'sourceSystem', label: t('customers.columns.sourceSystem'), render: () => 'ARZOOM' },
    { key: 'importedAt', label: t('customers.columns.importedAt'), render: (c) => formatDate(c.importedAt) },
    { key: 'lastSyncedAt', label: t('customers.columns.lastSyncedAt'), render: (c) => formatDate(c.lastSyncedAt) },
    { key: 'createdAt', label: t('customers.columns.createdAt'), render: (c) => formatDate(c.createdAt) },
  ];

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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['arzoom', 'pks'] as CustomerView[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => changeView(v)}
            className={`px-3 py-1.5 rounded-full border text-xs font-medium transition ${
              view === v ? 'border-blue-500 bg-blue-50 text-blue-300' : 'border-slate-600 text-gray-300 hover:bg-slate-700'
            }`}
          >
            {t(`customers.views.${v}`)}
          </button>
        ))}
        <span className="text-xs text-gray-500">{t(`customers.views.${view}Hint`)}</span>
      </div>

      {/* Destructive bulk tool: folded away by default so it doesn't lead the page. */}
      <details className="mb-4 rounded-lg border border-red-800/60 bg-red-950/20 p-4 group">
        <summary className="cursor-pointer list-none flex items-center justify-between text-sm font-semibold text-red-300">
          {t('customers.batchDeleteHeading')}
          <span className="text-xs text-gray-500 transition group-open:rotate-180">▾</span>
        </summary>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
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
      </details>

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
                  {(view === 'arzoom' ? arzoomColumns : pksColumns).map((col) => (
                    <th key={col.key} className="px-4 py-3 text-left font-semibold text-gray-300 whitespace-nowrap">{col.label}</th>
                  ))}
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('customers.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} className="border-b border-slate-700 hover:bg-slate-700/50 transition">
                    {(view === 'arzoom' ? arzoomColumns : pksColumns).map((col) => (
                      <td key={col.key} className="px-4 py-3 text-gray-400">{col.render(customer)}</td>
                    ))}
                    <td className="px-4 py-3 text-gray-400">
                      <button
                        onClick={() => deleteSingleCustomer(Number(customer.id), `${customer.name} ${customer.surname ?? ''}`.trim() || String(customer.contractNo || customer.phone || ''))}
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
