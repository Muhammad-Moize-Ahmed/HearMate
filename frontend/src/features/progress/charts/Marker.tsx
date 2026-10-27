import { SURFACE, type MarkerShape, type SeriesStyle } from './styles';

/** A marker centred on (x, y), with a white ring so overlapping points stay apart. */
export function Marker({
  shape,
  x,
  y,
  color,
  size = 9,
}: {
  shape: MarkerShape;
  x: number;
  y: number;
  color: string;
  size?: number;
}) {
  const r = size / 2;
  const ring = { stroke: SURFACE, strokeWidth: 2, paintOrder: 'stroke' as const };
  switch (shape) {
    case 'circle':
      return <circle cx={x} cy={y} r={r} fill={color} {...ring} />;
    case 'square':
      return <rect x={x - r} y={y - r} width={size} height={size} fill={color} {...ring} />;
    case 'triangle':
      return (
        <polygon
          points={`${x},${y - r - 1} ${x + r + 1},${y + r} ${x - r - 1},${y + r}`}
          fill={color}
          {...ring}
        />
      );
    case 'diamond':
      return (
        <polygon
          points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`}
          fill={color}
          {...ring}
        />
      );
    case 'cross':
      return (
        <path
          d={`M${x - r},${y - r}L${x + r},${y + r}M${x + r},${y - r}L${x - r},${y + r}`}
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
        />
      );
  }
}

/** The legend's swatch: a short line in the series' pattern with its marker. */
export function Swatch({ style }: { style: SeriesStyle }) {
  return (
    <svg width="34" height="14" aria-hidden="true" className="shrink-0">
      <line
        x1="2"
        x2="32"
        y1="7"
        y2="7"
        stroke={style.color}
        strokeWidth={2}
        strokeDasharray={style.dash}
      />
      <Marker shape={style.marker} x={17} y={7} color={style.color} size={8} />
    </svg>
  );
}
