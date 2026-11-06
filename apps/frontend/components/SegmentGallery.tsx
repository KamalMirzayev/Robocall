'use client';

import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { callbotApi, type InstructionTemplate } from '@/lib/callbot-api';
import { useLanguage } from '@/lib/language';
import { SEGMENTS, SEGMENT_TONE_CLASSES, type Segment } from '@/lib/segments';

interface SegmentGalleryProps {
  templates: InstructionTemplate[];
  onCreated: () => void | Promise<void>;
  canEdit?: boolean;
}

export function SegmentGallery({ templates, onCreated, canEdit = true }: SegmentGalleryProps) {
  const { t, locale } = useLanguage();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const countFor = (segment: Segment) =>
    templates.filter((tpl) => tpl.template_type === 'base' && tpl.customer_category === segment.key).length;

  const addTemplate = async (segment: Segment) => {
    try {
      setBusyKey(segment.key);
      setError(null);
      setNotice(null);
      await callbotApi.createInstructionTemplate({
        tenant_id: 'default',
        version: 'v1.0',
        name: segment.title[locale],
        description: segment.summary[locale],
        content: segment.content,
        template_type: 'base',
        is_active: false,
        created_by: 'admin',
        customer_category: segment.key,
      });
      setNotice(t('segments.added'));
      await onCreated();
    } catch (err: any) {
      setError(err?.message || t('instructionTemplates.failedToCreate'));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="bg-slate-800 border border-slate-700 rounded-lg p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white">{t('segments.heading')}</h2>
        <p className="text-sm text-gray-400 mt-1">{t('segments.subtitle')}</p>
      </div>

      {error && (
        <div className="mb-3 p-3 rounded-lg border border-red-500 bg-red-500/10 text-red-300 text-sm">{error}</div>
      )}
      {notice && (
        <div className="mb-3 p-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-sm">{notice}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {SEGMENTS.map((segment) => {
          const tone = SEGMENT_TONE_CLASSES[segment.tone];
          const count = countFor(segment);
          const busy = busyKey === segment.key;
          return (
            <div key={segment.key} className="segment-card flex flex-col gap-3 p-4 rounded-lg border border-slate-700 bg-slate-900">
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} />
                <div className="min-w-0">
                  <div className="font-semibold text-white">{segment.title[locale]}</div>
                  <p className="text-xs text-gray-400 mt-1 leading-relaxed">{segment.summary[locale]}</p>
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between gap-2">
                {count > 0 ? (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-green-500/20 text-green-300">
                    <Check size={12} /> {count} {t('segments.templatesReady')}
                  </span>
                ) : (
                  <span className="text-xs text-gray-500">—</span>
                )}
                {canEdit && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => addTemplate(segment)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-60 ${
                      count > 0
                        ? 'border border-slate-600 text-gray-300 hover:bg-slate-700'
                        : 'bg-blue-600 hover:bg-blue-700 text-[#fff]'
                    }`}
                  >
                    <Plus size={13} />
                    {busy ? t('segments.adding') : count > 0 ? t('segments.addAnother') : t('segments.addTemplate')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
