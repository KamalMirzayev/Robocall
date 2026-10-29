'use client';

import { useEffect, useState } from 'react';
import { useTelephony } from '@/hooks/useTelephony';
import { IVRMenu } from '@/types/telephony';
import { telephonyApi } from '@/lib/telephony-api-client';
import { useLanguage } from '@/lib/language';

interface EditingItem {
  id?: string;
}

export default function IVRPage() {
  const { t } = useLanguage();
  const { ivrs: initialIVRs, loading, error: fetchError } = useTelephony();
  const [ivrs, setIVRs] = useState<IVRMenu[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingItem | null>(null);
  const [ivrForm, setIvrForm] = useState<Partial<IVRMenu>>({
    name: '',
    extension: '',
    prompt: '',
    timeout_seconds: 5,
    invalid_target: '',
    enabled: true,
    options: [],
  });

  useEffect(() => {
    setIVRs(initialIVRs || []);
  }, [initialIVRs]);

  const handleEditIVR = (ivr: IVRMenu) => {
    setIvrForm(ivr);
    setEditing({ id: ivr.id });
  };

  const handleSaveIVR = async () => {
    try {
      if (editing?.id) {
        await telephonyApi.updateIVRMenu(editing.id, ivrForm);
        setSuccess(t('ivr.menuUpdated'));
      } else {
        await telephonyApi.createIVRMenu(ivrForm as Omit<IVRMenu, 'id' | 'created_at' | 'updated_at'>);
        setSuccess(t('ivr.menuCreated'));
      }
      setEditing(null);
      setIvrForm({
        name: '',
        extension: '',
        prompt: '',
        timeout_seconds: 5,
        invalid_target: '',
        enabled: true,
        options: [],
      });
      // Refetch data
      const updatedIVRs = await telephonyApi.getIVRMenus();
      setIVRs(updatedIVRs || []);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(t('ivr.saveError'));
      console.error(err);
    }
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-white">{t('ivr.heading')}</h1>
        <button
          onClick={async () => {
            try {
              setError(null);
              setSuccess(null);
              await telephonyApi.render();
              setSuccess(t('ivr.configGenerateSuccess'));
              setTimeout(() => setSuccess(null), 3000);
            } catch (err) {
              setError(t('ivr.configGenerateError'));
              console.error(err);
            }
          }}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded font-medium"
        >
          {t('ivr.generateReload')}
        </button>
        <button
          onClick={() => {
            setIvrForm({
              name: '',
              extension: '',
              prompt: '',
              timeout_seconds: 5,
              invalid_target: '',
              enabled: true,
              options: [],
            });
            setEditing({});
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
        >
          {t('ivr.addMenu')}
        </button>
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
          <h2 className="text-xl font-semibold text-white mb-6">{editing.id ? t('ivr.editMenuTitle') : t('ivr.createMenuTitle')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder={t('ivr.namePlaceholder')}
              value={ivrForm.name || ''}
              onChange={(e) => setIvrForm({ ...ivrForm, name: e.target.value })}
              className="px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white"
            />
            <input
              type="text"
              placeholder={t('ivr.extensionPlaceholder')}
              value={ivrForm.extension || ''}
              onChange={(e) => setIvrForm({ ...ivrForm, extension: e.target.value })}
              className="px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white"
            />
            <textarea
              placeholder={t('ivr.promptPlaceholder')}
              value={ivrForm.prompt || ''}
              onChange={(e) => setIvrForm({ ...ivrForm, prompt: e.target.value })}
              className="px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white col-span-2"
              rows={3}
            />
            <input
              type="number"
              placeholder={t('ivr.timeoutPlaceholder')}
              value={ivrForm.timeout_seconds || 5}
              onChange={(e) => setIvrForm({ ...ivrForm, timeout_seconds: Number(e.target.value) })}
              className="px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white"
            />
            <input
              type="text"
              placeholder={t('ivr.invalidTargetPlaceholder')}
              value={ivrForm.invalid_target || ''}
              onChange={(e) => setIvrForm({ ...ivrForm, invalid_target: e.target.value })}
              className="px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white"
            />
            <label className="flex items-center text-gray-300">
              <input
                type="checkbox"
                checked={ivrForm.enabled || false}
                onChange={(e) => setIvrForm({ ...ivrForm, enabled: e.target.checked })}
                className="mr-2"
              />
              {t('ivr.enabled')}
            </label>
          </div>
          <div className="flex gap-2 mt-6">
            <button
              onClick={handleSaveIVR}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
            >
              {t('ivr.saveMenu')}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded"
            >
              {t('ivr.cancel')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400">{t('ivr.loadingMenus')}</div>
      ) : (
        <div className="space-y-4">
          {ivrs.length === 0 ? (
            <div className="bg-slate-800 rounded-lg p-6 text-gray-400">
              {t('ivr.noMenus')}
            </div>
          ) : (
            ivrs.map((ivr) => (
              <div key={ivr.id} className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-white">{ivr.name}</h2>
                    <p className="text-gray-400">{t('ivr.extensionLabel')} <span className="font-mono">{ivr.extension}</span></p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEditIVR(ivr)}
                      className="px-3 py-1 bg-blue-500/20 text-blue-300 rounded text-sm"
                    >
                      {t('ivr.edit')}
                    </button>
                    <div className={`px-3 py-1 rounded text-sm font-semibold ${
                      ivr.enabled ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                    }`}>
                      {ivr.enabled ? t('ivr.enabledStatus') : t('ivr.disabledStatus')}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-gray-400">{t('ivr.promptLabel')}</div>
                    <div className="text-white font-mono">{ivr.prompt}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">{t('ivr.timeoutLabel')}</div>
                    <div className="text-white">{ivr.timeout_seconds} {t('ivr.secondsSuffix')}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-gray-400">{t('ivr.invalidTargetLabel')}</div>
                    <div className="text-white">{ivr.invalid_target}</div>
                  </div>
                </div>

                {ivr.options && ivr.options.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-700">
                    <div className="text-gray-400 mb-2">{t('ivr.menuOptionsLabel')}</div>
                    <div className="space-y-2">
                      {ivr.options.map((option, idx) => (
                        <div key={idx} className="text-sm bg-slate-900 p-2 rounded">
                          <span className="font-mono text-blue-400">{option.digit}</span>
                          {' → '}
                          <span className="text-gray-300">{option.label || option.target_type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
