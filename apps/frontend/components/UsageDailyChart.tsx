'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/language';

type Source = 'campaign' | 'manual' | 'external_api';

interface DailyPoint {
  date: string; // YYYY-MM-DD
  sources: Record<Source, { minutes: number; calls: number; costAzn: number }>;
  totalMinutes: number;
  totalCostAzn: number;
}

const SOURCE_ORDER: Source[] = ['campaign', 'manual', 'external_api'];
const SOURCE_COLORS: Record<Source, string> = {
  campaign: '#38bdf8', // sky-400
  manual: '#f59e0b', // amber-500
  external_api: '#34d399', // emerald-400
};

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 220;
const PADDING_LEFT = 44;
const PADDING_TOP = 14; // room for the topmost gridline's label, whose baseline would otherwise clip against the SVG's top edge
const PADDING_BOTTOM = 22;
const CHART_WIDTH = VIEW_WIDTH - PADDING_LEFT;
const CHART_HEIGHT = VIEW_HEIGHT - PADDING_BOTTOM - PADDING_TOP;
const BAR_GAP = 3;
const GRID_LINES = 4;

export function UsageDailyChart({ data, currency }: { data: DailyPoint[]; currency: string }) {
  const { t } = useLanguage();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const sourceLabels: Record<Source, string> = {
    campaign: t('usage.sourceCampaign'),
    manual: t('usage.sourceManual'),
    external_api: t('usage.sourceExternalApi'),
  };

  const maxCost = useMemo(() => Math.max(1, ...data.map((d) => d.totalCostAzn)), [data]);
  const barWidth = data.length > 0 ? CHART_WIDTH / data.length - BAR_GAP : 0;

  if (data.length === 0) return null;

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;
  const hoveredLeftPct = hoverIndex !== null
    ? ((PADDING_LEFT + (hoverIndex + 0.5) * (barWidth + BAR_GAP)) / VIEW_WIDTH) * 100
    : 0;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <span className="text-sm text-gray-300">{t('usage.dailyChart')}</span>
        <div className="flex items-center gap-4 text-xs text-gray-400">
          {SOURCE_ORDER.map((source) => (
            <span key={source} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: SOURCE_COLORS[source] }}
              />
              {sourceLabels[source]}
            </span>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height: 220 }}
        >
          {Array.from({ length: GRID_LINES + 1 }).map((_, i) => {
            const y = PADDING_TOP + (CHART_HEIGHT / GRID_LINES) * i;
            const value = maxCost * (1 - i / GRID_LINES);
            return (
              <g key={i}>
                <line x1={PADDING_LEFT} x2={VIEW_WIDTH} y1={y} y2={y} stroke="#334155" strokeWidth={1} />
                <text x={PADDING_LEFT - 6} y={y + 3} fontSize={10} fill="#64748b" textAnchor="end">
                  {value >= 10 ? Math.round(value) : value.toFixed(1)}
                </text>
              </g>
            );
          })}

          {data.map((point, i) => {
            const x = PADDING_LEFT + i * (barWidth + BAR_GAP);
            let yCursor = PADDING_TOP + CHART_HEIGHT;
            const segments = SOURCE_ORDER.map((source) => {
              const cost = point.sources[source]?.costAzn ?? 0;
              const segHeight = maxCost > 0 ? (cost / maxCost) * CHART_HEIGHT : 0;
              const y = yCursor - segHeight;
              yCursor = y;
              return { source, y, segHeight };
            });
            const dayNum = Number(point.date.slice(-2));
            const showLabel = dayNum === 1 || dayNum % 5 === 0 || i === data.length - 1;
            const dimmed = hoverIndex !== null && hoverIndex !== i;

            return (
              <g
                key={point.date}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex((cur) => (cur === i ? null : cur))}
              >
                {/* Full-height invisible hit target so hovering the gap above a short bar still works. */}
                <rect x={x} y={PADDING_TOP} width={Math.max(barWidth, 1)} height={CHART_HEIGHT} fill="transparent" />
                {segments.map(({ source, y, segHeight }) => (
                  segHeight > 0 ? (
                    <rect
                      key={source}
                      x={x}
                      y={y}
                      width={Math.max(barWidth, 1)}
                      height={segHeight}
                      fill={SOURCE_COLORS[source]}
                      opacity={dimmed ? 0.35 : 1}
                    />
                  ) : null
                ))}
                {showLabel && (
                  <text
                    x={x + barWidth / 2}
                    y={VIEW_HEIGHT - 6}
                    fontSize={10}
                    fill="#94a3b8"
                    textAnchor="middle"
                  >
                    {dayNum}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div
            className="absolute top-1 pointer-events-none bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs text-gray-200 shadow-lg z-10 whitespace-nowrap"
            style={{ left: `${hoveredLeftPct}%`, transform: 'translateX(-50%)' }}
          >
            <div className="font-semibold text-white mb-1">{hovered.date}</div>
            {SOURCE_ORDER.map((source) => {
              const seg = hovered.sources[source];
              if (!seg || seg.costAzn <= 0) return null;
              return (
                <div key={source} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-2 rounded-sm"
                    style={{ backgroundColor: SOURCE_COLORS[source] }}
                  />
                  <span>
                    {sourceLabels[source]}: {seg.costAzn.toFixed(2)} {currency}
                  </span>
                </div>
              );
            })}
            {hovered.totalCostAzn <= 0 ? (
              <div className="text-gray-400">{t('usage.noBillableCalls')}</div>
            ) : (
              <div className="mt-1 pt-1 border-t border-slate-700 text-gray-400">
                {t('usage.total')}: {hovered.totalCostAzn.toFixed(2)} {currency}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
