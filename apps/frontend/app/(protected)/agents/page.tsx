'use client';

import { useState, useEffect } from 'react';
import { useAgents } from '@/hooks/useCallbot';
import AddAgentForm from '@/components/AddAgentForm';
import callbotApi from '@/lib/callbot-api';
import type { Agent } from '@/types/callbot';
import { useLanguage } from '@/lib/language';

interface InstructionTemplate {
  id: string;
  name: string;
  template_type: 'base' | 'tone' | 'system';
  is_active: boolean;
}

export default function AgentsPage() {
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [editForm, setEditForm] = useState<Partial<Agent>>({});
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const { agents, loading, error, refetch } = useAgents();
  const [toneTemplates, setToneTemplates] = useState<InstructionTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  useEffect(() => {
    async function loadTemplates() {
      try {
        const templates = await callbotApi.getInstructionTemplates();
        setToneTemplates(templates.filter((t) => t.template_type === 'tone' && t.is_active));
      } catch (err) {
        console.error('Failed to load tone templates:', err);
      } finally {
        setLoadingTemplates(false);
      }
    }
    loadTemplates();
  }, []);

  const openEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setEditForm({
      name: agent.name,
      phoneWhatsapp: agent.phoneWhatsapp,
      companyName: agent.companyName,
      gender: agent.gender,
      toneTemplateId: agent.toneTemplateId,
      description: agent.description,
      enabled: agent.enabled,
    });
  };

  const handleUpdate = async () => {
    if (!editingAgent) return;
    try {
      setUpdating(true);
      setDeleteError(null);
      await callbotApi.updateAgent(String(editingAgent.id), editForm);
      setEditingAgent(null);
      setEditForm({});
      await refetch?.();
    } catch (err: any) {
      console.error('Failed to update agent:', err);
      setDeleteError(err?.message || t('agents.failedToUpdateAgent'));
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async (agentId: number) => {
    if (pendingDeleteId === agentId) {
      // Confirmation click - perform delete
      try {
        setDeleting(true);
        setDeleteError(null);
        console.log('Deleting agent:', agentId);
        const result = await callbotApi.deleteAgent(String(agentId));
        console.log('Delete result:', result);
        // deleteAgent throws on error, so if we get here, it succeeded
        setPendingDeleteId(null);
        console.log('Agent deleted, refetching list...');
        // Wait for refetch to complete
        await refetch?.();
        console.log('Refetch completed');
        setDeleteSuccess(t('agents.agentDeletedSuccess'));
        setTimeout(() => setDeleteSuccess(null), 3000);
      } catch (err: any) {
        console.error('Delete error caught:', err);
        console.error('Error type:', typeof err);
        console.error('Error instanceof Error:', err instanceof Error);
        console.error('Error.message:', err?.message);
        console.error('Error.toString():', err?.toString?.());
        console.error('Full error keys:', Object.keys(err || {}));
        const errorMsg = err?.message || err?.toString?.() || t('agents.failedToDeleteAgent');
        console.log('Final error message for UI:', errorMsg);
        setDeleteError(errorMsg);
        setPendingDeleteId(null);
      } finally {
        setDeleting(false);
      }
    } else {
      // First click - set pending
      console.log('Marking agent for deletion:', agentId);
      setPendingDeleteId(agentId);
    }
  };

  const cancelDelete = () => {
    setPendingDeleteId(null);
    setDeleteError(null);
  };

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-white mb-4">{t('agents.heading')}</h1>
        <div className="bg-slate-800 rounded-lg p-8 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-400">{t('agents.loadingAgents')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-white mb-4">{t('agents.heading')}</h1>
        <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 text-red-400">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-white">{t('agents.heading')}</h1>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-blue-600 text-[#fff] rounded hover:bg-blue-700 transition font-medium"
        >
          {t('agents.addAgent')}
        </button>
      </div>

      {deleteSuccess && (
        <div className="mb-4 p-4 bg-green-500/20 border border-green-500 rounded-lg text-green-400">
          {deleteSuccess}
        </div>
      )}

      {deleteError && (
        <div className="mb-4 p-4 bg-red-500/20 border border-red-500 rounded-lg text-red-400">
          {deleteError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {agents.length === 0 ? (
          <div className="col-span-full p-8 text-center text-gray-400">
            {t('agents.noAgentsFound')}
          </div>
        ) : (
          agents.map((agent) => {
            // Backend does not currently expose an enabled flag for agents.
            // Treat missing value as active to avoid false "Inactive" badges.
            const isActive = agent.enabled !== false;
            const isDeletePending = pendingDeleteId === Number(agent.id);

            return (
              <div key={agent.id} className="bg-slate-800 rounded-lg p-6 border border-slate-700 hover:border-blue-500 transition">
                <h3 className="text-xl font-semibold text-white mb-2">{agent.name}</h3>
                {agent.gender && <p className="text-sm text-gray-400">{t('agents.genderLabel')} <span className="capitalize">{agent.gender}</span></p>}
                {agent.description && <p className="text-sm text-gray-400 mt-2">{agent.description}</p>}
                <div className="mt-4 flex items-center justify-between mb-4">
                  <span className={`px-3 py-1 rounded text-xs font-medium ${
                    isActive ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                  }`}>
                    {isActive ? t('agents.active') : t('agents.inactive')}
                  </span>
                </div>

                {isDeletePending && (
                  <p className="text-xs text-red-400 mb-3">{t('agents.confirmDeleteClick')}</p>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => openEdit(agent)}
                    className="flex-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-[#fff] text-sm font-medium transition"
                  >
                    {t('agents.edit')}
                  </button>
                  <button
                    onClick={() => handleDelete(Number(agent.id))}
                    disabled={deleting}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
                      isDeletePending
                        ? 'bg-red-600 hover:bg-red-700 text-[#fff]'
                        : 'bg-slate-700 hover:bg-red-600/40 text-[#fff]'
                    } disabled:opacity-50`}
                  >
                    {deleting ? t('agents.deleting') : t('agents.delete')}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showForm && (
        <AddAgentForm
          onSuccess={() => {
            setShowForm(false);
            refetch?.();
          }}
          onClose={() => setShowForm(false)}
        />
      )}

      {editingAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{t('agents.editAgentTitle')}</h2>
              <button
                onClick={() => {
                  setEditingAgent(null);
                  setEditForm({});
                  setDeleteError(null);
                }}
                className="text-gray-400 hover:text-gray-300 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              {deleteError && (
                <div className="p-3 rounded-lg border border-red-500 bg-red-500/10 text-red-300 text-sm">
                  {deleteError}
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('agents.agentNameLabel')}</label>
                <input
                  value={editForm.name || ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('agents.genderSelectLabel')}</label>
                <select
                  value={editForm.gender || ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, gender: e.target.value ? (e.target.value as 'male' | 'female') : undefined }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                >
                  <option value="">{t('agents.selectGenderPlaceholder')}</option>
                  <option value="male">{t('agents.male')}</option>
                  <option value="female">{t('agents.female')}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('agents.companyNameLabel')}</label>
                <input
                  value={editForm.companyName || ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, companyName: e.target.value || undefined }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                  placeholder={t('agents.companyNamePlaceholder')}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('agents.whatsappPhoneLabel')}</label>
                <input
                  type="tel"
                  value={editForm.phoneWhatsapp || ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, phoneWhatsapp: e.target.value || undefined }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                  placeholder={t('agents.phonePlaceholder')}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('agents.toneTemplateLabel')}</label>
                <select
                  value={editForm.toneTemplateId || ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, toneTemplateId: e.target.value || undefined }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                  disabled={loadingTemplates}
                >
                  <option value="">{t('agents.selectToneTemplatePlaceholder')}</option>
                  {toneTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('agents.descriptionLabel')}</label>
                <textarea
                  value={editForm.description || ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value || undefined }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white min-h-20"
                  placeholder={t('agents.descriptionPlaceholder')}
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-300 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(editForm.enabled)}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                  />
                  {t('agents.enabledLabel')}
                </label>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-700">
                <button
                  onClick={handleUpdate}
                  disabled={updating || !editForm.name}
                  className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-[#fff] disabled:opacity-60 font-medium"
                >
                  {updating ? t('agents.saving') : t('agents.saveChanges')}
                </button>
                <button
                  onClick={() => {
                    setEditingAgent(null);
                    setEditForm({});
                    setDeleteError(null);
                  }}
                  className="flex-1 px-4 py-2 rounded-lg border border-slate-600 hover:bg-slate-700 text-gray-300 font-medium"
                >
                  {t('agents.cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
