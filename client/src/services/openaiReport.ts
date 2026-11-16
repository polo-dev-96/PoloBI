import type {
  OpenAICostReport,
  OpenAIReport,
  OpenAIRecentUsage,
  OpenAIUsageReport,
} from "@shared/openai";

export type OpenAIPeriod = "month" | "today" | "7d" | "30d" | "custom";
const DAY = 86_400_000;
export function periodDates(
  period: Exclude<OpenAIPeriod, "custom">,
  now = new Date(),
) {
  const endDate = now.toISOString().slice(0, 10);
  const end = Date.parse(endDate);
  const start =
    period === "month"
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      : end - (period === "7d" ? 6 : period === "30d" ? 29 : 0) * DAY;
  return { startDate: new Date(start).toISOString().slice(0, 10), endDate };
}
export function dateRangeError(
  startDate: string,
  endDate: string,
  now = new Date(),
) {
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(startDate) || !valid(endDate)) return "Preencha as duas datas.";
  const days = (Date.parse(endDate) - Date.parse(startDate)) / DAY + 1;
  if (days < 1) return "A data final precisa ser igual ou posterior à inicial.";
  if (days > 90) return "Selecione um intervalo de até 90 dias.";
  if (endDate > now.toISOString().slice(0, 10))
    return "O período não pode incluir datas futuras.";
  return null;
}
export function modelRows(source?: OpenAIUsageReport) {
  const models = new Map<
    string,
    {
      model: string;
      input: number;
      output: number;
      cached: number;
      requests: number;
    }
  >();
  for (const row of source?.rows ?? []) {
    const model = row.model || "Modelo não informado";
    const value = models.get(model) ?? {
      model,
      input: 0,
      output: 0,
      cached: 0,
      requests: 0,
    };
    value.input += row.metrics.input_tokens ?? 0;
    value.output += row.metrics.output_tokens ?? 0;
    value.cached += row.metrics.input_cached_tokens ?? 0;
    value.requests += row.metrics.num_model_requests ?? 0;
    models.set(model, value);
  }
  return Array.from(models.values()).sort(
    (a, b) => b.requests - a.requests || a.model.localeCompare(b.model),
  );
}
export function dailySeries(
  report: OpenAIReport,
  currency: string,
  now = new Date(),
) {
  const today = now.toISOString().slice(0, 10);
  const usage = report.usage.find((source) => source.id === "completions");
  const consumption = new Map(
    usage?.daily.map((day) => [day.date, day.metrics]),
  );
  const costs = new Map(
    report.costs.daily.map((day) => [
      day.date,
      day.amounts.find((value) => value.currency === currency)?.amount,
    ]),
  );
  const series = [];
  for (
    let day = Date.parse(report.startDate);
    day <= Date.parse(report.endDate);
    day += DAY
  ) {
    const date = new Date(day).toISOString().slice(0, 10);
    const metrics = consumption.get(date);
    const isPartial = date >= today;
    const costPending =
      report.costs.status === "ok" &&
      isPartial &&
      costs.get(date) === undefined;
    series.push({
      date,
      label: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
      cost:
        report.costs.status === "ok" && !costPending
          ? Number(costs.get(date) ?? 0)
          : null,
      isPartial,
      costPending,
      input: usage?.status === "ok" ? (metrics?.input_tokens ?? 0) : null,
      output: usage?.status === "ok" ? (metrics?.output_tokens ?? 0) : null,
    });
  }
  return series;
}

export function previousMonthDate(date: string): string | null {
  const current = new Date(`${date}T00:00:00Z`);
  const day = current.getUTCDate();
  const previous = new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, day),
  );
  return previous.getUTCDate() === day
    ? previous.toISOString().slice(0, 10)
    : null;
}

export function previousMonthRanges(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (
    let day = Date.parse(startDate);
    day <= Date.parse(endDate);
    day += DAY
  ) {
    const previous = previousMonthDate(
      new Date(day).toISOString().slice(0, 10),
    );
    if (previous) dates.push(previous);
  }
  if (!dates.length) return [];
  const ranges: { startDate: string; endDate: string }[] = [];
  const last = Date.parse(dates[dates.length - 1]);
  // Uma janela atual de 90 dias pode ocupar até 93 dias ao deslocar o mês.
  // Dividir mantém o limite do endpoint e não perde dados nas extremidades.
  for (let day = Date.parse(dates[0]); day <= last; day += 90 * DAY) {
    ranges.push({
      startDate: new Date(day).toISOString().slice(0, 10),
      endDate: new Date(Math.min(last, day + 89 * DAY))
        .toISOString()
        .slice(0, 10),
    });
  }
  return ranges;
}

export type CostComparisonPoint = ReturnType<typeof dailySeries>[number] & {
  previousDate: string | null;
  previousCost: number | null;
};

export function costComparisonSeries(
  report: OpenAIReport,
  previousReports: readonly (
    | Pick<OpenAIReport, "startDate" | "endDate" | "projectId" | "costs">
    | undefined
  )[],
  currency: string,
  now = new Date(),
): CostComparisonPoint[] {
  const values = new Map<string, number>();
  for (const previous of previousReports) {
    if (
      previous?.costs.status !== "ok" ||
      (previous.projectId || undefined) !== (report.projectId || undefined)
    )
      continue;
    const amounts = new Map(
      previous.costs.daily.map((day) => [
        day.date,
        day.amounts.find((amount) => amount.currency === currency)?.amount ??
          "0",
      ]),
    );
    for (
      let day = Date.parse(previous.startDate);
      day <= Date.parse(previous.endDate);
      day += DAY
    ) {
      const date = new Date(day).toISOString().slice(0, 10);
      values.set(date, Number(amounts.get(date) ?? 0));
    }
  }
  return dailySeries(report, currency, now).map((point) => {
    const previousDate = previousMonthDate(point.date);
    return {
      ...point,
      previousDate,
      previousCost: previousDate ? (values.get(previousDate) ?? null) : null,
    };
  });
}

export type RankingDays = 1 | 7 | 15 | 30;
export function rankingDates(days: RankingDays, now = new Date()) {
  const endDate = now.toISOString().slice(0, 10);
  return {
    startDate: new Date(Date.parse(endDate) - (days - 1) * DAY)
      .toISOString()
      .slice(0, 10),
    endDate,
  };
}

export function currentDayCost(
  report: OpenAIReport | undefined,
  currency: string,
  now = new Date(),
) {
  if (report?.costs.status !== "ok") return null;
  const today = now.toISOString().slice(0, 10);
  return (
    report.costs.daily
      .find((day) => day.date === today)
      ?.amounts.find((value) => value.currency === currency)?.amount ?? null
  );
}

export function recentUsageSeries(report: OpenAIRecentUsage | undefined) {
  if (report?.status !== "ok") return [];
  return report.series.map((point) => ({
    timestamp: Date.parse(point.startTime),
    endTime: point.endTime,
    partial: point.partial,
    requests: point.metrics.num_model_requests ?? 0,
    input: point.metrics.input_tokens ?? 0,
    output: point.metrics.output_tokens ?? 0,
    cached: point.metrics.input_cached_tokens ?? 0,
  }));
}

export function tablePage(total: number, page: number, size: number) {
  const pageSize = Math.max(1, Math.floor(size));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.max(0, Math.min(Math.floor(page), pages - 1));
  return {
    page: current,
    pages,
    start: current * pageSize,
    end: Math.min(total, (current + 1) * pageSize),
  };
}

export function costPeriodChange(
  points: readonly CostComparisonPoint[],
  now = new Date(),
) {
  const today = now.toISOString().slice(0, 10);
  const comparable = points.filter(
    (point) => point.date < today && point.previousDate !== null,
  );
  if (
    !comparable.length ||
    comparable.some(
      (point) => point.cost === null || point.previousCost === null,
    )
  )
    return null;
  const current = comparable.reduce((sum, point) => sum + point.cost!, 0);
  const previous = comparable.reduce(
    (sum, point) => sum + point.previousCost!,
    0,
  );
  const delta = current - previous;
  return {
    current,
    previous,
    delta,
    direction: Math.abs(delta) < 1e-9 ? "equal" : delta > 0 ? "up" : "down",
    percent: previous > 0 ? (Math.abs(delta) / previous) * 100 : null,
    days: comparable.length,
    startDate: comparable[0].date,
    endDate: comparable[comparable.length - 1].date,
    previousStartDate: comparable[0].previousDate!,
    previousEndDate: comparable[comparable.length - 1].previousDate!,
    excludesToday: points.some((point) => point.date >= today),
  };
}

export function dailyCostPeak(
  points: readonly { date: string; cost: number | null }[],
) {
  let peak: { date: string; cost: number } | null = null;
  for (const point of points) {
    if (
      point.cost !== null &&
      point.cost > 0 &&
      (!peak || point.cost > peak.cost)
    )
      peak = { date: point.date, cost: point.cost };
  }
  return peak;
}

export function topProjectCosts(
  costs: OpenAICostReport | undefined,
  currency: string,
) {
  if (costs?.status !== "ok") return [];
  const projects = new Map<string, number>();
  for (const row of costs.rows) {
    if (row.currency !== currency || !row.projectId) continue;
    projects.set(
      row.projectId,
      (projects.get(row.projectId) ?? 0) + Number(row.amount),
    );
  }
  return Array.from(projects, ([projectId, amount]) => ({ projectId, amount }))
    .filter((project) => project.amount > 0)
    .sort(
      (a, b) => b.amount - a.amount || a.projectId.localeCompare(b.projectId),
    )
    .slice(0, 10);
}

export function monthlyProjection(
  report: OpenAIReport | undefined,
  now = new Date(),
) {
  const { startDate, endDate } = periodDates("month", now);
  const elapsedDays = (Date.parse(endDate) - Date.parse(startDate)) / DAY;
  if (
    report?.costs.status !== "ok" ||
    report.startDate !== startDate ||
    report.endDate !== endDate ||
    elapsedDays < 1
  )
    return null;
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return report.costs.totals.map((total) => {
    const closedDayCosts = report.costs.daily
      .filter((day) => day.date >= startDate && day.date < endDate)
      .reduce(
        (sum, day) =>
          sum +
          Number(
            day.amounts.find((amount) => amount.currency === total.currency)
              ?.amount ?? 0,
          ),
        0,
      );
    return {
      currency: total.currency,
      amount: Math.max(
        0,
        Number(total.amount),
        (closedDayCosts / elapsedDays) * daysInMonth,
      ),
      elapsedDays,
    };
  });
}
