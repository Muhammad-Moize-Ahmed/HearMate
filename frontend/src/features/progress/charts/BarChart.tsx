import { AxisBottom } from '@visx/axis';
import { Group } from '@visx/group';
import { scaleBand, scaleLinear } from '@visx/scale';
import { BarRounded } from '@visx/shape';
import { useState } from 'react';

import { BAR, GRID, INK, INK_SOFT } from './styles';
import { useWidth } from './useWidth';

const HEIGHT = 200;
const MARGIN = { top: 22, right: 8, bottom: 34, left: 8 };

/**
 * One bar per period. Counts are written on the bars when they fit, so no value axis is needed;
 * otherwise hovering (or tapping) a bar shows it, and the card's table lists them all.
 */
export function BarChart({
  labels,
  values,
  format,
  summary,
}: {
  labels: string[];
  values: number[];
  format: (value: number) => string;
  summary: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const indexes = labels.map((_, i) => i);
  const x = scaleBand({ domain: indexes, range: [0, innerWidth], padding: 0.25 });
  const y = scaleLinear({ domain: [0, Math.max(1, ...values)], range: [innerHeight, 0] });
  const bandwidth = x.bandwidth();
  const showValues = bandwidth >= 18;
  const maxLabels = Math.max(2, Math.floor(innerWidth / 70));
  const every = Math.ceil(labels.length / maxLabels);
  const xTicks = indexes.filter((i) => (labels.length - 1 - i) % every === 0);

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={summary}
        className="h-auto max-w-full overflow-visible"
      >
        <Group left={MARGIN.left} top={MARGIN.top}>
          {values.map((value, i) => {
            const left = x(i) ?? 0;
            const top = y(value);
            const height = innerHeight - top;
            return (
              <g
                key={i}
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              >
                {/* A taller invisible target, so small bars are easy to hover or tap. */}
                <rect x={left} y={0} width={bandwidth} height={innerHeight} fill="transparent" />
                {value > 0 && (
                  <BarRounded
                    x={left}
                    y={top}
                    width={bandwidth}
                    height={Math.max(2, height)}
                    radius={Math.min(4, bandwidth / 2)}
                    top
                    fill={BAR}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                )}
                {showValues && (
                  <text
                    x={left + bandwidth / 2}
                    y={top - 6}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={700}
                    fill={value > 0 ? INK : INK_SOFT}
                  >
                    {value}
                  </text>
                )}
              </g>
            );
          })}
          <AxisBottom
            top={innerHeight}
            scale={x}
            tickValues={xTicks}
            tickFormat={(i) => labels[Number(i)] ?? ''}
            stroke={GRID}
            hideTicks
            tickLabelProps={{ fill: INK_SOFT, fontSize: 12, textAnchor: 'middle' }}
          />
        </Group>
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-xl bg-white px-3 py-2 text-sm shadow-lg ring-1 ring-brand-100"
          style={{
            left: Math.min(
              Math.max(0, MARGIN.left + (x(hover) ?? 0) - 60),
              Math.max(0, width - 150),
            ),
          }}
        >
          <strong className="tabular-nums">{format(values[hover] ?? 0)}</strong>{' '}
          <span className="text-ink-soft">{labels[hover]}</span>
        </div>
      )}
    </div>
  );
}
