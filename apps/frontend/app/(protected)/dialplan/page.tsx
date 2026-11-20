'use client';

import { useEffect, useState } from 'react';
import { useDialplanRules } from '@/hooks/useTelephony';
import { DialplanRule } from '@/types/telephony';
import { telephonyApi } from '@/lib/telephony-api-client';
import { useLanguage } from '@/lib/language';

interface EditingItem {
  id?: string;
}

export default function DialplanPage() {
  const { t } = useLanguage();
  const { rules: initialRules, loading, error: fetchError } = useDialplanRules();
  const [rules, setRules] = useState<DialplanRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingItem | null>(null);
  const [ruleForm, setRuleForm] = useState<Partial<DialplanRule>>({
    pattern: '',
    priority: 1,
    route_type: 'extension',
    route_target: '',
    description: '',
    enabled: true,
  });

  useEffect(() => {
    setRules(initialRules || []);
  }, [initialRules]);

  const handleEditRule = (rule: DialplanRule) => {
    setRuleForm(rule);
    setEditing({ id: rule.id });
  };

  const handleSaveRule = async () => {
    try {
      if (editing?.id) {
        await telephonyApi.updateDialplanRule(editing.id, ruleForm);
        setSuccess(t('dialplan.ruleUpdated'));
      } else {
        await telephonyApi.createDialplanRule(ruleForm as Omit<DialplanRule, 'id' | 'created_at' | 'updated_at'>);
        setSuccess(t('dialplan.ruleCreated'));
      }
      setEditing(null);
      setRuleForm({
        pattern: '',
        priority: 1,
        route_type: 'extension',
        route_target: '',
        description: '',
        enabled: true,
      });
      // Refetch data
      const updatedRules = await telephonyApi.getDialplanRules();
      setRules(updatedRules || []);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(t('dialplan.saveError'));
      console.error(err);
    }
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-white">{t('dialplan.heading')}</h1>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              try {
                setError(null);
                setSuccess(null);
                await telephonyApi.render();
                setSuccess(t('dialplan.configGenerateSuccess'));
                setTimeout(() => setSuccess(null), 3000);
              } catch (err) {
                setError(t('dialplan.configGenerateError'));
                console.error(err);
              }
            }}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-[#fff] rounded font-medium"
          >
            {t('dialplan.generateReload')}
          </button>
          <button
            onClick={() => {
              setRuleForm({
                pattern: '',
                priority: 1,
                route_type: 'extension',
                route_target: '',
                description: '',
                enabled: true,
              });
              setEditing({});
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[#fff] rounded"
          >
            {t('dialplan.addRule')}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/20 border border-red-500 rounded text-red-300">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-green-500/20 border border-green-500 rounded text-green-300">
          {success}
        </div>
      )}

      {editing && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 mb-8">
          <h2 className="text-xl font-semibold text-white mb-6">{editing.id ? t('dialplan.editRuleTitle') : t('dialplan.createRuleTitle')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder={t('dialplan.patternPlaceholder')}
              value={ruleForm.pattern || ''}
              onChange={(e) => setRuleForm({ ...ruleForm, route_type: e.target.value as "extension" | "trunk" | "ivr" | "ai_agent" | "hangup" })}
              className="px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white col-span-2"
            />
            <input
              type="number"
              placeholder={t('dialplan.priorityPlaceholder')}
              value={ruleForm.priority || 1}
              onChange={(e) => setRuleForm({ ...ruleForm, priority: Number(e.target.value) })}
              className="px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white"
            />
            <select
              value={ruleForm.route_type || 'extension'}
              onChange={(e) => setRuleForm({ ...ruleForm, route_type: e.target.value as "extension" | "trunk" | "ivr" | "ai_agent" | "hangup" })}
              className="px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white"
            >
              <option value="extension">{t('dialplan.routeTypeExtension')}</option>
              <option value="ivr">{t('dialplan.routeTypeIVR')}</option>
              <option value="ai_agent">{t('dialplan.routeTypeAIAgent')}</option>
              <option value="external">{t('dialplan.routeTypeExternal')}</option>
            </select>
            <input
              type="text"
              placeholder={t('dialplan.routeTargetPlaceholder')}
              value={ruleForm.route_target || ''}
              onChange={(e) => setRuleForm({ ...ruleForm, route_target: e.target.value })}
              className="px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white col-span-2"
            />
            <textarea
              placeholder={t('dialplan.descriptionPlaceholder')}
              value={ruleForm.description || ''}
              onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })}
              className="px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white col-span-2"
              rows={2}
            />
            <label className="flex items-center text-gray-300">
              <input
                type="checkbox"
                checked={ruleForm.enabled || false}
                onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.checked })}
                className="mr-2"
              />
              {t('dialplan.enabled')}
            </label>
          </div>
          <div className="flex gap-2 mt-6">
            <button
              onClick={handleSaveRule}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-[#fff] rounded"
            >
              {t('dialplan.saveRule')}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded"
            >
              {t('dialplan.cancel')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400">{t('dialplan.loadingRules')}</div>
      ) : (
        <div className="space-y-3">
          {rules.length === 0 ? (
            <div className="bg-slate-800 rounded-lg p-6 text-gray-400">
              {t('dialplan.noRules')}
            </div>
          ) : (
            rules.map((rule) => (
              <div key={rule.id} className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <div className="flex items-center gap-4 mb-3">
                  <div className="bg-slate-900 px-3 py-1 rounded font-mono text-sm font-semibold text-blue-400">
                    {t('dialplan.priorityLabel')} {rule.priority}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm text-gray-400">{t('dialplan.patternLabel')}</div>
                    <div className="font-mono text-white text-lg">{rule.pattern}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEditRule(rule)}
                      className="px-3 py-1 bg-blue-500/20 text-blue-300 rounded text-sm"
                    >
                      {t('dialplan.edit')}
                    </button>
                    <div className={`px-3 py-1 rounded text-sm font-semibold ${
                      rule.route_type === 'ai_agent' ? 'bg-purple-500/20 text-purple-300' :
                      rule.route_type === 'ivr' ? 'bg-blue-500/20 text-blue-300' :
                      rule.route_type === 'extension' ? 'bg-green-500/20 text-green-300' :
                      'bg-gray-500/20 text-gray-300'
                    }`}>
                      {rule.route_type}
                    </div>
                    <div className={`px-3 py-1 rounded text-sm font-semibold ${
                      rule.enabled ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                    }`}>
                      {rule.enabled ? t('dialplan.enabledStatus') : t('dialplan.disabledStatus')}
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-700">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-gray-400">{t('dialplan.targetLabel')}</div>
                      <div className="font-mono text-white">{rule.route_target || '—'}</div>
                    </div>
                    <div>
                      <div className="text-gray-400">{t('dialplan.descriptionLabel')}</div>
                      <div className="text-white">{rule.description || '—'}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
