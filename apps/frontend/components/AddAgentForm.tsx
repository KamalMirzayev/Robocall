'use client';

import { useState, useEffect } from 'react';
import callbotApi from '@/lib/callbot-api';
import { useLanguage } from '@/lib/language';

interface AddAgentFormProps {
  onSuccess: () => void;
  onClose: () => void;
}

interface InstructionTemplate {
  id: string;
  name: string;
  template_type: 'base' | 'tone' | 'system';
  is_active: boolean;
}

export default function AddAgentForm({ onSuccess, onClose }: AddAgentFormProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toneTemplates, setToneTemplates] = useState<InstructionTemplate[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    gender: 'female' as 'male' | 'female',
    toneTemplateId: '',
    phoneWhatsapp: '',
    companyName: '',
    description: '',
    enabled: true,
  });

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await callbotApi.createAgent(formData);
      if (result) {
        onSuccess();
        onClose();
      } else {
        setError(t('agentForm.failedToCreateAgent'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('agentForm.errorOccurred'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg max-w-md w-full">
        <div className="p-6 border-b border-slate-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">{t('agentForm.title')}</h2>
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
              {t('agentForm.agentNameLabel')}
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder={t('agentForm.namePlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('agentForm.genderLabel')}
              </label>
              <select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value as 'male' | 'female' })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500"
              >
                <option value="male">{t('agentForm.male')}</option>
                <option value="female">{t('agentForm.female')}</option>
              </select>
            </div>

          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('agentForm.toneTemplateLabel')}
            </label>
            <select
              value={formData.toneTemplateId}
              onChange={(e) => setFormData({ ...formData, toneTemplateId: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500"
              disabled={loadingTemplates}
            >
              <option value="">{t('agentForm.selectToneTemplatePlaceholder')}</option>
              {toneTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('agentForm.companyNameLabel')}
            </label>
            <input
              type="text"
              value={formData.companyName}
              onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder={t('agentForm.companyNamePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('agentForm.whatsappPhoneLabel')}
            </label>
            <input
              type="tel"
              value={formData.phoneWhatsapp}
              onChange={(e) => setFormData({ ...formData, phoneWhatsapp: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder={t('agentForm.phonePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('agentForm.descriptionLabel')}
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder={t('agentForm.descriptionPlaceholder')}
              rows={3}
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="enabled"
              checked={formData.enabled}
              onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
              className="w-4 h-4 rounded border-gray-500 text-blue-500 focus:ring-blue-500"
            />
            <label htmlFor="enabled" className="ml-2 text-sm text-gray-300">
              {t('agentForm.enableAgentLabel')}
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600 transition"
            >
              {t('agentForm.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t('agentForm.creating') : t('agentForm.createAgent')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
