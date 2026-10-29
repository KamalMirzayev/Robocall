'use client';

import { useEffect, useRef, useState } from 'react';
import { callbotApi, type InstructionTemplate } from '@/lib/callbot-api';
import { Agent } from '@/types/callbot';
import { useSIPTrunks } from '@/hooks/useTelephony';
import { useLanguage } from '@/lib/language';

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';

export type CampaignWeekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface CampaignInput {
  name: string;
  description: string;
  status: CampaignStatus;
  maxAttempts: number;
  retryIntervalHours: number;
  orderByMonthlyPaymentDesc: boolean;
  skipNextDayAfterSuccess: boolean;
  dailyCustomerRefresh: boolean;
  runWeekdays: CampaignWeekday[];
  runWindowStart: string;
  runWindowEnd: string;
  agentId?: number;
  trunkId?: string;
  trunkIds?: string[];
  baseTemplateId?: string;
  runStartDate?: string;
  runEndDate?: string;
}

interface CampaignFormProps {
  initialValue?: CampaignInput;
  submitting?: boolean;
  onSubmit: (value: CampaignInput) => void;
  onCancel: () => void;
}

const defaultValue: CampaignInput = {
  name: '',
  description: '',
  status: 'draft',
  maxAttempts: 3,
  retryIntervalHours: 24,
  orderByMonthlyPaymentDesc: false,
  skipNextDayAfterSuccess: false,
  dailyCustomerRefresh: false,
  trunkIds: [] as string[],
  runWeekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  runWindowStart: '09:00',
  runWindowEnd: '19:00',
};

const weekdayOptions: Array<{ key: CampaignWeekday; label: string }> = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

export function CampaignForm({ initialValue, submitting = false, onSubmit, onCancel }: CampaignFormProps) {
  const { t } = useLanguage();
  const [form, setForm] = useState<CampaignInput>(initialValue ?? defaultValue);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const { trunks, loading: trunksLoading } = useSIPTrunks();
  const [baseTemplates, setBaseTemplates] = useState<InstructionTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [trunkDropdownOpen, setTrunkDropdownOpen] = useState(false);
  const trunkDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!trunkDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (trunkDropdownRef.current && !trunkDropdownRef.current.contains(e.target as Node)) {
        setTrunkDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [trunkDropdownOpen]);

  useEffect(() => {
    setForm(initialValue ?? defaultValue);
  }, [initialValue]);

  useEffect(() => {
    async function loadData() {
      try {
        const agentsData = await callbotApi.getAgents();
        setAgents(agentsData.filter((a) => a.enabled));
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  useEffect(() => {
    async function loadTemplates() {
      try {
        const templates = await callbotApi.getInstructionTemplates();
        setBaseTemplates(templates.filter((t) => t.template_type === 'base' && t.is_active));
      } catch (error) {
        console.error('Failed to load base templates:', error);
      } finally {
        setLoadingTemplates(false);
      }
    }
    loadTemplates();
  }, []);

  const toggleWeekday = (day: CampaignWeekday) => {
    setForm((prev) => {
      const exists = prev.runWeekdays.includes(day);
      const runWeekdays = exists
        ? prev.runWeekdays.filter((item) => item !== day)
        : [...prev.runWeekdays, day];
      return {
        ...prev,
        runWeekdays,
      };
    });
  };

  const isDateRangeValid = !form.runStartDate || !form.runEndDate || form.runStartDate <= form.runEndDate;
  const isScheduleValid = form.runWeekdays.length > 0 && form.runWindowStart < form.runWindowEnd && isDateRangeValid;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isScheduleValid) return;
        onSubmit(form);
      }}
    >
      <div>
        <label className="block text-sm text-gray-300 mb-1">{t('campaignForm.campaignName')}</label>
        <input
          required
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
          placeholder={t('campaignForm.campaignNamePlaceholder')}
        />
      </div>

      <div>
        <label className="block text-sm text-gray-300 mb-1">{t('campaignForm.description')}</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white min-h-24"
          placeholder={t('campaignForm.descriptionPlaceholder')}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-gray-300 mb-1">{t('campaignForm.agent')}</label>
          <select
            value={form.agentId || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, agentId: e.target.value ? Number(e.target.value) : undefined }))}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            disabled={loading}
          >
            <option value="">{t('campaignForm.selectAgent')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div ref={trunkDropdownRef} className="relative">
          <label className="block text-sm text-gray-300 mb-1">{t('campaignForm.sipTrunk')}</label>
          <button
            type="button"
            onClick={() => setTrunkDropdownOpen((prev) => !prev)}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-left flex items-center justify-between"
            disabled={trunksLoading}
          >
            <span>
              {(form.trunkIds || []).length > 0
                ? `${(form.trunkIds || []).length} trunk(s) selected`
                : form.trunkId
                  ? '1 trunk (legacy)'
                  : t('campaignForm.autoTrunk')}
            </span>
            <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {trunkDropdownOpen && (
            <div className="absolute z-50 mt-1 w-full max-h-64 overflow-auto bg-slate-700 border border-slate-600 rounded-lg shadow-lg">
              <div className="flex gap-2 px-3 py-2 border-b border-slate-600">
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, trunkIds: trunks.filter((t) => t.enabled).map((t) => t.id) }))}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, trunkIds: [] }))}
                  className="text-xs text-gray-400 hover:text-gray-300"
                >
                  Clear
                </button>
              </div>
              {trunks.filter((t) => t.enabled).length === 0 && (
                <p className="px-3 py-2 text-sm text-gray-400">No enabled trunks</p>
              )}
              {trunks.filter((t) => t.enabled).map((trunk) => {
                const selected = (form.trunkIds || []).includes(trunk.id);
                return (
                  <label
                    key={trunk.id}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-slate-600 cursor-pointer text-sm text-white"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => {
                        setForm((prev) => {
                          const current = prev.trunkIds || [];
                          const next = selected
                            ? current.filter((id) => id !== trunk.id)
                            : [...current, trunk.id];
                          return { ...prev, trunkIds: next };
                        });
                      }}
                      className="h-4 w-4 rounded border-slate-500"
                    />
                    <span>{trunk.name}</span>
                    <span className="text-xs text-gray-400">({trunk.trunk_type})</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm text-gray-300 mb-1">{t('campaignForm.baseTemplate')}</label>
        <select
          value={form.baseTemplateId || ''}
          onChange={(e) => setForm((prev) => ({ ...prev, baseTemplateId: e.target.value || undefined }))}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
          disabled={loadingTemplates}
        >
          <option value="">{t('campaignForm.defaultBaseTemplate')}</option>
          {baseTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm text-gray-300 mb-1">{t('campaignForm.status')}</label>
          <select
            value={form.status}
            onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as CampaignStatus }))}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
          >
            <option value="draft">{t('campaignForm.statusDraft')}</option>
            <option value="active">{t('campaignForm.statusActive')}</option>
            <option value="paused">{t('campaignForm.statusPaused')}</option>
            <option value="completed">{t('campaignForm.statusCompleted')}</option>
            <option value="cancelled">{t('campaignForm.statusCancelled')}</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">{t('campaignForm.maxAttempts')}</label>
          <input
            type="number"
            min={1}
            value={form.maxAttempts}
            onChange={(e) => setForm((prev) => ({ ...prev, maxAttempts: Number(e.target.value) || 1 }))}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">{t('campaignForm.retryIntervalHours')}</label>
          <input
            type="number"
            min={1}
            value={form.retryIntervalHours}
            onChange={(e) => setForm((prev) => ({ ...prev, retryIntervalHours: Number(e.target.value) || 1 }))}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
          />
        </div>
      </div>

      <div className="space-y-3 border border-slate-700 rounded-lg p-3 bg-slate-900/30">
        <p className="text-sm text-gray-300">{t('campaignForm.settingsHeading')}</p>

        <label className="flex items-start gap-3 rounded border border-slate-700 bg-slate-900/30 p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.orderByMonthlyPaymentDesc}
            onChange={(e) => setForm((prev) => ({ ...prev, orderByMonthlyPaymentDesc: e.target.checked }))}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block text-sm text-white">{t('campaignForm.paymentPriorityTitle')}</span>
            <span className="block text-xs text-gray-400 mt-1">
              {t('campaignForm.paymentPriorityDesc')}
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded border border-slate-700 bg-slate-900/30 p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.skipNextDayAfterSuccess}
            onChange={(e) => setForm((prev) => ({ ...prev, skipNextDayAfterSuccess: e.target.checked }))}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block text-sm text-white">{t('campaignForm.skipNextDayTitle')}</span>
            <span className="block text-xs text-gray-400 mt-1">
              {t('campaignForm.skipNextDayDesc')}
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded border border-slate-700 bg-slate-900/30 p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.dailyCustomerRefresh}
            onChange={(e) => setForm((prev) => ({ ...prev, dailyCustomerRefresh: e.target.checked }))}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block text-sm text-white">{t('campaignForm.dailyRefreshTitle')}</span>
            <span className="block text-xs text-gray-400 mt-1">
              {t('campaignForm.dailyRefreshDesc')}
            </span>
          </span>
        </label>
      </div>

      <div className="space-y-3 border border-slate-700 rounded-lg p-3 bg-slate-900/30">
        <div>
          <label className="block text-sm text-gray-300 mb-2">{t('campaignForm.runWeekdays')}</label>
          <div className="flex flex-wrap gap-2">
            {weekdayOptions.map((option) => {
              const selected = form.runWeekdays.includes(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => toggleWeekday(option.key)}
                  className={`px-3 py-1.5 text-xs rounded border ${selected
                    ? 'bg-blue-600/30 border-blue-500 text-blue-100'
                    : 'border-slate-600 text-gray-300 hover:bg-slate-700'
                    }`}
                >
                  {t(`campaignForm.days.${option.key}`)}
                </button>
              );
            })}
          </div>
          {form.runWeekdays.length === 0 && (
            <p className="text-xs text-red-300 mt-2">{t('campaignForm.selectWeekday')}</p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-300 mb-1">{t('campaignForm.dailyStartTime')}</label>
            <input
              type="time"
              value={form.runWindowStart}
              onChange={(e) => setForm((prev) => ({ ...prev, runWindowStart: e.target.value }))}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">{t('campaignForm.dailyEndTime')}</label>
            <input
              type="time"
              value={form.runWindowEnd}
              onChange={(e) => setForm((prev) => ({ ...prev, runWindowEnd: e.target.value }))}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
        </div>
        {form.runWindowStart >= form.runWindowEnd && (
          <p className="text-xs text-red-300">{t('campaignForm.endTimeError')}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-300 mb-1">{t('campaignForm.startDate')}</label>
            <input
              type="date"
              value={form.runStartDate || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, runStartDate: e.target.value || undefined }))}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">{t('campaignForm.endDate')}</label>
            <input
              type="date"
              value={form.runEndDate || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, runEndDate: e.target.value || undefined }))}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
        </div>
        {!isDateRangeValid && (
          <p className="text-xs text-red-300">{t('campaignForm.endDateError')}</p>
        )}
        <p className="text-xs text-gray-400">{t('campaignForm.dateRangeHint')}</p>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-slate-600 text-gray-300 hover:bg-slate-700"
        >
          {t('campaignForm.cancel')}
        </button>
        <button
          type="submit"
          disabled={submitting || !isScheduleValid}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
        >
          {submitting ? t('campaignForm.saving') : t('campaignForm.save')}
        </button>
      </div>
    </form>
  );
}
