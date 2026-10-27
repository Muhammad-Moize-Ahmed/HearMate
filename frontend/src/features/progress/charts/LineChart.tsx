import { AxisBottom, AxisLeft } from '@visx/axis';
import { Group } from '@visx/group';
import { scaleLinear, scalePoint } from '@visx/scale';
import { Line, LinePath } from '@visx/shape';
import { useState, type PointerEvent } from 'react';

import { Marker } from './Marker';
import { GRID, INK_SOFT, type SeriesStyle } from './styles';
import { useWidth } from './useWidth';

export type LineSeries = {
  key: string;
  label: string;
  values: (number | null)[];
  style: SeriesStyle;
};

const HEIGHT = 240;
const MARGIN = { top: 14, right: 18, bottom: 34, left: 44 };

/**
 * Lines over time, sharing one y axis. Gaps (null) break the line. `step` draws levels as steps,
 * since a level changes at a point rather than gradually. Hovering shows every series at that
 * point; the same numbers are in the chart card's table.
 */
export function LineChart({
  labels,
  series,
  domain,
  yTicks,
  format,
  step = false,
  summary,
}: {
  labels: string[];
  series: LineSeries[];
  domain: [number, number];
  yTicks: number[];
  format: (value: number) => string;
  step?: boolean;
  summary: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const indexes = labels.map((_, i) => i);
  const x = scalePoint({ domain: indexes, range: [0, innerWidth], padding: 0.4 });
  const y = scaleLinear({ domain, range: [innerHeight, 0] });
  const xAt = (i: number) => x(i) ?? 0;
  const maxLabels = Math.max(2, Math.floor(innerWidth / 70));
  const every = Math.ceil(labels.length / maxLabels);
  const xTicks = indexes.filter((i) => (labels.length - 1 - i) % every === 0);

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const scale = box.width > 0 ? innerWidth / box.width : 1;
    const px = (event.clientX - box.left) * scale;
    let nearest = 0;
    for (const i of indexes) if (Math.abs(xAt(i) - px) < Math.abs(xAt(nearest) - px)) nearest = i;
    setHover(nearest);
  };

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={summary}
        className="h-auto max-w-full touch-pan-y overflow-visible"
      >
        <Group left={MARGIN.left} top={MARGIN.top}>
          {yTicks.map((tick) => (
            <line key={tick} x1={0} x2={innerWidth} y1={y(tick)} y2={y(tick)} stroke={GRID} />
          ))}
          <AxisLeft
            scale={y}
            tickValues={yTicks}
            tickFormat={(v) => format(Number(v))}
            hideAxisLine
            hideTicks
            tickLabelProps={{ fill: INK_SOFT, fontSize: 12, textAnchor: 'end', dx: -4, dy: 4 }}
          />
          <AxisBottom
            top={innerHeight}
            scale={x}
            tickValues={xTicks}
            tickFormat={(i) => labels[Number(i)] ?? ''}
            stroke={GRID}
            hideTicks
            tickLabelProps={{ fill: INK_SOFT, fontSize: 12, textAnchor: 'middle' }}
          />
          {hover !== null && (
            <Line
              from={{ x: xAt(hover), y: 0 }}
              to={{ x: xAt(hover), y: innerHeight }}
              stroke={INK_SOFT}
              strokeDasharray="3 3"
            />
          )}
          {series.map((s) => {
            const points = s.values.map((value, i) => ({ i, value }));
            const drawn = step ? stepped(points) : points;
            return (
              <g key={s.key}>
                <LinePath
                  data={drawn}
                  x={(p) => xAt(p.i)}
                  y={(p) => y(p.value ?? 0)}
                  defined={(p) => p.value !== null}
                  stroke={s.style.color}
                  strokeWidth={2}
                  strokeDasharray={s.style.dash}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {points.map(
                  (p) =>
                    p.value !== null &&
                    (!step || isChange(s.values, p.i) || p.i === hover) && (
                      <Marker
                        key={p.i}
                        shape={s.style.marker}
                        x={xAt(p.i)}
                        y={y(p.value)}
                        color={s.style.color}
                        size={p.i === hover ? 11 : 9}
                      />
                    ),
                )}
              </g>
            );
          })}
          <rect
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </Group>
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-xl bg-white px-3 py-2 text-sm shadow-lg ring-1 ring-brand-100"
          style={{
            left: Math.min(Math.max(0, MARGIN.left + xAt(hover) - 80), Math.max(0, width - 170)),
          }}
        >
          <p className="font-bold">{labels[hover]}</p>
          <ul>
            {series.map((s) => {
              const value = s.values[hover];
              return (
                <li key={s.key} className="flex items-center gap-1.5">
                  <svg width="10" height="10" aria-hidden="true">
                    <Marker shape={s.style.marker} x={5} y={5} color={s.style.color} size={8} />
                  </svg>
                  <strong className="tabular-nums">
                    {value === null || value === undefined ? '–' : format(value)}
                  </strong>
                  <span className="text-ink-soft">{s.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

type Point = { i: number; value: number | null };

/** For a step line: hold each value until the next point, then jump. */
function stepped(points: Point[]): Point[] {
  return points.flatMap((p, k) => {
    const before = points[k - 1];
    return before && before.value !== null && p.value !== null && before.value !== p.value
      ? [{ i: p.i, value: before.value }, p]
      : [p];
  });
}

/** On a step line only the first point and the points where the value changes get a marker. */
function isChange(values: (number | null)[], i: number): boolean {
  return i === 0 || values[i] !== values[i - 1] || i === values.length - 1;
}
