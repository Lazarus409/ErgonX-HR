"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartTooltip, useChartAnimation } from "@/components/charts/ChartCard";
import { axisFormatter, dateAxisFormatter, formatValue, seriesColors, toNumber, type ValueFormat } from "@/components/charts/format";

export interface Series {
  key: string;
  label: string;
  color?: string;
  /** For composed charts. */
  type?: "bar" | "line" | "area";
  dashed?: boolean;
}

type Row = Record<string, unknown>;
/** Any plain record array (typed API interfaces lack an index signature). */
type RowInput = ReadonlyArray<object>;

const axisTick = { fill: "var(--chart-axis)", fontSize: 12 };
const tooltipCursor = { stroke: "var(--line-strong)", strokeWidth: 1, strokeDasharray: "4 4" };
const barCursor = { fill: "var(--surface-hover)" };

/** Counts never need fractional ticks (0.25 late arrivals is meaningless). */
function integerTicks(format: ValueFormat): boolean {
  return format !== "currency" && format !== "percent";
}

function yAxisWidth(format: ValueFormat): number {
  return format === "currency" ? 84 : 44;
}

function xFormatterFor(kind: "month" | "day" | "weekday" | "label") {
  return kind === "label" ? (value: unknown) => String(value ?? "") : dateAxisFormatter(kind);
}

/** Recharts reads numeric strings poorly in stacks; normalize decimal strings once. */
function numericRows(rows: RowInput, keys: string[]): Row[] {
  return rows.map((input) => {
    const row = input as Row;
    const next: Row = { ...row };
    for (const key of keys) next[key] = toNumber(row[key]);
    return next;
  });
}

/* -------------------------------------------------------------------------- */
/* Trend: line / multi-line / area / stacked area                              */
/* -------------------------------------------------------------------------- */

export interface TrendChartProps {
  data: RowInput;
  xKey: string;
  series: Series[];
  variant?: "line" | "area" | "stacked-area";
  format?: ValueFormat;
  currency?: string;
  xFormat?: "month" | "day" | "weekday" | "label";
  height?: number;
  zeroLine?: boolean;
}

export function TrendChart({ data, xKey, series, variant = "line", format = "number", currency, xFormat = "month", height = 240, zeroLine }: TrendChartProps) {
  const animate = useChartAnimation();
  const rows = numericRows(data, series.map((item) => item.key));
  const xFormatter = xFormatterFor(xFormat);
  // A line through one point is a lone dot; a single period reads as bars.
  if (rows.length === 1) {
    return <BarsChart data={data} xKey={xKey} series={series} mode={variant === "stacked-area" ? "stacked" : "grouped"} format={format} currency={currency} xFormat={xFormat} height={height} />;
  }
  const common = (
    <>
      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
      <XAxis dataKey={xKey} tickFormatter={xFormatter} tick={axisTick} tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
      <YAxis tickFormatter={axisFormatter(format, currency)} tick={axisTick} tickLine={false} axisLine={false} width={yAxisWidth(format)} allowDecimals={!integerTicks(format)} />
      <Tooltip cursor={tooltipCursor} content={(props) => <ChartTooltip {...props} format={format} currency={currency} labelFormat={xFormatter} />} />
      {zeroLine && <ReferenceLine y={0} stroke="var(--line-strong)" />}
    </>
  );

  if (variant === "line") {
    return (
      <LineChart data={rows} responsive style={{ width: "100%", height }} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        {common}
        {series.map((item, index) => (
          <Line key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={item.color ?? seriesColors[index % seriesColors.length]} strokeWidth={2.25} strokeDasharray={item.dashed ? "5 4" : undefined} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={animate} animationDuration={600} />
        ))}
      </LineChart>
    );
  }

  const stacked = variant === "stacked-area";
  return (
    <AreaChart data={rows} responsive style={{ width: "100%", height }} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
      <defs>
        {series.map((item, index) => {
          const color = item.color ?? seriesColors[index % seriesColors.length];
          return (
            <linearGradient key={item.key} id={`area-${item.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={stacked ? 0.5 : 0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={stacked ? 0.18 : 0.02} />
            </linearGradient>
          );
        })}
      </defs>
      {common}
      {series.map((item, index) => {
        const color = item.color ?? seriesColors[index % seriesColors.length];
        return <Area key={item.key} type="monotone" dataKey={item.key} name={item.label} stackId={stacked ? "stack" : undefined} stroke={color} strokeWidth={2} fill={`url(#area-${item.key})`} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={animate} animationDuration={600} />;
      })}
    </AreaChart>
  );
}

/* -------------------------------------------------------------------------- */
/* Bars: vertical / grouped / stacked / 100% / horizontal                      */
/* -------------------------------------------------------------------------- */

export interface BarsChartProps {
  data: RowInput;
  xKey: string;
  series: Series[];
  mode?: "grouped" | "stacked" | "percent";
  layout?: "vertical" | "horizontal";
  format?: ValueFormat;
  currency?: string;
  xFormat?: "month" | "day" | "weekday" | "label";
  height?: number;
  /** Per-bar colours for single-series categorical bars. */
  colorByIndex?: boolean;
}

export function BarsChart({ data, xKey, series, mode = "grouped", layout = "vertical", format = "number", currency, xFormat = "label", height = 240, colorByIndex }: BarsChartProps) {
  const animate = useChartAnimation();
  let rows = numericRows(data, series.map((item) => item.key));
  if (mode === "percent") {
    rows = rows.map((row) => {
      const total = series.reduce((sum, item) => sum + toNumber(row[item.key]), 0);
      const next: Row = { ...row };
      for (const item of series) next[item.key] = total ? (toNumber(row[item.key]) / total) * 100 : 0;
      return next;
    });
  }
  const valueFormat: ValueFormat = mode === "percent" ? "percent" : format;
  const categoryFormatter = xFormatterFor(xFormat);
  const horizontal = layout === "horizontal";
  const stackId = mode === "grouped" ? undefined : "stack";
  const hasNegative = rows.some((row) => series.some((item) => toNumber(row[item.key]) < 0));
  const radius = (index: number): [number, number, number, number] => {
    const last = stackId ? index === series.length - 1 : true;
    if (!last) return [0, 0, 0, 0];
    return horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0];
  };
  // Negative bars grow downward, so rounding only the "top" corners would round the baseline edge.
  const barRadius = (index: number) => (hasNegative ? 4 : radius(index));

  return (
    <BarChart data={rows} layout={horizontal ? "vertical" : "horizontal"} responsive style={{ width: "100%", height }} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={mode === "grouped" && series.length > 1 ? "22%" : "30%"} barGap={3}>
      <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--chart-grid)" />
      {horizontal ? (
        <>
          <XAxis type="number" tickFormatter={axisFormatter(valueFormat, currency)} tick={axisTick} tickLine={false} axisLine={false} domain={mode === "percent" ? [0, 100] : undefined} allowDecimals={!integerTicks(valueFormat)} />
          <YAxis type="category" dataKey={xKey} tickFormatter={categoryFormatter} tick={axisTick} tickLine={false} axisLine={false} width={112} />
        </>
      ) : (
        <>
          <XAxis dataKey={xKey} tickFormatter={categoryFormatter} tick={axisTick} tickLine={false} axisLine={false} tickMargin={8} minTickGap={8} />
          <YAxis tickFormatter={axisFormatter(valueFormat, currency)} tick={axisTick} tickLine={false} axisLine={false} width={yAxisWidth(valueFormat)} domain={mode === "percent" ? [0, 100] : undefined} allowDecimals={!integerTicks(valueFormat)} />
        </>
      )}
      <Tooltip cursor={barCursor} content={(props) => <ChartTooltip {...props} format={valueFormat} currency={currency} labelFormat={categoryFormatter} />} />
      {hasNegative && (horizontal ? <ReferenceLine x={0} stroke="var(--line-strong)" /> : <ReferenceLine y={0} stroke="var(--line-strong)" />)}
      {series.map((item, index) => {
        const color = item.color ?? seriesColors[index % seriesColors.length];
        return (
          <Bar key={item.key} dataKey={item.key} name={item.label} fill={color} stackId={stackId} radius={barRadius(index)} maxBarSize={horizontal ? 22 : 40} isAnimationActive={animate} animationDuration={500}>
            {colorByIndex && series.length === 1 && rows.map((_, rowIndex) => <Cell key={rowIndex} fill={seriesColors[rowIndex % seriesColors.length]} />)}
          </Bar>
        );
      })}
    </BarChart>
  );
}

/* -------------------------------------------------------------------------- */
/* Composed: bars + line (e.g. income/expense bars with net line)              */
/* -------------------------------------------------------------------------- */

export function ComposedTrendChart({ data, xKey, series, format = "number", currency, xFormat = "month", height = 260 }: Omit<TrendChartProps, "variant">) {
  const animate = useChartAnimation();
  const rows = numericRows(data, series.map((item) => item.key));
  const xFormatter = xFormatterFor(xFormat);
  if (rows.length === 1) {
    return <BarsChart data={data} xKey={xKey} series={series} format={format} currency={currency} xFormat={xFormat} height={height} />;
  }
  return (
    <ComposedChart data={rows} responsive style={{ width: "100%", height }} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={3} barCategoryGap="24%">
      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
      <XAxis dataKey={xKey} tickFormatter={xFormatter} tick={axisTick} tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
      <YAxis tickFormatter={axisFormatter(format, currency)} tick={axisTick} tickLine={false} axisLine={false} width={yAxisWidth(format)} allowDecimals={!integerTicks(format)} />
      <Tooltip cursor={barCursor} content={(props) => <ChartTooltip {...props} format={format} currency={currency} labelFormat={xFormatter} />} />
      <ReferenceLine y={0} stroke="var(--line-strong)" />
      {series.map((item, index) => {
        const color = item.color ?? seriesColors[index % seriesColors.length];
        if (item.type === "line") return <Line key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={color} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: color }} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={animate} />;
        if (item.type === "area") return <Area key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={color} fill={color} fillOpacity={0.12} isAnimationActive={animate} />;
        return <Bar key={item.key} dataKey={item.key} name={item.label} fill={color} radius={[5, 5, 0, 0]} maxBarSize={28} isAnimationActive={animate} />;
      })}
    </ComposedChart>
  );
}

/* -------------------------------------------------------------------------- */
/* Donut                                                                       */
/* -------------------------------------------------------------------------- */

export interface DonutDatum {
  label: string;
  value: number | string;
  color?: string;
}

export function DonutChart({ data, format = "number", currency, height = 220, centerLabel, centerValue }: { data: DonutDatum[]; format?: ValueFormat; currency?: string; height?: number; centerLabel?: string; centerValue?: string }) {
  const animate = useChartAnimation();
  const rows = data.map((item, index) => ({ name: item.label, value: toNumber(item.value), color: item.color ?? seriesColors[index % seriesColors.length] }));
  return (
    <div className="relative" style={{ height }}>
      <PieChart responsive style={{ width: "100%", height }}>
        <Tooltip content={(props) => <ChartTooltip {...props} format={format} currency={currency} />} />
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="92%" paddingAngle={rows.length > 1 ? 2 : 0} cornerRadius={4} stroke="var(--surface)" strokeWidth={2} isAnimationActive={animate} animationDuration={600}>
          {rows.map((row) => <Cell key={row.name} fill={row.color} />)}
        </Pie>
      </PieChart>
      {(centerLabel || centerValue) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {centerValue && <span className="text-kpi-sm font-semibold text-ink-strong tabular-nums">{centerValue}</span>}
          {centerLabel && <span className="text-caption text-ink-muted">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}

/** Legend rows for a donut, with share of total. */
export function donutLegend(data: DonutDatum[], format: ValueFormat = "number", currency?: string) {
  const total = data.reduce((sum, item) => sum + toNumber(item.value), 0);
  return data.map((item, index) => ({
    label: item.label,
    color: item.color ?? seriesColors[index % seriesColors.length],
    value: `${formatValue(item.value, format, currency)}${total ? ` · ${Math.round((toNumber(item.value) / total) * 100)}%` : ""}`,
  }));
}
