"use client";

/**
 * Minimal hand-rolled SVG line/area chart — no charting library dependency.
 * This app has already hit two dependency-version conflicts this session
 * (RainbowKit/wagmi v2 vs v3, @farcaster/frame-wagmi-connector peer deps),
 * and the mockup's charts are simple enough not to need recharts/d3/etc.
 */
export function LineAreaChart({
  data,
  width = 320,
  height = 96,
  stroke = "#22d3ee",
  fillFrom = "rgba(34, 211, 238, 0.35)",
  fillTo = "rgba(34, 211, 238, 0)",
}: {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fillFrom?: string;
  fillTo?: string;
}) {
  const gradientId = `line-area-gradient-${stroke.replace(/[^a-z0-9]/gi, "")}`;

  if (data.length === 0) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center text-xs text-gray-500"
      >
        No data yet
      </div>
    );
  }

  const padding = 6;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x =
      data.length === 1
        ? width / 2
        : padding + (index / (data.length - 1)) * (width - padding * 2);
    const y =
      height - padding - ((value - min) / range) * (height - padding * 2);
    return [x, y];
  });

  const linePath = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");

  const areaPath = `${linePath} L ${points[points.length - 1][0].toFixed(2)} ${height} L ${points[0][0].toFixed(2)} ${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillFrom} />
          <stop offset="100%" stopColor={fillTo} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 4px ${stroke})` }}
      />
    </svg>
  );
}
