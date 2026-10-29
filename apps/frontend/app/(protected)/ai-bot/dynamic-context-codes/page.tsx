'use client';

import { useEffect, useState } from 'react';
import callbotApi, { type DynamicContextCode } from '@/lib/callbot-api';
import { useLanguage } from '@/lib/language';

type FormState = {
  code: string;
  phrase: string;
  description: string;
  active: boolean;
};

const emptyForm: FormState = { code: '', phrase: '', description: '', active: true };

export default function DynamicContextCodesPage() {
  const { t } = useLanguage();

  const [codes, setCodes] = useState<DynamicContextCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadCodes = async () => {
    setLoading(true);
    try {
      const data = await callbotApi.getDynamicContextCodes();
      setCodes(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dynamicContextCodes.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCodes();
  }, []);

  const openCreateForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (row: DynamicContextCode) => {
    setEditingId(row.id);
    setForm({
      code: row.code,
      phrase: row.phrase,
      description: row.description || '',
      active: row.active,
    });
    setFormError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormError(null);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.phrase.trim()) {
      setFormError(t('dynamicContextCodes.codeAndPhraseRequired'));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        code: form.code.trim(),
        phrase: form.phrase.trim(),
        description: form.description.trim() || null,
        active: form.active,
      };
      if (editingId) {
        const updated = await callbotApi.updateDynamicContextCode(editingId, payload);
        setCodes((prev) => prev.map((c) => (c.id === editingId ? updated : c)));
      } else {
        const created = await callbotApi.createDynamicContextCode(payload);
        setCodes((prev) => [...prev, created].sort((a, b) => a.code.localeCompare(b.code)));
      }
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('dynamicContextCodes.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: DynamicContextCode) => {
    setSaving(true);
    try {
      const updated = await callbotApi.updateDynamicContextCode(row.id, {
        code: row.code,
        phrase: row.phrase,
        description: row.description,
        active: !row.active,
      });
      setCodes((prev) => prev.map((c) => (c.id === row.id ? updated : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dynamicContextCodes.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-2 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">{t('dynamicContextCodes.heading')}</h1>
          <p className="text-gray-400 max-w-2xl">{t('dynamicContextCodes.description')}</p>
        </div>
        <button
          onClick={openCreateForm}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition font-medium shrink-0"
        >
          + {t('dynamicContextCodes.newCode')}
        </button>
      </div>

      {error && (
        <div className="mt-4 mb-4 rounded border border-red-700 bg-red-950/40 px-3 py-2 text-red-300 text-sm">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mt-6 mb-6 rounded-lg border border-slate-700 bg-slate-800 p-5">
          <h3 className="text-white font-semibold mb-4">
            {editingId ? t('dynamicContextCodes.editCodeTitle') : t('dynamicContextCodes.newCodeTitle')}
          </h3>
          <form onSubmit={submitForm} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1">{t('dynamicContextCodes.codeLabel')}</label>
              <input
                type="text"
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder={t('dynamicContextCodes.codePlaceholder')}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">{t('dynamicContextCodes.codeHint')}</p>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">{t('dynamicContextCodes.phraseLabel')}</label>
              <textarea
                required
                value={form.phrase}
                onChange={(e) => setForm({ ...form, phrase: e.target.value })}
                placeholder={t('dynamicContextCodes.phrasePlaceholder')}
                className="w-full min-h-24 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
              />
              <p className="text-xs text-gray-500 mt-1">{t('dynamicContextCodes.phraseHint')}</p>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">{t('dynamicContextCodes.descriptionLabel')}</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={t('dynamicContextCodes.descriptionPlaceholder')}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
              />
            </div>
            {editingId && (
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-600"
                />
                {t('dynamicContextCodes.activeLabel')}
              </label>
            )}
            {formError && (
              <div className="rounded border border-red-700 bg-red-950/40 px-3 py-2 text-red-300 text-sm">
                {formError}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition font-medium disabled:opacity-60"
              >
                {saving ? t('dynamicContextCodes.saving') : editingId ? t('dynamicContextCodes.saveChanges') : t('dynamicContextCodes.createCode')}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 rounded border border-slate-600 text-gray-300 hover:bg-slate-700"
              >
                {t('dynamicContextCodes.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-slate-800 rounded-lg overflow-hidden mt-6">
        {loading ? (
          <div className="p-8 text-center text-gray-400">{t('dynamicContextCodes.loading')}</div>
        ) : codes.length === 0 ? (
          <div className="p-8 text-center text-gray-400">{t('dynamicContextCodes.noCodes')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-700 border-b border-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('dynamicContextCodes.columns.code')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('dynamicContextCodes.columns.phrase')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('dynamicContextCodes.columns.description')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('dynamicContextCodes.columns.status')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('dynamicContextCodes.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((row) => (
                  <tr key={row.id} className="border-b border-slate-700 hover:bg-slate-700/50 transition align-top">
                    <td className="px-4 py-3 text-white font-mono text-xs">{row.code}</td>
                    <td className="px-4 py-3 text-gray-300 max-w-md">{row.phrase}</td>
                    <td className="px-4 py-3 text-gray-400 max-w-xs">{row.description || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        row.active ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {row.active ? t('dynamicContextCodes.statusActive') : t('dynamicContextCodes.statusInactive')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEditForm(row)}
                          className="px-2 py-1 rounded border border-slate-600 text-gray-300 hover:bg-slate-700 text-xs"
                        >
                          {t('dynamicContextCodes.edit')}
                        </button>
                        <button
                          onClick={() => toggleActive(row)}
                          disabled={saving}
                          className={`px-2 py-1 rounded border text-xs disabled:opacity-60 ${
                            row.active
                              ? 'border-red-700 text-red-300 hover:bg-red-900/40'
                              : 'border-emerald-700 text-emerald-300 hover:bg-emerald-900/40'
                          }`}
                        >
                          {row.active ? t('dynamicContextCodes.deactivate') : t('dynamicContextCodes.activate')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
