'use client';

import { useEffect, useState } from 'react';
import { useAgents } from '@/hooks/useCallbot';
import callbotApi, { type ExternalApiClient, type ExternalApiClientCreated } from '@/lib/callbot-api';
import { EXTERNAL_API_DOCS_MD } from '@/lib/external-api-docs';
import { useLanguage } from '@/lib/language';

type FormState = {
  name: string;
  defaultAgentId: string;
  defaultWebhookUrl: string;
  active: boolean;
};

const emptyForm: FormState = { name: '', defaultAgentId: '', defaultWebhookUrl: '', active: true };

function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ExternalApiPage() {
  const { t } = useLanguage();
  const { agents } = useAgents();

  const [clients, setClients] = useState<ExternalApiClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [newlyCreated, setNewlyCreated] = useState<ExternalApiClientCreated | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const loadClients = async () => {
    setLoading(true);
    try {
      const data = await callbotApi.getExternalApiClients();
      setClients(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('externalApi.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
  }, []);

  const agentName = (id: number | null) => {
    if (!id) return t('externalApi.noDefaultAgent');
    return agents.find((a) => Number(a.id) === id)?.name || `#${id}`;
  };

  const openCreateForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (client: ExternalApiClient) => {
    setEditingId(client.id);
    setForm({
      name: client.name,
      defaultAgentId: client.defaultAgentId ? String(client.defaultAgentId) : '',
      defaultWebhookUrl: client.defaultWebhookUrl || '',
      active: client.active,
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
    if (!form.name.trim()) {
      setFormError(t('externalApi.nameRequired'));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        defaultAgentId: form.defaultAgentId ? Number(form.defaultAgentId) : null,
        defaultWebhookUrl: form.defaultWebhookUrl.trim() || null,
        active: form.active,
      };
      if (editingId) {
        const updated = await callbotApi.updateExternalApiClient(editingId, payload);
        setClients((prev) => prev.map((c) => (c.id === editingId ? updated : c)));
      } else {
        const created = await callbotApi.createExternalApiClient(payload);
        setClients((prev) => [{ ...created }, ...prev]);
        setNewlyCreated(created);
      }
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('externalApi.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (client: ExternalApiClient) => {
    if (client.active) {
      const confirmed = window.confirm(`${t('externalApi.confirmRevokePrefix')} ${client.name}?`);
      if (!confirmed) return;
    }
    setRevokingId(client.id);
    try {
      const updated = client.active
        ? await callbotApi.revokeExternalApiClient(client.id)
        : await callbotApi.updateExternalApiClient(client.id, {
            name: client.name,
            defaultAgentId: client.defaultAgentId,
            defaultWebhookUrl: client.defaultWebhookUrl,
            active: true,
          });
      setClients((prev) => prev.map((c) => (c.id === client.id ? updated : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('externalApi.saveFailed'));
    } finally {
      setRevokingId(null);
    }
  };

  const copyToClipboard = async (field: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 2000);
    } catch {
      // clipboard API unavailable — the value is still visible to select/copy manually
    }
  };

  const formatDate = (value: string | null) => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
  };

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-2 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">{t('externalApi.heading')}</h1>
          <p className="text-gray-400 max-w-2xl">{t('externalApi.description')}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => downloadMarkdown('external-call-api.md', EXTERNAL_API_DOCS_MD)}
            className="px-4 py-2 rounded border border-slate-600 text-gray-200 hover:bg-slate-700 transition font-medium"
          >
            {t('externalApi.downloadDocs')}
          </button>
          <button
            onClick={openCreateForm}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition font-medium"
          >
            + {t('externalApi.newClient')}
          </button>
        </div>
      </div>

      {newlyCreated && (
        <div className="mt-6 mb-6 rounded-lg border border-amber-600 bg-amber-950/20 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-amber-300 font-semibold mb-1">{t('externalApi.oneTimeRevealTitle')}</h3>
              <p className="text-amber-200/80 text-sm">{t('externalApi.oneTimeRevealWarning')}</p>
            </div>
            <button
              onClick={() => setNewlyCreated(null)}
              className="text-amber-300/70 hover:text-amber-200 text-sm shrink-0"
            >
              {t('externalApi.dismiss')}
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <p className="text-xs text-amber-300/70 uppercase tracking-wide mb-1">{t('externalApi.apiKeyLabel')}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-slate-900/60 border border-amber-700/40 rounded px-3 py-2 text-amber-100 text-sm break-all">
                  {newlyCreated.apiKey}
                </code>
                <button
                  onClick={() => copyToClipboard('apiKey', newlyCreated.apiKey)}
                  className="px-3 py-2 rounded border border-amber-600 text-amber-200 text-sm hover:bg-amber-900/40 shrink-0"
                >
                  {copiedField === 'apiKey' ? t('externalApi.copied') : t('externalApi.copy')}
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs text-amber-300/70 uppercase tracking-wide mb-1">{t('externalApi.webhookSecretLabel')}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-slate-900/60 border border-amber-700/40 rounded px-3 py-2 text-amber-100 text-sm break-all">
                  {newlyCreated.webhookSecret}
                </code>
                <button
                  onClick={() => copyToClipboard('webhookSecret', newlyCreated.webhookSecret)}
                  className="px-3 py-2 rounded border border-amber-600 text-amber-200 text-sm hover:bg-amber-900/40 shrink-0"
                >
                  {copiedField === 'webhookSecret' ? t('externalApi.copied') : t('externalApi.copy')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 mb-4 rounded border border-red-700 bg-red-950/40 px-3 py-2 text-red-300 text-sm">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mt-6 mb-6 rounded-lg border border-slate-700 bg-slate-800 p-5">
          <h3 className="text-white font-semibold mb-4">
            {editingId ? t('externalApi.editClientTitle') : t('externalApi.newClientTitle')}
          </h3>
          <form onSubmit={submitForm} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1">{t('externalApi.nameLabel')}</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t('externalApi.namePlaceholder')}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">{t('externalApi.defaultAgentLabel')}</label>
                <select
                  value={form.defaultAgentId}
                  onChange={(e) => setForm({ ...form, defaultAgentId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                >
                  <option value="">{t('externalApi.noDefaultAgentOption')}</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">{t('externalApi.defaultWebhookLabel')}</label>
                <input
                  type="text"
                  value={form.defaultWebhookUrl}
                  onChange={(e) => setForm({ ...form, defaultWebhookUrl: e.target.value })}
                  placeholder="https://your-backend.example.com/webhooks/robocall"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                />
              </div>
            </div>
            {editingId && (
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-600"
                />
                {t('externalApi.activeLabel')}
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
                {saving ? t('externalApi.saving') : editingId ? t('externalApi.saveChanges') : t('externalApi.createClient')}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 rounded border border-slate-600 text-gray-300 hover:bg-slate-700"
              >
                {t('externalApi.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-slate-800 rounded-lg overflow-hidden mt-6">
        {loading ? (
          <div className="p-8 text-center text-gray-400">{t('externalApi.loading')}</div>
        ) : clients.length === 0 ? (
          <div className="p-8 text-center text-gray-400">{t('externalApi.noClients')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-700 border-b border-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('externalApi.columns.name')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('externalApi.columns.defaultAgent')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('externalApi.columns.webhook')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('externalApi.columns.status')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('externalApi.columns.created')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('externalApi.columns.lastUsed')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">{t('externalApi.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id} className="border-b border-slate-700 hover:bg-slate-700/50 transition">
                    <td className="px-4 py-3 text-white font-medium">{client.name}</td>
                    <td className="px-4 py-3 text-gray-400">{agentName(client.defaultAgentId)}</td>
                    <td className="px-4 py-3 text-gray-400 max-w-xs truncate">{client.defaultWebhookUrl || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        client.active ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {client.active ? t('externalApi.statusActive') : t('externalApi.statusRevoked')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatDate(client.createdAt)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatDate(client.lastUsedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEditForm(client)}
                          className="px-2 py-1 rounded border border-slate-600 text-gray-300 hover:bg-slate-700 text-xs"
                        >
                          {t('externalApi.edit')}
                        </button>
                        <button
                          onClick={() => toggleActive(client)}
                          disabled={revokingId === client.id}
                          className={`px-2 py-1 rounded border text-xs disabled:opacity-60 ${
                            client.active
                              ? 'border-red-700 text-red-300 hover:bg-red-900/40'
                              : 'border-emerald-700 text-emerald-300 hover:bg-emerald-900/40'
                          }`}
                        >
                          {revokingId === client.id
                            ? t('externalApi.saving')
                            : client.active
                              ? t('externalApi.revoke')
                              : t('externalApi.reactivate')}
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
