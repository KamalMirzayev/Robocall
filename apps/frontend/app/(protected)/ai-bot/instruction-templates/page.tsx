'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  callbotApi,
  type CreateInstructionTemplateInput,
  type InstructionTemplate,
} from '@/lib/callbot-api';
import { useLanguage } from '@/lib/language';

type TemplateVariable = { key: string; description: string };

const initialForm: CreateInstructionTemplateInput = {
  tenant_id: 'default',
  version: 'v1.0',
  name: '',
  description: '',
  content: '',
  template_type: 'base',
  is_active: false,
  created_by: 'admin',
  customer_category: '',
  external_key: '',
};

export default function InstructionTemplatesPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<InstructionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'base' | 'tone' | 'system'>('all');
  const [form, setForm] = useState<CreateInstructionTemplateInput>(initialForm);
  const [editingTemplate, setEditingTemplate] = useState<InstructionTemplate | null>(null);
  const [editForm, setEditForm] = useState<Partial<CreateInstructionTemplateInput>>({});
  const [showVariables, setShowVariables] = useState(false);
  const [templateVariables, setTemplateVariables] = useState<TemplateVariable[]>([]);
  const [variablesLoading, setVariablesLoading] = useState(true);

  const fetchRows = async () => {
    try {
      setLoading(true);
      const data = await callbotApi.getInstructionTemplates({
        q: query || undefined,
        tenant_id: tenantFilter || undefined,
        limit: 300,
      });
      setRows(data);
      setError(null);
    } catch (err) {
      console.error('Failed to load instruction templates:', err);
      setError(t('instructionTemplates.failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  const fetchTemplateVariables = async () => {
    try {
      setVariablesLoading(true);
      const response = await fetch('/api/callbot/instruction-templates/variables');
      if (!response.ok) throw new Error('Failed to fetch template variables');
      const variables = await response.json();
      setTemplateVariables(variables);
    } catch (err) {
      console.error('Failed to load template variables:', err);
      // Fall back to empty array if fetch fails
      setTemplateVariables([]);
    } finally {
      setVariablesLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
    fetchTemplateVariables();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tenants = useMemo(() => {
    const unique = new Set(rows.map((r) => r.tenant_id).filter(Boolean));
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    let filtered = rows;
    if (tenantFilter) {
      filtered = filtered.filter((r) => r.tenant_id === tenantFilter);
    }
    if (typeFilter !== 'all') {
      filtered = filtered.filter((r) => r.template_type === typeFilter);
    }
    return filtered;
  }, [rows, tenantFilter, typeFilter]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setCreating(true);
      setError(null);
      await callbotApi.createInstructionTemplate({
        ...form,
        name: String(form.name || '').trim(),
        content: String(form.content || '').trim(),
      });
      setForm(initialForm);
      await fetchRows();
    } catch (err: any) {
      console.error('Failed to create template:', err);
      setError(err?.message || t('instructionTemplates.failedToCreate'));
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (template: InstructionTemplate) => {
    setEditingTemplate(template);
    setEditForm({
      name: template.name,
      description: template.description || '',
      content: template.content,
      template_type: template.template_type,
      is_active: template.is_active,
      version: template.version,
      customer_category: template.customer_category || '',
      external_key: template.external_key || '',
    });
  };

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingTemplate) return;
    try {
      setUpdating(true);
      setError(null);
      await callbotApi.updateInstructionTemplate(editingTemplate.id, {
        ...editForm,
        name: String(editForm.name || '').trim(),
        content: String(editForm.content || '').trim(),
      });
      setEditingTemplate(null);
      setEditForm({});
      await fetchRows();
    } catch (err: any) {
      console.error('Failed to update template:', err);
      setError(err?.message || t('instructionTemplates.failedToUpdate'));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-white">{t('instructionTemplates.heading')}</h1>
          <p className="text-gray-400 mt-1">{t('instructionTemplates.subtitle')}</p>
        </div>
        <button
          onClick={fetchRows}
          className="px-4 py-2 rounded-lg border border-slate-600 text-gray-300 hover:bg-slate-700"
        >
          {t('instructionTemplates.refresh')}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-500 bg-red-500/10 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('instructionTemplates.searchPlaceholder')}
          className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
        />
        <select
          value={tenantFilter}
          onChange={(e) => setTenantFilter(e.target.value)}
          className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
        >
          <option value="">{t('instructionTemplates.allTenants')}</option>
          {tenants.map((tenant) => (
            <option key={tenant} value={tenant}>{tenant}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as any)}
          className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
        >
          <option value="all">{t('instructionTemplates.allTypes')}</option>
          <option value="base">{t('instructionTemplates.typeFilterBase')}</option>
          <option value="tone">{t('instructionTemplates.typeFilterTone')}</option>
          <option value="system">{t('instructionTemplates.typeSystem')}</option>
        </select>
        <button
          onClick={fetchRows}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-[#fff]"
        >
          {t('instructionTemplates.applyFilters')}
        </button>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-lg p-5">
        <h2 className="text-lg font-semibold text-white mb-4">{t('instructionTemplates.addNewTemplate')}</h2>
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              value={form.tenant_id || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, tenant_id: e.target.value }))}
              placeholder={t('instructionTemplates.tenantIdPlaceholder')}
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              required
            />
            <input
              value={form.version || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, version: e.target.value }))}
              placeholder={t('instructionTemplates.versionPlaceholder')}
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              required
            />
            <select
              value={form.template_type || 'base'}
              onChange={(e) => setForm((prev) => ({ ...prev, template_type: e.target.value as 'base' | 'tone' | 'system' }))}
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              required
            >
              <option value="base">{t('instructionTemplates.typeOptionBase')}</option>
              <option value="tone">{t('instructionTemplates.typeOptionTone')}</option>
              <option value="system">{t('instructionTemplates.typeSystem')}</option>
            </select>
            <input
              value={form.customer_category || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, customer_category: e.target.value }))}
              placeholder={t('instructionTemplates.customerCategoryOptional')}
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>

          <div>
            <input
              value={form.external_key || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, external_key: e.target.value }))}
              placeholder={t('instructionTemplates.externalKeyPlaceholder')}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">{t('instructionTemplates.externalKeyHint')}</p>
          </div>

          <input
            value={form.name || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder={t('instructionTemplates.templateName')}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            required
          />

          <input
            value={form.description || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            placeholder={t('instructionTemplates.description')}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
          />

          <textarea
            value={form.content || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
            placeholder={t('instructionTemplates.contentPlaceholder')}
            className="w-full min-h-36 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            required
          />

          {/* Available Variables Reference */}
          <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-3">
            <button
              type="button"
              onClick={() => setShowVariables(!showVariables)}
              className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition"
            >
              <span className={`text-xs transition-transform ${showVariables ? 'rotate-90' : ''}`}>▶</span>
              {t('instructionTemplates.availableVariables')} ({templateVariables.length})
            </button>

            {showVariables && (
              <div className="mt-3 space-y-2">
                {variablesLoading ? (
                  <p className="text-xs text-gray-400">{t('instructionTemplates.loadingVariables')}</p>
                ) : templateVariables.length === 0 ? (
                  <p className="text-xs text-gray-400">{t('instructionTemplates.noVariablesAvailable')}</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {templateVariables.map((variable) => (
                      <div
                        key={variable.key}
                        className="bg-slate-800 border border-slate-600 rounded p-2 text-xs"
                      >
                        <code className="text-blue-300 font-mono break-all">{variable.key}</code>
                        <div className="text-gray-400 mt-1">{variable.description}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <label className="text-sm text-gray-300 flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(form.is_active)}
                onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
              />
              {t('instructionTemplates.setAsActive')}
            </label>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-[#fff] disabled:opacity-60"
            >
              {creating ? t('instructionTemplates.creating') : t('instructionTemplates.createTemplate')}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 text-sm text-gray-400">
          {loading
            ? t('instructionTemplates.loading')
            : `${t('instructionTemplates.showing')} ${filteredRows.length} ${t('instructionTemplates.of')} ${rows.length} ${t('instructionTemplates.templatesLower')}`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 text-gray-300">
              <tr>
                <th className="text-left px-4 py-3">{t('instructionTemplates.colName')}</th>
                <th className="text-left px-4 py-3">{t('instructionTemplates.colType')}</th>
                <th className="text-left px-4 py-3">{t('instructionTemplates.colTenant')}</th>
                <th className="text-left px-4 py-3">{t('instructionTemplates.colVersion')}</th>
                <th className="text-left px-4 py-3">{t('instructionTemplates.colCategory')}</th>
                <th className="text-left px-4 py-3">{t('instructionTemplates.colExternalKey')}</th>
                <th className="text-left px-4 py-3">{t('instructionTemplates.colActive')}</th>
                <th className="text-left px-4 py-3">{t('instructionTemplates.colUpdated')}</th>
                <th className="text-left px-4 py-3">{t('instructionTemplates.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} className="border-t border-slate-700 align-top">
                  <td className="px-4 py-3 text-white">
                    <div className="font-medium">{row.name}</div>
                    {row.description && <div className="text-gray-400 mt-1">{row.description}</div>}
                    <details className="mt-2 text-xs text-gray-400">
                      <summary className="cursor-pointer">{t('instructionTemplates.showContent')}</summary>
                      <pre className="whitespace-pre-wrap break-words mt-2 text-gray-300">{row.content}</pre>
                    </details>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-300">
                      {row.template_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{row.tenant_id}</td>
                  <td className="px-4 py-3 text-gray-300">{row.version}</td>
                  <td className="px-4 py-3 text-gray-300">{row.customer_category || '-'}</td>
                  <td className="px-4 py-3 text-gray-300 font-mono text-xs">{row.external_key || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-1 rounded text-xs ${row.is_active ? 'bg-green-500/20 text-green-300' : 'bg-slate-600/40 text-gray-300'}`}>
                      {row.is_active ? t('instructionTemplates.yes') : t('instructionTemplates.no')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{new Date(row.updated_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openEdit(row)}
                      className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-[#fff] text-xs font-medium transition"
                    >
                      {t('instructionTemplates.edit')}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400">{t('instructionTemplates.noTemplatesFound')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{t('instructionTemplates.editTemplate')}</h2>
              <button
                onClick={() => {
                  setEditingTemplate(null);
                  setEditForm({});
                }}
                className="text-gray-400 hover:text-gray-300 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleUpdate} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('instructionTemplates.templateName')}</label>
                  <input
                    value={editForm.name || ''}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('instructionTemplates.colType')}</label>
                  <select
                    value={editForm.template_type || 'base'}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, template_type: e.target.value as 'base' | 'tone' | 'system' }))}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                    required
                  >
                    <option value="base">{t('instructionTemplates.typeOptionBase')}</option>
                    <option value="tone">{t('instructionTemplates.typeOptionTone')}</option>
                    <option value="system">{t('instructionTemplates.typeSystem')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('instructionTemplates.colVersion')}</label>
                  <input
                    value={editForm.version || ''}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, version: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('instructionTemplates.description')}</label>
                <input
                  value={editForm.description || ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('instructionTemplates.customerCategory')}</label>
                <input
                  value={editForm.customer_category || ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, customer_category: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('instructionTemplates.externalKeyLabel')}</label>
                <input
                  value={editForm.external_key || ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, external_key: e.target.value }))}
                  placeholder={t('instructionTemplates.externalKeyPlaceholder')}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">{t('instructionTemplates.externalKeyHint')}</p>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('instructionTemplates.content')}</label>
                <textarea
                  value={editForm.content || ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, content: e.target.value }))}
                  className="w-full min-h-48 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white font-mono text-xs"
                  required
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-300 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(editForm.is_active)}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                  />
                  {t('instructionTemplates.colActive')}
                </label>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-700">
                <button
                  type="submit"
                  disabled={updating}
                  className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-[#fff] disabled:opacity-60 font-medium"
                >
                  {updating ? t('instructionTemplates.saving') : t('instructionTemplates.saveChanges')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingTemplate(null);
                    setEditForm({});
                  }}
                  className="flex-1 px-4 py-2 rounded-lg border border-slate-600 hover:bg-slate-700 text-gray-300 font-medium"
                >
                  {t('instructionTemplates.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
