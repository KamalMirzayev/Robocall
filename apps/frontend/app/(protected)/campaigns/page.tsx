'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CampaignForm, type CampaignInput, type CampaignStatus, type CampaignWeekday } from './components/campaign-form';
import { useCampaignPksImport } from '@/hooks/useCallbot';
import callbotApi from '@/lib/callbot-api';
import { useLanguage } from '@/lib/language';
import SearchableSelect from '@/components/SearchableSelect';

interface CampaignRow extends CampaignInput {
  id: number;
  totalCustomers: number;
  completedCalls: number;
  successfulCalls: number;
  createdAt: string;
  updatedAt?: string;
}

type FilterOperator = '=' | '!=' | '>' | '<' | '>=' | '<=';

interface FilterCondition {
  id: number;
  column: string;
  operator: FilterOperator;
  value: string;
}

interface GroupedFilter {
  column: string;
  operator: FilterOperator;
  values: string[];
}

const filterableColumns = [
  'organization',
  'muqavile_no',
  'musterinin_asa',
  'fin',
  'comment_template_name',
  'status_category',
  'odenis_ayliq',
  'emekdas',
  'rehber',
  'magaza',
  'kateqoriya',
  'status',
  'comment',
  'last_payment_date',
  'last_payment_amount',
  'mobile_phone',
] as const;

function statusColor(status: CampaignStatus): string {
  if (status === 'active') return 'bg-green-500/20 text-green-300 border-green-700';
  if (status === 'paused') return 'bg-yellow-500/20 text-yellow-300 border-yellow-700';
  if (status === 'completed') return 'bg-blue-500/20 text-blue-300 border-blue-700';
  if (status === 'cancelled') return 'bg-red-500/20 text-red-300 border-red-700';
  return 'bg-slate-500/20 text-slate-300 border-slate-600';
}

function scheduleLabel(
  weekdays: CampaignWeekday[],
  start: string,
  end: string,
  dayLabels: Record<CampaignWeekday, string>,
  noDaysSelectedText: string
): string {
  if (!weekdays.length) return `${noDaysSelectedText} ${start}-${end}`;
  const ordered: CampaignWeekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const labels = ordered.filter((day) => weekdays.includes(day)).map((day) => dayLabels[day]);
  return `${labels.join(', ')} | ${start}-${end}`;
}

export default function CampaignsPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const pksImport = useCampaignPksImport();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importCampaign, setImportCampaign] = useState<CampaignRow | null>(null);
  const [importMode, setImportMode] = useState<'pks' | 'database'>('pks');
  const [conditions, setConditions] = useState<FilterCondition[]>([
    { id: 1, column: 'status', operator: '=', value: 'Инкассо' },
  ]);
  const [filterMode, setFilterMode] = useState<'and' | 'or' | 'grouped'>('grouped');
  const [availableCustomers, setAvailableCustomers] = useState<Array<{ id: number; name: string; surname: string; contractNo?: string }>>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomers, setSelectedCustomers] = useState<Set<number>>(new Set());
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const customerSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [importingDatabase, setImportingDatabase] = useState(false);
  const [databaseImportResult, setDatabaseImportResult] = useState<any>(null);
  const [distinctValues, setDistinctValues] = useState<Record<string, string[]>>({});
  const [loadingColumn, setLoadingColumn] = useState<string | null>(null);

  const weekdayLabels: Record<CampaignWeekday, string> = {
    mon: t('campaigns.days.mon'),
    tue: t('campaigns.days.tue'),
    wed: t('campaigns.days.wed'),
    thu: t('campaigns.days.thu'),
    fri: t('campaigns.days.fri'),
    sat: t('campaigns.days.sat'),
    sun: t('campaigns.days.sun'),
  };

  const statusLabels: Record<CampaignStatus, string> = {
    draft: t('campaigns.status.draft'),
    active: t('campaigns.status.active'),
    paused: t('campaigns.status.paused'),
    completed: t('campaigns.status.completed'),
    cancelled: t('campaigns.status.cancelled'),
  };

  // Load campaigns from backend on mount
  useEffect(() => {
    loadCampaigns();
  }, []);

  const filterColumns = useMemo(() => conditions.map((c) => c.column), [conditions]);

  // Preload distinct values for visible filter columns when import modal opens
  useEffect(() => {
    if (!importOpen) return;
    for (const col of filterColumns) {
      if (col && !distinctValues[col] && loadingColumn !== col) {
        fetchDistinctValues(col);
      }
    }
  }, [importOpen, filterColumns]);

  const loadCampaigns = async () => {
    setLoading(true);
    try {
      const data = await callbotApi.getCampaigns();
      setCampaigns(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load campaigns:', err);
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter((c) => {
      return (
        c.name.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.status.toLowerCase().includes(q)
      );
    });
  }, [campaigns, search]);

  const editingCampaign = useMemo(() => {
    if (editingId == null) return undefined;
    const c = campaigns.find((x) => x.id === editingId);
    if (!c) return undefined;
    return {
      name: c.name,
      description: c.description || '',
      status: c.status,
      maxAttempts: c.maxAttempts,
      retryIntervalHours: c.retryIntervalHours,
      orderByMonthlyPaymentDesc: Boolean(c.orderByMonthlyPaymentDesc),
      skipNextDayAfterSuccess: Boolean(c.skipNextDayAfterSuccess),
      dailyCustomerRefresh: Boolean(c.dailyCustomerRefresh),
      runWeekdays: c.runWeekdays,
      runWindowStart: c.runWindowStart,
      runWindowEnd: c.runWindowEnd,
      runStartDate: c.runStartDate,
      runEndDate: c.runEndDate,
      agentId: c.agentId,
      trunkId: c.trunkId,
      trunkIds: c.trunkIds || [],
      baseTemplateId: c.baseTemplateId,
    } satisfies CampaignInput;
  }, [campaigns, editingId]);

  const saveCampaign = async (value: CampaignInput) => {
    setSubmitting(true);
    try {
      if (editingId != null) {
        await callbotApi.updateCampaign(editingId, value);
        await loadCampaigns();
      } else {
        await callbotApi.createCampaign(value);
        await loadCampaigns();
      }
      setFormOpen(false);
      setEditingId(null);
    } catch (err) {
      console.error('Failed to save campaign:', err);
      alert(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const startCampaign = async (campaignId: number) => {
    try {
      const campaign = campaigns.find((c) => c.id === campaignId);
      if (!campaign) return;
      if (campaign.status === 'completed' || campaign.status === 'cancelled') return;
      await callbotApi.updateCampaign(campaignId, { status: 'active' });
      await loadCampaigns();
    } catch (err) {
      console.error('Failed to start campaign:', err);
      alert(String(err));
    }
  };

  const pauseCampaign = async (campaignId: number) => {
    try {
      const campaign = campaigns.find((c) => c.id === campaignId);
      if (!campaign || campaign.status !== 'active') return;
      await callbotApi.updateCampaign(campaignId, { status: 'paused' });
      await loadCampaigns();
    } catch (err) {
      console.error('Failed to pause campaign:', err);
      alert(String(err));
    }
  };

  const deleteCampaign = async (campaignId: number) => {
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) return;
    const confirmed = window.confirm(`${t('campaigns.deleteConfirmPrefix')} "${campaign.name}"${t('campaigns.deleteConfirmSuffix')}`);
    if (!confirmed) return;
    try {
      await callbotApi.deleteCampaign(campaignId);
      await loadCampaigns();
      if (editingId === campaignId) {
        setEditingId(null);
        setFormOpen(false);
      }
    } catch (err) {
      console.error('Failed to delete campaign:', err);
      alert(String(err));
    }
  };

  const builtFilters = useMemo(() => {
    return conditions.reduce<Record<string, string>>((acc, cond) => {
      const value = cond.value.trim();
      if (!value) return acc;
      if (cond.operator === '=') {
        acc[cond.column] = value;
      } else {
        acc[`${cond.column}${cond.operator}${value}`] = '';
      }
      return acc;
    }, {});
  }, [conditions]);

  const groupedFilters = useMemo<GroupedFilter[]>(() => {
    const groups = new Map<string, GroupedFilter>();
    for (const cond of conditions) {
      const value = cond.value.trim();
      if (!value) continue;
      const key = `${cond.column}::${cond.operator}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, { column: cond.column, operator: cond.operator, values: [value] });
        continue;
      }
      if (!existing.values.includes(value)) {
        existing.values.push(value);
      }
    }
    return Array.from(groups.values());
  }, [conditions]);

  const requestFilters = filterMode === 'grouped' ? {} : builtFilters;
  const requestGroupedFilters = filterMode === 'grouped' ? groupedFilters : undefined;

  const openImportModal = (campaign: CampaignRow) => {
    setImportCampaign(campaign);
    setImportOpen(true);
    setImportMode('pks');
    setSelectedCustomers(new Set());
    setDatabaseImportResult(null);
    pksImport.clear();
    // Resume polling if there's an active job from a previous session
    const savedJobId = sessionStorage.getItem(`pksImportActive_${campaign.id}`);
    if (savedJobId) {
      pksImport.resumeJob(String(campaign.id), Number(savedJobId));
    }
  };

  const closeImportModal = () => {
    setImportOpen(false);
    setImportCampaign(null);
    setImportMode('pks');
    setSelectedCustomers(new Set());
    setDatabaseImportResult(null);
    pksImport.stopPolling();
    // Keep job/resume state in sessionStorage for when the modal reopens
    if (pksImport.job?.jobId && pksImport.jobActive) {
      sessionStorage.setItem(`pksImportActive_${importCampaign?.id}`, String(pksImport.job.jobId));
    }
  };

  const fetchDistinctValues = async (column: string) => {
    if (distinctValues[column] || loadingColumn) return;
    setLoadingColumn(column);
    try {
      const values = await callbotApi.getPksDistinctValues(column);
      setDistinctValues((prev) => ({ ...prev, [column]: values }));
    } catch {
      // swallow — dropdown will show empty options
    } finally {
      setLoadingColumn(null);
    }
  };

  // Search-scoped instead of fetching the full ~33k-row customer table: this list used to
  // load every customer as a checkbox row (getCustomers()) whenever "database" import mode
  // was opened, regardless of how many the admin actually wanted to hand-pick.
  const loadAvailableCustomers = async (search: string) => {
    if (!importCampaign || search.trim().length < 2) {
      setAvailableCustomers([]);
      return;
    }
    setLoadingCustomers(true);
    try {
      const result = await callbotApi.getCustomersPage({ page: 1, pageSize: 100, search });
      setAvailableCustomers(
        result.data.map((c: any) => ({
          id: c.id,
          name: c.name,
          surname: c.surname,
          contractNo: c.contractNo,
        }))
      );
    } catch (err) {
      console.error('Failed to load customers:', err);
      setAvailableCustomers([]);
    } finally {
      setLoadingCustomers(false);
    }
  };

  useEffect(() => {
    if (importMode !== 'database') return;
    if (customerSearchDebounceRef.current) clearTimeout(customerSearchDebounceRef.current);
    customerSearchDebounceRef.current = setTimeout(() => {
      loadAvailableCustomers(customerSearch);
    }, 300);
    return () => {
      if (customerSearchDebounceRef.current) clearTimeout(customerSearchDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerSearch, importMode, importCampaign]);

  const runDatabaseImport = async () => {
    if (!importCampaign || selectedCustomers.size === 0) {
      alert(t('campaigns.import.selectAtLeastOneCustomer'));
      return;
    }

    setImportingDatabase(true);
    try {
      const result = await callbotApi.executeCampaignDatabaseImport(
        String(importCampaign.id),
        Array.from(selectedCustomers)
      );
      if (result) {
        setDatabaseImportResult(result);
        await loadCampaigns();
      }
    } catch (err) {
      console.error('Failed to import customers from database:', err);
      alert(String(err));
    } finally {
      setImportingDatabase(false);
    }
  };

  const addCondition = () => {
    setConditions((prev) => [
      ...prev,
      {
        id: (prev[prev.length - 1]?.id ?? 0) + 1,
        column: 'status',
        operator: '=',
        value: '',
      },
    ]);
  };

  const runPreview = async () => {
    if (!importCampaign) return;
    await pksImport.runPreview(String(importCampaign.id), {
      filters: requestFilters,
      filterMode,
      groupedFilters: requestGroupedFilters,
      pageSize: 500,
      sampleSize: 20,
      campaign: {
        name: importCampaign.name,
        description: importCampaign.description,
        status: importCampaign.status,
        maxAttempts: importCampaign.maxAttempts,
        retryIntervalHours: importCampaign.retryIntervalHours,
        orderByMonthlyPaymentDesc: importCampaign.orderByMonthlyPaymentDesc,
        skipNextDayAfterSuccess: importCampaign.skipNextDayAfterSuccess,
        runWeekdays: importCampaign.runWeekdays,
        runWindowStart: importCampaign.runWindowStart,
        runWindowEnd: importCampaign.runWindowEnd,
      },
    });
  };

  // Refresh campaigns when an import job completes
  useEffect(() => {
    if (pksImport.result && !pksImport.isPolling) {
      loadCampaigns();
      // Clear the sessionStorage recovery key now that the job is done
      if (importCampaign) {
        sessionStorage.removeItem(`pksImportActive_${importCampaign.id}`);
      }
    }
  }, [pksImport.result, pksImport.isPolling]);

  const runImport = async () => {
    if (!importCampaign) return;
    if (!pksImport.preview) return;

    const start = await pksImport.runExecute(String(importCampaign.id), {
      filters: requestFilters,
      filterMode,
      groupedFilters: requestGroupedFilters,
      pageSize: 500,
      totalPages: pksImport.preview?.totalPages ?? undefined,
      previewConfirmed: true,
      campaign: {
        name: importCampaign.name,
        description: importCampaign.description,
        status: importCampaign.status,
        maxAttempts: importCampaign.maxAttempts,
        retryIntervalHours: importCampaign.retryIntervalHours,
        orderByMonthlyPaymentDesc: importCampaign.orderByMonthlyPaymentDesc,
        skipNextDayAfterSuccess: importCampaign.skipNextDayAfterSuccess,
        runWeekdays: importCampaign.runWeekdays,
        runWindowStart: importCampaign.runWindowStart,
        runWindowEnd: importCampaign.runWindowEnd,
      },
    });

    if (start && 'jobId' in start) {
      sessionStorage.setItem(`pksImportActive_${importCampaign.id}`, String(start.jobId));
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-gray-400">{t('campaigns.loadingCampaigns')}</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">{t('campaigns.heading')}</h1>
          <p className="text-gray-400 mt-1">{t('campaigns.subheading')}</p>
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setFormOpen(true);
          }}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-[#fff]"
        >
          {t('campaigns.createButton')}
        </button>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('campaigns.searchPlaceholder')}
          className="w-full md:w-96 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
        />
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-gray-300">
            <tr>
              <th className="text-left px-4 py-3">{t('campaigns.table.name')}</th>
              <th className="text-left px-4 py-3">{t('campaigns.table.status')}</th>
              <th className="text-left px-4 py-3">{t('campaigns.table.progress')}</th>
              <th className="text-left px-4 py-3">{t('campaigns.table.successRate')}</th>
              <th className="text-left px-4 py-3">{t('campaigns.table.created')}</th>
              <th className="text-right px-4 py-3">{t('campaigns.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((campaign) => {
              const progress = campaign.totalCustomers > 0
                ? Math.round((campaign.completedCalls / campaign.totalCustomers) * 100)
                : 0;
              const successRate = campaign.completedCalls > 0
                ? Math.round((campaign.successfulCalls / campaign.completedCalls) * 100)
                : 0;

              return (
                <tr
                  key={campaign.id}
                  className="border-t border-slate-700 hover:bg-slate-700/40 cursor-pointer"
                  onClick={() => router.push(`/campaigns/${campaign.id}`)}
                >
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{campaign.name}</p>
                    <p className="text-gray-400 truncate max-w-md">{campaign.description}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {scheduleLabel(
                        campaign.runWeekdays,
                        campaign.runWindowStart,
                        campaign.runWindowEnd,
                        weekdayLabels,
                        t('campaigns.noDaysSelectedPrefix')
                      )}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-1 rounded border text-xs ${statusColor(campaign.status)}`}>
                      {statusLabels[campaign.status] ?? campaign.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{campaign.completedCalls}/{campaign.totalCustomers} ({progress}%)</td>
                  <td className="px-4 py-3 text-gray-300">{successRate}%</td>
                  <td className="px-4 py-3 text-gray-300">{new Date(campaign.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startCampaign(campaign.id);
                        }}
                        disabled={campaign.status === 'active' || campaign.status === 'completed' || campaign.status === 'cancelled'}
                        className="px-3 py-1.5 rounded border border-emerald-600 text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50 disabled:hover:bg-transparent"
                      >
                        {t('campaigns.actions.start')}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          pauseCampaign(campaign.id);
                        }}
                        disabled={campaign.status !== 'active'}
                        className="px-3 py-1.5 rounded border border-amber-600 text-amber-300 hover:bg-amber-900/40 disabled:opacity-50 disabled:hover:bg-transparent"
                      >
                        {t('campaigns.actions.pause')}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openImportModal(campaign);
                        }}
                        className="px-3 py-1.5 rounded border border-blue-600 text-blue-300 hover:bg-blue-900/40"
                      >
                        {t('campaigns.actions.import')}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(campaign.id);
                          setFormOpen(true);
                        }}
                        className="px-3 py-1.5 rounded border border-slate-600 text-gray-300 hover:bg-slate-700"
                      >
                        {t('campaigns.actions.edit')}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCampaign(campaign.id);
                        }}
                        className="px-3 py-1.5 rounded border border-red-700 text-red-300 hover:bg-red-900/40"
                      >
                        {t('campaigns.actions.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  {campaigns.length === 0 ? t('campaigns.emptyNoCampaigns') : t('campaigns.emptyNoResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-800 border border-slate-700 rounded-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-semibold text-white mb-4">
              {editingId != null ? t('campaigns.form.editHeading') : t('campaigns.createButton')}
            </h2>
            <CampaignForm
              initialValue={editingCampaign}
              submitting={submitting}
              onSubmit={saveCampaign}
              onCancel={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
            />
          </div>
        </div>
      )}

      {importOpen && importCampaign && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl bg-slate-800 border border-slate-700 rounded-lg p-6 space-y-4 max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">{t('campaigns.import.heading')}</h2>
                <p className="text-sm text-gray-400 mt-1">
                  {t('campaigns.import.campaignLabel')} {importCampaign.name} (#{importCampaign.id})
                </p>
              </div>
              <button
                onClick={closeImportModal}
                className="px-3 py-2 rounded border border-slate-600 text-gray-300 hover:bg-slate-700"
              >
                {t('campaigns.import.closeButton')}
              </button>
            </div>

            <div className="flex gap-2 border-b border-slate-700">
              <button
                onClick={() => {
                  setImportMode('pks');
                  setDatabaseImportResult(null);
                }}
                className={`px-4 py-2 font-medium ${
                  importMode === 'pks'
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {t('campaigns.import.pksTab')}
              </button>
              <button
                onClick={() => {
                  setImportMode('database');
                  setDatabaseImportResult(null);
                }}
                className={`px-4 py-2 font-medium ${
                  importMode === 'database'
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {t('campaigns.import.databaseTab')}
              </button>
            </div>

            {importMode === 'pks' && (
              <>
            <div className="space-y-3 bg-slate-900/40 border border-slate-700 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-300">{t('campaigns.import.pksFiltersLabel')}</p>
                <button
                  onClick={addCondition}
                  className="px-2 py-1 rounded border border-slate-600 text-xs text-gray-300 hover:bg-slate-700"
                >
                  {t('campaigns.import.addConditionButton')}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('campaigns.import.combineConditionsLabel')}</label>
                  <select
                    value={filterMode}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next === 'and' || next === 'or' || next === 'grouped') {
                        setFilterMode(next);
                        return;
                      }
                      setFilterMode('grouped');
                    }}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                  >
                    <option value="grouped">{t('campaigns.import.filterModeGrouped')}</option>
                    <option value="or">{t('campaigns.import.filterModeOr')}</option>
                    <option value="and">{t('campaigns.import.filterModeAnd')}</option>
                  </select>
                </div>
              </div>

              {conditions.map((cond) => (
                <div key={cond.id} className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <select
                    value={cond.column}
                    onChange={(e) => {
                      setConditions((prev) => prev.map((row) => (
                        row.id === cond.id ? { ...row, column: e.target.value } : row
                      )));
                    }}
                    className="md:col-span-4 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                  >
                    {filterableColumns.map((column) => (
                      <option key={column} value={column}>{column}</option>
                    ))}
                  </select>

                  <select
                    value={cond.operator}
                    onChange={(e) => {
                      setConditions((prev) => prev.map((row) => (
                        row.id === cond.id ? { ...row, operator: e.target.value as FilterOperator } : row
                      )));
                    }}
                    className="md:col-span-2 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                  >
                    <option value="=">=</option>
                    <option value=">=">&gt;=</option>
                    <option value="<=">&lt;=</option>
                    <option value=">">&gt;</option>
                    <option value="<">&lt;</option>
                    <option value="!=">!=</option>
                  </select>

                  <SearchableSelect
                    value={cond.value}
                    onChange={(val) => {
                      setConditions((prev) => prev.map((row) => (
                        row.id === cond.id ? { ...row, value: val } : row
                      )));
                    }}
                    options={distinctValues[cond.column] || []}
                    loading={loadingColumn === cond.column}
                    placeholder={t('campaigns.import.filterValuePlaceholder')}
                    className="md:col-span-5"
                  />

                  <button
                    onClick={() => {
                      setConditions((prev) => prev.length > 1 ? prev.filter((row) => row.id !== cond.id) : prev);
                    }}
                    aria-label={t('campaigns.import.removeConditionAriaLabel')}
                    className="md:col-span-1 px-2 py-2 rounded border border-slate-600 text-gray-300 hover:bg-slate-700"
                  >
                    X
                  </button>
                </div>
              ))}

              <div className="flex items-end gap-2">
                <button
                  onClick={runPreview}
                  disabled={pksImport.loading || pksImport.isPolling}
                  className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-[#fff] disabled:opacity-60"
                >
                  {t('campaigns.import.previewButton')}
                </button>
                <button
                  onClick={runImport}
                  disabled={pksImport.loading || pksImport.isPolling || !pksImport.preview}
                  className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-[#fff] disabled:opacity-60"
                >
                    {pksImport.isPolling ? t('campaigns.import.importingLabel') : t('campaigns.import.executeImportButton')}
                </button>
              </div>
            </div>

            {/* Job progress display */}
            {pksImport.jobActive && pksImport.job && (
              <div className="rounded border border-blue-700 bg-blue-950/30 p-4 space-y-2">
                <p className="text-blue-200 text-sm font-semibold">{t('campaigns.import.importProgressTitle')}</p>
                <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                    style={{
                      width: pksImport.job.totalPages && pksImport.job.totalPages > 0
                        ? `${Math.min(100, Math.round((pksImport.job.pagesFetched / pksImport.job.totalPages) * 100))}%`
                        : pksImport.job.rowsFetched > 0 ? '50%' : '5%',
                    }}
                  />
                </div>
                <p className="text-blue-300 text-xs">
                  {pksImport.job.status === 'queued'
                    ? t('campaigns.import.jobQueuedLabel')
                    : pksImport.job.totalPages && pksImport.job.pagesFetched >= pksImport.job.totalPages && pksImport.job.status === 'running'
                      ? t('campaigns.import.importFinalizingLabel')
                          .replace('{rows}', String(pksImport.job.rowsFetched))
                      : pksImport.job.totalPages
                        ? t('campaigns.import.importProgressPages')
                            .replace('{done}', String(pksImport.job.pagesFetched))
                            .replace('{total}', String(pksImport.job.totalPages))
                            .replace('{rows}', String(pksImport.job.rowsFetched))
                        : t('campaigns.import.jobRunningRowsLabel')
                            .replace('{count}', String(pksImport.job.rowsFetched))}
                </p>
                {(pksImport.job.customersCreated > 0 || pksImport.job.customersUpdated > 0 || pksImport.job.attachedRows > 0) && (
                  <div className="flex gap-3 text-xs text-blue-300">
                    {pksImport.job.customersUpdated > 0 && <span>{pksImport.job.customersUpdated} {t('campaigns.import.jobUpdatedLabel')}</span>}
                    {pksImport.job.customersCreated > 0 && <span>{pksImport.job.customersCreated} {t('campaigns.import.jobCreatedLabel')}</span>}
                    {pksImport.job.attachedRows > 0 && <span>{pksImport.job.attachedRows} {t('campaigns.import.jobAttachedLabel')}</span>}
                  </div>
                )}
              </div>
            )}

            {pksImport.error && (
              <div className="rounded border border-red-700 bg-red-950/40 px-3 py-2 text-red-300 text-sm">
                {pksImport.error}
              </div>
            )}

            {pksImport.preview && !pksImport.jobActive && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded border border-slate-700 bg-slate-900/40 p-3">
                    <p className="text-xs text-gray-400">{t('campaigns.import.totalRowsLabel')}</p>
                    <p className="text-white text-lg font-semibold">{pksImport.preview.totalRows}</p>
                  </div>
                  <div className="rounded border border-slate-700 bg-slate-900/40 p-3">
                    <p className="text-xs text-gray-400">{t('campaigns.import.totalPagesLabel')}</p>
                    <p className="text-white text-lg font-semibold">{pksImport.preview.totalPages}</p>
                  </div>
                  <div className="rounded border border-slate-700 bg-slate-900/40 p-3">
                    <p className="text-xs text-gray-400">{t('campaigns.import.pageSizeLabel')}</p>
                    <p className="text-white text-lg font-semibold">{pksImport.preview.pageSize}</p>
                  </div>
                  <div className="rounded border border-slate-700 bg-slate-900/40 p-3">
                    <p className="text-xs text-gray-400">{t('campaigns.import.queryTimeLabel')}</p>
                    <p className="text-white text-lg font-semibold">{pksImport.preview.queryTimeMs} ms</p>
                  </div>
                </div>

                <div className="rounded border border-slate-700 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-900/60 text-sm text-gray-300">{t('campaigns.import.previewSampleLabel')}</div>
                  <div className="max-h-64 overflow-auto p-3 text-xs text-gray-200 space-y-2 bg-slate-900/30">
                    {pksImport.preview.sample.length === 0 && <p className="text-gray-400">{t('campaigns.import.noRowsInPreview')}</p>}
                    {pksImport.preview.sample.map((row, idx) => (
                      <div key={idx} className="rounded border border-slate-700 p-2 bg-slate-800/50">
                        {Object.entries(row).map(([key, value]) => (
                          <div key={key} className="flex gap-2">
                            <span className="text-gray-400 min-w-44">{key}</span>
                            <span>{String(value ?? '')}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {pksImport.result && !pksImport.isPolling && (
              <div className="rounded border border-emerald-700 bg-emerald-950/30 p-3 text-emerald-200 text-sm">
                {t('campaigns.import.resultImportedPrefix')} {pksImport.result.importedRows} {t('campaigns.import.resultAttachedMid')} {pksImport.result.attachedRows} {t('campaigns.import.resultToCampaignSuffix')}
                {' '}{t('campaigns.import.resultCreatedPrefix')} {pksImport.result.createdCustomers ?? 0}, {t('campaigns.import.resultUpdatedMid')} {pksImport.result.updatedCustomers ?? 0}, {t('campaigns.import.resultAlreadyAttachedMid')} {pksImport.result.alreadyAttachedRows ?? 0}.
                {' '}{t('campaigns.import.resultSkippedPrefix')} {pksImport.result.skippedBySuccessfulCallYesterday ?? 0}.
                {t('campaigns.import.resultProcessedPrefix')} {pksImport.result.pagesProcessed} {t('campaigns.import.resultPagesSuffix')}
              </div>
            )}
              </>
            )}

            {importMode === 'database' && (
              <>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder={t('campaigns.import.customerSearchPlaceholder')}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                  />

                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-300">
                      {t('campaigns.import.availableCustomersLabel')} ({selectedCustomers.size} {t('campaigns.import.selectedSuffix')})
                    </p>
                    <button
                      onClick={() => {
                        if (selectedCustomers.size === availableCustomers.length) {
                          setSelectedCustomers(new Set());
                        } else {
                          setSelectedCustomers(new Set(availableCustomers.map((c) => c.id)));
                        }
                      }}
                      disabled={availableCustomers.length === 0}
                      className="px-2 py-1 rounded border border-slate-600 text-xs text-gray-300 hover:bg-slate-700 disabled:opacity-40"
                    >
                      {selectedCustomers.size === availableCustomers.length ? t('campaigns.import.deselectAllButton') : t('campaigns.import.selectAllButton')}
                    </button>
                  </div>

                  <div className="border border-slate-700 rounded max-h-96 overflow-auto bg-slate-900/30">
                    {loadingCustomers ? (
                      <div className="p-4 text-center text-gray-400">{t('campaigns.import.loadingCustomers')}</div>
                    ) : availableCustomers.length === 0 ? (
                      <div className="p-4 text-center text-gray-400">
                        {customerSearch.trim().length < 2
                          ? t('campaigns.import.customerSearchPrompt')
                          : t('campaigns.import.noCustomersAvailable')}
                      </div>
                    ) : (
                          availableCustomers.map((customer) => (
                            <div
                              key={customer.id}
                              className="flex items-center gap-3 px-4 py-2 border-b border-slate-700 hover:bg-slate-700/30 cursor-pointer"
                              onClick={() => {
                                const newSelected = new Set(selectedCustomers);
                                if (newSelected.has(customer.id)) {
                                  newSelected.delete(customer.id);
                                } else {
                                  newSelected.add(customer.id);
                                }
                                setSelectedCustomers(newSelected);
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedCustomers.has(customer.id)}
                                onChange={() => {}}
                                className="w-4 h-4 rounded border-slate-600"
                              />
                              <div className="flex-1">
                                <p className="text-white">
                                  {customer.name} {customer.surname}
                                </p>
                                {customer.contractNo && (
                                  <p className="text-xs text-gray-400">{customer.contractNo}</p>
                                )}
                              </div>
                              <span className="text-gray-400 text-sm">#{customer.id}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={runDatabaseImport}
                        disabled={importingDatabase || selectedCustomers.size === 0}
                        className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-[#fff] disabled:opacity-60"
                      >
                        {importingDatabase ? t('campaigns.import.importingLabel') : t('campaigns.import.importSelectedButton')}
                      </button>
                    </div>

                {databaseImportResult && (
                  <div className="rounded border border-emerald-700 bg-emerald-950/30 p-3 text-emerald-200 text-sm">
                    {t('campaigns.import.dbResultPrefix')} {databaseImportResult.importedRows} {t('campaigns.import.dbResultMid')} {databaseImportResult.attachedRows} {t('campaigns.import.dbResultSuffix')}
                    {databaseImportResult.alreadyAttachedRows > 0 && (
                      <>{' '}{databaseImportResult.alreadyAttachedRows} {t('campaigns.import.dbResultAlreadyAttachedSuffix')}</>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
