import test from "node:test";
import assert from "node:assert/strict";
import {
  periodDates,
  dateRangeError,
  modelRows,
  dailySeries,
  monthlyProjection,
  topProjectCosts,
  previousMonthDate,
  previousMonthRanges,
  costComparisonSeries,
  dailyCostPeak,
  costPeriodChange,
} from "./openaiReport";
import { moneyFormat } from "../components/openai-monitoring";
import type { OpenAIReport } from "../../../shared/openai";

test("períodos usam dias UTC e contam o dia atual inclusive", () => {
  const now = new Date("2026-11-13T23:00:00-04:00");
  assert.deepEqual(periodDates("month", now), {
    startDate: "2026-11-01",
    endDate: "2026-11-14",
  });
  assert.deepEqual(periodDates("7d", now), {
    startDate: "2026-11-08",
    endDate: "2026-11-14",
  });
  assert.deepEqual(periodDates("today", now), {
    startDate: "2026-11-14",
    endDate: "2026-11-14",
  });
  assert.equal(dateRangeError("2026-11-01", "2026-11-14", now), null);
  assert.ok(dateRangeError("2026-11-01", "2026-11-15", now));
  assert.ok(dateRangeError("2026-01-01", "2026-04-01", now));
  assert.ok(dateRangeError("2026-11-03", "2026-11-02", now));
  assert.ok(dateRangeError("2026-02-30", "2026-03-01", now));
});

const report: OpenAIReport = {
  startDate: "2026-01-01",
  endDate: "2026-01-03",
  fetchedAt: "2026-01-04T00:00:00Z",
  costs: {
    status: "ok",
    fetchedAt: "2026-01-04T00:00:00Z",
    totals: [{ currency: "USD", amount: "0.1" }],
    rows: [],
    daily: [
      { date: "2026-01-01", amounts: [{ currency: "USD", amount: "0.1" }] },
    ],
  },
  usage: [
    {
      id: "completions",
      label: "Conversações",
      status: "ok",
      fetchedAt: "2026-01-04T00:00:00Z",
      totals: {
        input_tokens: 100,
        input_cached_tokens: 60,
        num_model_requests: 3,
      },
      daily: [{ date: "2026-01-01", metrics: { input_tokens: 100 } }],
      rows: [
        {
          projectId: "a",
          model: "modelo",
          metrics: {
            input_tokens: 50,
            input_cached_tokens: 30,
            num_model_requests: 1,
          },
        },
        {
          projectId: "b",
          model: "modelo",
          metrics: {
            input_tokens: 50,
            input_cached_tokens: 30,
            num_model_requests: 2,
          },
        },
      ],
    },
  ],
};
test("modelos somam projetos sem duplicar cache nos tokens de entrada", () => {
  assert.deepEqual(modelRows(report.usage[0]), [
    { model: "modelo", input: 100, output: 0, cached: 60, requests: 3 },
  ]);
});
test("gráficos preenchem dias vazios e distinguem falha de consumo zero", () => {
  const days = dailySeries(report, "USD");
  assert.equal(days.length, 3);
  assert.equal(days[0].cost, 0.1);
  assert.equal(days[1].cost, 0);
  assert.equal(days[1].input, 0);
  const failed: OpenAIReport = {
    ...report,
    costs: { ...report.costs, status: "error" },
    usage: [{ ...report.usage[0], status: "error" }],
  };
  assert.equal(dailySeries(failed, "USD")[1].cost, null);
  assert.equal(dailySeries(failed, "USD")[1].input, null);
});

test("valores monetários são apresentados com duas casas sem perder o dado original", () => {
  const original = "190.639796";
  assert.equal(moneyFormat(original, "USD").replace(/\s/g, " "), "US$ 190,64");
  assert.equal(original, "190.639796");
});

test("ranking soma itens por projeto, separa moedas, abate créditos e limita a dez", () => {
  const costs: OpenAIReport["costs"] = {
    ...report.costs,
    rows: [
      { projectId: "a", lineItem: "entrada", currency: "USD", amount: "100" },
      { projectId: "a", lineItem: "saída", currency: "USD", amount: "50" },
      { projectId: "a", lineItem: "crédito", currency: "USD", amount: "-20" },
      {
        projectId: "a",
        lineItem: "outra moeda",
        currency: "EUR",
        amount: "9000",
      },
      {
        projectId: null,
        lineItem: "sem projeto",
        currency: "USD",
        amount: "9999",
      },
      ...["b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].map((id, index) => ({
        projectId: id,
        lineItem: null,
        currency: "USD",
        amount: String(120 - index * 10),
      })),
      {
        projectId: "credit-only",
        lineItem: null,
        currency: "USD",
        amount: "-5",
      },
    ],
  };
  assert.deepEqual(topProjectCosts(costs, "USD"), [
    { projectId: "a", amount: 130 },
    { projectId: "b", amount: 120 },
    { projectId: "c", amount: 110 },
    { projectId: "d", amount: 100 },
    { projectId: "e", amount: 90 },
    { projectId: "f", amount: 80 },
    { projectId: "g", amount: 70 },
    { projectId: "h", amount: 60 },
    { projectId: "i", amount: 50 },
    { projectId: "j", amount: 40 },
  ]);
  assert.deepEqual(topProjectCosts(costs, "EUR"), [
    { projectId: "a", amount: 9000 },
  ]);
  assert.deepEqual(topProjectCosts({ ...costs, status: "error" }, "USD"), []);
  assert.deepEqual(topProjectCosts(undefined, "USD"), []);
});

const monthReport: OpenAIReport = {
  ...report,
  startDate: "2026-11-01",
  endDate: "2026-11-13",
  costs: {
    ...report.costs,
    totals: [
      { currency: "USD", amount: "190" },
      { currency: "EUR", amount: "65" },
    ],
    daily: [
      {
        date: "2026-11-01",
        amounts: [
          { currency: "USD", amount: "120" },
          { currency: "EUR", amount: "60" },
        ],
      },
      { date: "2026-11-12", amounts: [{ currency: "USD", amount: "60" }] },
      {
        date: "2026-11-13",
        amounts: [
          { currency: "USD", amount: "10" },
          { currency: "EUR", amount: "5" },
        ],
      },
    ],
  },
};
test("projeção usa dias UTC completos, inclui dias sem gasto e calcula cada moeda separadamente", () => {
  assert.deepEqual(
    monthlyProjection(monthReport, new Date("2026-11-13T18:00:00Z")),
    [
      { currency: "USD", amount: 450, elapsedDays: 12 },
      { currency: "EUR", amount: 150, elapsedDays: 12 },
    ],
  );
});
test("projeção não fica abaixo do gasto observado e respeita a duração real do mês", () => {
  const leapMonth: OpenAIReport = {
    ...monthReport,
    startDate: "2028-02-01",
    endDate: "2028-02-15",
    costs: {
      ...monthReport.costs,
      totals: [{ currency: "USD", amount: "14" }],
      daily: [
        { date: "2028-02-14", amounts: [{ currency: "USD", amount: "14" }] },
      ],
    },
  };
  const now = new Date("2028-02-15T12:00:00Z");
  assert.equal(monthlyProjection(leapMonth, now)?.[0].amount, 29);
  assert.equal(
    monthlyProjection(
      {
        ...leapMonth,
        costs: {
          ...leapMonth.costs,
          totals: [{ currency: "USD", amount: "500" }],
        },
      },
      now,
    )?.[0].amount,
    500,
  );
});
test("projeção não usa períodos incompletos, primeiro dia ou fontes indisponíveis", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  assert.equal(monthlyProjection(report, now), null);
  assert.equal(monthlyProjection(undefined, now), null);
  assert.equal(
    monthlyProjection({ ...monthReport, startDate: "2026-11-02" }, now),
    null,
  );
  assert.equal(
    monthlyProjection(
      { ...monthReport, costs: { ...monthReport.costs, status: "error" } },
      now,
    ),
    null,
  );
  assert.equal(
    monthlyProjection(
      { ...monthReport, endDate: "2026-11-01" },
      new Date("2026-11-01T12:00:00Z"),
    ),
    null,
  );
  assert.deepEqual(
    monthlyProjection(
      {
        ...monthReport,
        costs: { ...monthReport.costs, totals: [], daily: [] },
      },
      now,
    ),
    [],
  );
});

test("comparação mensal respeita virada de ano e dias inexistentes sem repetir o último dia", () => {
  assert.equal(previousMonthDate("2026-11-13"), "2026-10-13");
  assert.equal(previousMonthDate("2026-01-01"), "2025-12-01");
  assert.equal(previousMonthDate("2026-03-29"), null);
  assert.equal(previousMonthDate("2026-03-31"), null);
  assert.equal(previousMonthDate("2028-03-29"), "2028-02-29");
  assert.deepEqual(previousMonthRanges("2026-11-01", "2026-11-13"), [
    { startDate: "2026-10-01", endDate: "2026-10-13" },
  ]);
  assert.deepEqual(previousMonthRanges("2026-03-01", "2026-03-31"), [
    { startDate: "2026-02-01", endDate: "2026-02-28" },
  ]);
  assert.deepEqual(previousMonthRanges("2026-03-29", "2026-03-31"), []);
});

test("intervalo deslocado maior que 90 dias é dividido sem perder ou duplicar as extremidades", () => {
  assert.deepEqual(previousMonthRanges("2026-02-01", "2026-05-01"), [
    { startDate: "2026-01-01", endDate: "2026-03-31" },
    { startDate: "2026-04-01", endDate: "2026-04-01" },
  ]);
});

const previousMonth: OpenAIReport = {
  ...monthReport,
  startDate: "2026-10-01",
  endDate: "2026-10-13",
  costs: {
    ...monthReport.costs,
    totals: [{ currency: "USD", amount: "25" }],
    daily: [
      {
        date: "2026-10-01",
        amounts: [
          { currency: "USD", amount: "10" },
          { currency: "EUR", amount: "99" },
        ],
      },
      { date: "2026-10-13", amounts: [{ currency: "USD", amount: "15" }] },
    ],
  },
};
test("séries comparam dias e moeda equivalentes, preservando data real do mês anterior", () => {
  const series = costComparisonSeries(monthReport, [previousMonth], "USD");
  assert.equal(series.length, 13);
  assert.equal(series[0].date, "2026-11-01");
  assert.equal(series[0].cost, 120);
  assert.equal(series[0].previousDate, "2026-10-01");
  assert.equal(series[0].previousCost, 10);
  assert.equal(series[1].previousCost, 0);
  assert.equal(series[12].previousCost, 15);
  assert.equal(
    costComparisonSeries(monthReport, [previousMonth], "EUR")[0].previousCost,
    99,
  );
});

test("comparação diferencia consulta pendente ou falha de um dia sem cobrança", () => {
  const failed = {
    ...previousMonth,
    costs: { ...previousMonth.costs, status: "error" as const },
  };
  assert.equal(
    costComparisonSeries(monthReport, [undefined], "USD")[0].previousCost,
    null,
  );
  assert.equal(
    costComparisonSeries(monthReport, [failed], "USD")[0].previousCost,
    null,
  );
  assert.equal(
    costComparisonSeries(
      { ...monthReport, projectId: "a" },
      [{ ...previousMonth, projectId: "b" }],
      "USD",
    )[0].previousCost,
    null,
  );
  const noEquivalent = costComparisonSeries(
    { ...monthReport, startDate: "2026-03-31", endDate: "2026-03-31" },
    [],
    "USD",
  )[0];
  assert.equal(noEquivalent.previousDate, null);
  assert.equal(noEquivalent.previousCost, null);
  const leap = costComparisonSeries(
    { ...monthReport, startDate: "2028-03-29", endDate: "2028-03-29" },
    [
      {
        ...previousMonth,
        startDate: "2028-02-29",
        endDate: "2028-02-29",
        costs: {
          ...previousMonth.costs,
          daily: [
            { date: "2028-02-29", amounts: [{ currency: "USD", amount: "7" }] },
          ],
        },
      },
    ],
    "USD",
  );
  assert.equal(leap[0].previousCost, 7);
});

test("pico identifica o primeiro dia de maior gasto atual e não inventa pico em dias zerados", () => {
  assert.deepEqual(
    dailyCostPeak(costComparisonSeries(monthReport, [previousMonth], "USD")),
    { date: "2026-11-01", cost: 120 },
  );
  assert.deepEqual(
    dailyCostPeak([
      { date: "2026-01-01", cost: 10 },
      { date: "2026-01-02", cost: 10 },
    ]),
    { date: "2026-01-01", cost: 10 },
  );
  assert.equal(
    dailyCostPeak([
      { date: "2026-01-01", cost: 0 },
      { date: "2026-01-02", cost: null },
    ]),
    null,
  );
  assert.equal(dailyCostPeak([{ date: "2026-01-01", cost: -2 }]), null);
});

test("dia em andamento sem custo publicado fica em processamento, sem virar zero", () => {
  const now = new Date("2026-01-03T12:00:00Z");
  const days = dailySeries(report, "USD", now);
  assert.equal(days[1].cost, 0);
  assert.equal(days[1].costPending, false);
  assert.equal(days[2].cost, null);
  assert.equal(days[2].costPending, true);
  assert.equal(days[2].isPartial, true);
  for (const amount of ["5.92", "0"]) {
    const published = dailySeries({
      ...report,
      costs: { ...report.costs, daily: [{ date: "2026-01-03", amounts: [{ currency: "USD", amount }] }] },
    }, "USD", now)[2];
    assert.equal(published.cost, Number(amount));
    assert.equal(published.costPending, false);
    assert.equal(published.isPartial, true);
  }
  assert.equal(dailySeries({ ...report, costs: { ...report.costs, status: "error" } }, "USD", now)[2].costPending, false);
});

test("variação usa somente os mesmos dias fechados, excluindo hoje parcial", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const points = costComparisonSeries(monthReport, [previousMonth], "USD", now);
  const change = costPeriodChange(points, now)!;
  assert.equal(change.current, 180);
  assert.equal(change.previous, 10);
  assert.equal(change.delta, 170);
  assert.equal(change.percent, 1700);
  assert.equal(change.direction, "up");
  assert.equal(change.days, 12);
  assert.equal(change.endDate, "2026-11-12");
  assert.equal(change.previousEndDate, "2026-10-12");
  assert.equal(change.excludesToday, true);
  assert.equal(costPeriodChange(points.slice(-1), now), null);
  assert.equal(costPeriodChange(points.map(point => ({ ...point, previousCost: null })), now), null);
  assert.equal(costPeriodChange(points.map(point => ({ ...point, cost: null })), now), null);
});

test("variação diferencia queda, aumento, estabilidade e base zero sem infinito", () => {
  const now = new Date("2026-11-14T00:00:00Z");
  const base = costComparisonSeries(monthReport, [previousMonth], "USD", now).slice(0, 1);
  const falling = costPeriodChange(base.map(point => ({ ...point, cost: 5, previousCost: 10 })), now)!;
  assert.equal(falling.direction, "down");
  assert.equal(falling.delta, -5);
  assert.equal(falling.percent, 50);
  const equal = costPeriodChange(base.map(point => ({ ...point, cost: 0.1 + 0.2, previousCost: 0.3 })), now)!;
  assert.equal(equal.direction, "equal");
  const zero = costPeriodChange(base.map(point => ({ ...point, previousCost: 0 })), now)!;
  assert.equal(zero.direction, "up");
  assert.equal(zero.percent, null);
  assert.equal(costPeriodChange(base.map(point => ({ ...point, previousCost: -1 })), now)?.percent, null);
});

test("variação ignora dias sem equivalente e não compara relatórios de projetos diferentes", () => {
  const now = new Date("2026-11-14T00:00:00Z");
  const points = costComparisonSeries(monthReport, [previousMonth], "USD", now);
  const noEquivalent = points.map(point => ({ ...point, previousDate: null }));
  assert.equal(costPeriodChange(noEquivalent, now), null);
  assert.equal(costPeriodChange([...points, ...noEquivalent], now)?.days, 13);
  const mismatched = costComparisonSeries(
    { ...monthReport, projectId: "a" },
    [{ ...previousMonth, projectId: "b" }],
    "USD", now,
  );
  assert.equal(costPeriodChange(mismatched, now), null);
  assert.equal(costPeriodChange([], now), null);
});
