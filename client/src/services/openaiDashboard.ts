export const OPENAI_CHARTS = ["costs", "recent", "monthly", "ranking"] as const;
export type OpenAIChart = (typeof OPENAI_CHARTS)[number];
export const OPENAI_CHART_VISIBILITY_KEY = "polo-bi-openai-hidden-charts";

export function parseHiddenCharts(saved: string | null): OpenAIChart[] {
  try {
    const value: unknown = saved ? JSON.parse(saved) : [];
    return Array.isArray(value)
      ? OPENAI_CHARTS.filter((chart) => value.includes(chart))
      : [];
  } catch {
    return [];
  }
}

export function chartLayout(hidden: readonly OpenAIChart[]) {
  const visible = OPENAI_CHARTS.filter((chart) => !hidden.includes(chart));
  const weights: Record<OpenAIChart, number> = {
    costs: 34,
    recent: 24,
    monthly: 21,
    ranking: 21,
  };
  const primary = visible.find(
    (chart) => chart === "costs" || chart === "recent",
  );
  const freed = OPENAI_CHARTS.filter(
    (chart) => !visible.includes(chart),
  ).reduce((sum, chart) => sum + weights[chart], 0);
  return {
    visible,
    columns: visible
      .map(
        (chart) =>
          `minmax(0, ${primary ? weights[chart] + (chart === primary ? freed : 0) : 1}fr)`,
      )
      .join(" "),
  };
}

export function sortDescending<T>(
  rows: readonly T[],
  value: (row: T) => number,
): T[] {
  return [...rows].sort((a, b) => value(b) - value(a));
}
