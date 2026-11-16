import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import "@/styles/openai-monitoring.css";
import { Link } from "wouter";
import { SiOpenai } from "react-icons/si";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  BarChart3,
  CalendarDays,
  Coins,
  Database,
  Expand,
  Layers3,
  Minimize2,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { OpenAICostChart } from "@/components/openai-cost-chart";
import { OpenAICostChange } from "@/components/openai-cost-change";
import {
  OpenAIRecentChart,
  compactNumber,
} from "@/components/openai-recent-chart";
import {
  DashboardFeedback,
  DashboardPanel,
  DashboardTable,
  StaleNotice,
  ValueHint,
  type DashboardColumn,
} from "@/components/openai-dashboard";
import {
  MonitorKpi,
  moneyFormat,
  numberFormat,
} from "@/components/openai-monitoring";
import { useOpenAIReport } from "@/hooks/api/useOpenAIReport";
import { useDollarQuote } from "@/hooks/api/useDollarQuote";
import { costsInReais } from "@/services/openaiCurrency";
import { recentTime } from "@/services/openaiTime";
import {
  chartLayout,
  OPENAI_CHARTS,
  OPENAI_CHART_VISIBILITY_KEY,
  parseHiddenCharts,
  sortDescending,
  type OpenAIChart,
} from "@/services/openaiDashboard";
import {
  costComparisonSeries,
  currentDayCost,
  dailyCostPeak,
  modelRows,
  monthlyProjection,
  periodDates,
  rankingDates,
  recentUsageSeries,
  topProjectCosts,
  type RankingDays,
} from "@/services/openaiReport";
import {
  OPENAI_METRICS,
  type OpenAICostReport,
  type OpenAIUsageCategory,
  type OpenAIMetric,
} from "@shared/openai";

type PanelId =
  | "costs"
  | "recent"
  | "monthly"
  | "ranking"
  | "models"
  | "billing"
  | "categories"
  | "daily";
const dateLabel = (date: string) => date.split("-").reverse().join("/");
const fullTime = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Manaus",
  }).format(new Date(value));
const numeric = (value: number) => (
  <ValueHint text={numberFormat(value)}>
    {value >= 1_000_000 ? compactNumber(value) : numberFormat(value)}
  </ValueHint>
);
const names: Record<PanelId, string> = {
  costs: "Evolução dos custos",
  recent: "Consumo · últimas 3 horas",
  monthly: "Top 10 · mês atual",
  ranking: "Top 10 · intervalo",
  models: "Consumo por modelo",
  billing: "Projetos e cobrança",
  categories: "Outras categorias de uso",
  daily: "Dados diários · UTC",
};

export default function GestaoOpenAI() {
  const [today, setToday] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [projectId, setProjectId] = useState("");
  const [currencyChoice, setCurrencyChoice] = useState("");
  const [hiddenCharts, setHiddenCharts] = useState<OpenAIChart[]>(() => {
    try {
      return parseHiddenCharts(
        localStorage.getItem(OPENAI_CHART_VISIBILITY_KEY),
      );
    } catch {
      return [];
    }
  });
  const layout = chartLayout(hiddenCharts);
  const [rankingDays, setRankingDays] = useState<RankingDays>(7);
  const [mode, setMode] = useState<"requests" | "tokens">("requests");
  const [category, setCategory] = useState<OpenAIUsageCategory>("embeddings");
  const [expanded, setExpanded] = useState<PanelId | null>(null);
  const dialogTitle = useRef<HTMLHeadingElement>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const [fullscreen, setFullscreen] = useState(
    () => !!document.fullscreenElement,
  );
  const [browserMessage, setBrowserMessage] = useState<string | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(
        OPENAI_CHART_VISIBILITY_KEY,
        JSON.stringify(hiddenCharts),
      );
    } catch {
      /* A personalização continua disponível se o navegador bloquear o armazenamento. */
    }
  }, [hiddenCharts]);
  useEffect(() => {
    const timer = window.setInterval(
      () => setToday(new Date().toISOString().slice(0, 10)),
      15_000,
    );
    const focus = () => setToday(new Date().toISOString().slice(0, 10));
    const full = () => setFullscreen(!!document.fullscreenElement);
    window.addEventListener("focus", focus);
    document.addEventListener("fullscreenchange", full);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("fullscreenchange", full);
    };
  }, []);
  const filters = useMemo(
    () => ({
      ...periodDates("month", new Date(`${today}T12:00:00Z`)),
      projectId,
    }),
    [today, projectId],
  );
  const {
    report,
    projects,
    comparison,
    recent,
    ranking,
    visible,
    refreshing,
    refresh,
  } = useOpenAIReport(filters, rankingDays);
  const rawData = report.data;
  const sourceCurrencies = Array.from(
    new Set([
      ...(rawData?.costs.totals.map((value) => value.currency) ?? []),
      ...(ranking.data?.totals.map((value) => value.currency) ?? []),
      ...comparison.reports.flatMap(
        (value) => value?.costs.totals.map((total) => total.currency) ?? [],
      ),
    ]),
  );
  const currencies = Array.from(
    new Set([
      ...(sourceCurrencies.length ? sourceCurrencies : ["USD"]),
      ...(!sourceCurrencies.length || sourceCurrencies.includes("USD")
        ? ["BRL"]
        : []),
    ]),
  );
  const currency = currencies.includes(currencyChoice)
    ? currencyChoice
    : currencies[0] || "USD";
  const converting = currency === "BRL" && !sourceCurrencies.includes("BRL");
  const quote = useDollarQuote(converting, visible);
  const quoteLoading = converting && quote.isPending;
  const quoteError =
    converting && !quote.data && quote.isError
      ? "Cotação indisponível. Tente atualizar ou selecione USD nos filtros."
      : undefined;
  const exchangeNote =
    converting && quote.data
      ? `Conversão de referência · 1 USD = R$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(quote.data.rate)} · cotação de venda AwesomeAPI em ${recentTime(Date.parse(quote.data.quotedAt), true)} (Manaus). Última consulta: ${fullTime(new Date(quote.dataUpdatedAt).toISOString())} (Manaus). Consultada a cada 5 minutos; não inclui taxas ou impostos. Todos os dias usam esta mesma cotação, inclusive o mês anterior.`
      : undefined;
  const displayCosts = (costs: OpenAICostReport): OpenAICostReport => {
    if (!converting || costs.status === "error") return costs;
    return quote.data
      ? costsInReais(costs, quote.data.rate)
      : {
          ...costs,
          status: "error",
          message: quoteError || "Consultando cotação USD/BRL…",
          totals: [],
          daily: [],
          rows: [],
        };
  };
  const data = rawData
    ? { ...rawData, costs: displayCosts(rawData.costs) }
    : undefined;
  const comparisonReports = comparison.reports.map((value) =>
    value ? { ...value, costs: displayCosts(value.costs) } : undefined,
  );
  const rankingCosts = ranking.data ? displayCosts(ranking.data) : undefined;
  const source = data?.usage.find((value) => value.id === "completions");
  const costsOk = data?.costs.status === "ok";
  const usageOk = source?.status === "ok";
  const series = data
    ? costComparisonSeries(data, comparisonReports, currency)
    : [];
  const peak = dailyCostPeak(series);
  const models = useMemo(() => modelRows(source), [source]);
  const costRows = sortDescending(
    (data?.costs.rows ?? []).filter((row) => row.currency === currency),
    (row) => Number(row.amount),
  );
  const selectedCategory = data?.usage.find((value) => value.id === category);
  const metrics = Object.keys(OPENAI_METRICS).filter(
    (key) => selectedCategory?.totals[key as OpenAIMetric] !== undefined,
  ) as OpenAIMetric[];
  const categoryRows = sortDescending(
    (selectedCategory?.rows ?? []).flatMap((row, index) =>
      metrics
        .filter((metric) => row.metrics[metric] !== undefined)
        .map((metric) => ({
          ...row,
          metric,
          value: row.metrics[metric]!,
          key: `${index}-${metric}`,
        })),
    ),
    (row) => row.value,
  );
  const projectNames = new Map(
    projects.data?.projects.map((value) => [value.id, value.name]),
  );
  const projectName = (id: string | null) =>
    id ? projectNames.get(id) || id : "Não atribuído";
  const selectedName = projectId
    ? projectName(projectId)
    : "Toda a organização";
  const total =
    data?.costs.totals.find((value) => value.currency === currency)?.amount ??
    "0";
  const dayCost = currentDayCost(
    data,
    currency,
    new Date(`${today}T12:00:00Z`),
  );
  const projection = monthlyProjection(
    data,
    new Date(`${today}T12:00:00Z`),
  )?.find((value) => value.currency === currency);
  const available = rawData
    ? [rawData.costs, ...rawData.usage].filter((value) => value.status === "ok")
        .length
    : 0;
  const range = rankingDates(rankingDays, new Date(`${today}T12:00:00Z`));
  const resetKey = `${projectId}:${currency}:${filters.startDate}`;
  const badges = data ? [data.costs, ...data.usage].length : 12;
  const icons: Record<PanelId, ReactNode> = {
    costs: <Coins size={14} />,
    recent: <Activity size={14} />,
    monthly: <BarChart3 size={14} />,
    ranking: <BarChart3 size={14} />,
    models: <Layers3 size={14} />,
    billing: <Coins size={14} />,
    categories: <Database size={14} />,
    daily: <CalendarDays size={14} />,
  };
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setBrowserMessage(
        "Não foi possível ativar a tela cheia neste navegador.",
      );
    }
  }

  function openPanel(id: PanelId) {
    if (!expanded) {
      const active = document.activeElement;
      dialogOpener.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : document.querySelector<HTMLElement>(
              `[data-panel="${id === "daily" ? "costs" : id}"] .openai-dash-panel-actions button`,
            );
    }
    setExpanded(id);
  }

  function rankingBody(
    costs: OpenAICostReport | undefined,
    loading: boolean,
    error?: string,
  ) {
    const rows = topProjectCosts(costs, currency);
    return (
      <>
        <StaleNotice error={costs ? error : undefined} />
        <DashboardFeedback
          loading={loading && (!costs || quoteLoading)}
          error={
            !costs
              ? error
              : costs.status === "error"
                ? costs.message
                : undefined
          }
          empty={costs?.status === "ok" && !rows.length}
        />
        {!!rows.length && (
          <ol
            className="openai-ranking"
            aria-label="Projetos ordenados por gasto"
          >
            {rows.map((row, index) => (
              <li key={row.projectId}>
                <div className="openai-rank-line">
                  <span className="openai-rank-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <ValueHint text={projectName(row.projectId)} />
                  <span className="openai-rank-value">
                    {moneyFormat(row.amount, currency)}
                  </span>
                </div>
                <div className="openai-rank-track" aria-hidden="true">
                  <span
                    style={{ width: `${(row.amount / rows[0].amount) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
        {costs?.rows.some(
          (row) =>
            !row.projectId &&
            row.currency === currency &&
            Number(row.amount) !== 0,
        ) && (
          <p className="openai-panel-note">
            Itens sem projeto fora do ranking.
          </p>
        )}
      </>
    );
  }

  function panelBody(id: PanelId, large = false): ReactNode {
    switch (id) {
      case "costs":
        return (
          <>
            <div className="openai-cost-summary">
              <OpenAICostChange
                points={series}
                currency={currency}
                pending={comparison.isPending}
                error={comparison.hasError || !costsOk}
              />
              {peak && (
                <span className="openai-cost-peak">
                  <TrendingUp size={11} aria-hidden="true" />
                  <ValueHint
                    text={`Pico atual em ${dateLabel(peak.date)}: ${moneyFormat(peak.cost, currency)}`}
                  >
                    Pico {peak.date.slice(8)}/{peak.date.slice(5, 7)} ·{" "}
                    {moneyFormat(peak.cost, currency)}
                  </ValueHint>
                </span>
              )}
              <button
                type="button"
                className="openai-text-button"
                onClick={() => openPanel("daily")}
              >
                Dados
              </button>
            </div>
            <DashboardFeedback
              loading={report.isPending || quoteLoading}
              error={
                data?.costs.status === "error"
                  ? data.costs.message
                  : !data
                    ? report.error?.message
                    : undefined
              }
            />
            {costsOk && (
              <OpenAICostChart
                points={series}
                currency={currency}
                comparisonPending={comparison.isPending}
                comparisonError={comparison.hasError}
              />
            )}
          </>
        );
      case "recent":
        return (
          <>
            <div className="openai-recent-controls">
              <div
                className="openai-segmented"
                aria-label="Métrica do consumo recente"
              >
                {(["requests", "tokens"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => setMode(value)}
                  >
                    {value === "requests" ? "Requisições" : "Tokens"}
                  </button>
                ))}
              </div>
              {recent.data && (
                <span className="openai-recent-total">
                  {compactNumber(
                    mode === "requests"
                      ? (recent.data.totals.num_model_requests ?? 0)
                      : (recent.data.totals.input_tokens ?? 0) +
                          (recent.data.totals.output_tokens ?? 0),
                  )}
                  <small> na janela</small>
                </span>
              )}
            </div>
            <StaleNotice
              error={recent.data ? recent.error?.message : undefined}
            />
            <DashboardFeedback
              loading={recent.isPending}
              error={!recent.data ? recent.error?.message : undefined}
            />
            {recent.data && (
              <OpenAIRecentChart report={recent.data} mode={mode} />
            )}
            {large && recent.data && (
              <div className="openai-recent-data">
                <DashboardTable
                  label="Consumo por minuto"
                  resetKey={projectId}
                  rows={recentUsageSeries(recent.data)}
                  rowKey={(row) => String(row.timestamp)}
                  columns={[
                    {
                      label: "Minuto · Manaus",
                      width: "28%",
                      render: (row) => recentTime(row.timestamp, true),
                    },
                    {
                      label: "Requisições",
                      numeric: true,
                      render: (row) => numeric(row.requests),
                    },
                    {
                      label: "Entrada",
                      numeric: true,
                      render: (row) => numeric(row.input),
                    },
                    {
                      label: "Saída",
                      numeric: true,
                      render: (row) => numeric(row.output),
                    },
                    {
                      label: "Cache¹",
                      numeric: true,
                      render: (row) => numeric(row.cached),
                    },
                  ]}
                />
              </div>
            )}
          </>
        );
      case "monthly":
        return rankingBody(data?.costs, report.isPending || quoteLoading);
      case "ranking":
        return rankingBody(
          rankingCosts,
          ranking.isPending || quoteLoading,
          ranking.error?.message,
        );
      case "models":
        return (
          <>
            <DashboardFeedback
              loading={report.isPending}
              error={
                source?.status === "error"
                  ? source.message
                  : !data
                    ? report.error?.message
                    : undefined
              }
              empty={usageOk && !models.length}
            />
            {usageOk && !!models.length && (
              <DashboardTable
                label="Consumo por modelo"
                resetKey={resetKey}
                rows={models}
                rowKey={(row) => row.model}
                columns={[
                  {
                    label: "Modelo",
                    width: "29%",
                    render: (row) => <ValueHint text={row.model} />,
                  },
                  {
                    label: "Entrada",
                    width: "20%",
                    numeric: true,
                    render: (row) => numeric(row.input),
                  },
                  {
                    label: "Saída",
                    width: "16%",
                    numeric: true,
                    render: (row) => numeric(row.output),
                  },
                  {
                    label: "Cache¹",
                    width: "20%",
                    numeric: true,
                    render: (row) => numeric(row.cached),
                  },
                  {
                    label: "Req.",
                    width: "15%",
                    numeric: true,
                    render: (row) => numeric(row.requests),
                  },
                ]}
              />
            )}
            <p className="openai-panel-note">
              ¹ Cache incluído na entrada. Conversações · mês atual.
            </p>
          </>
        );
      case "billing":
        return (
          <>
            <DashboardFeedback
              loading={report.isPending || quoteLoading}
              error={
                data?.costs.status === "error"
                  ? data.costs.message
                  : !data
                    ? report.error?.message
                    : undefined
              }
              empty={costsOk && !costRows.length}
            />
            {costsOk && !!costRows.length && (
              <DashboardTable
                label="Custos por projeto e item"
                resetKey={resetKey}
                rows={costRows}
                rowHeight={36}
                rowKey={(row, index) =>
                  `${row.projectId}-${row.lineItem}-${index}`
                }
                columns={[
                  {
                    label: "Projeto / item de cobrança",
                    width: "72%",
                    render: (row) => (
                      <div className="openai-double-cell">
                        <ValueHint text={projectName(row.projectId)} />
                        <ValueHint
                          text={row.lineItem || "Item não informado"}
                        />
                      </div>
                    ),
                  },
                  {
                    label: currency,
                    width: "28%",
                    numeric: true,
                    sortDirection: "descending",
                    render: (row) => (
                      <ValueHint text={moneyFormat(row.amount, row.currency)} />
                    ),
                  },
                ]}
              />
            )}
          </>
        );
      case "categories":
        return (
          <>
            <div className="openai-category-control">
              <label
                className="sr-only"
                htmlFor={large ? "openai-category-expanded" : "openai-category"}
              >
                Categoria de uso
              </label>
              <select
                id={large ? "openai-category-expanded" : "openai-category"}
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as OpenAIUsageCategory)
                }
              >
                {data?.usage
                  .filter((value) => value.id !== "completions")
                  .map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.label}
                      {value.status === "error" ? " · indisponível" : ""}
                    </option>
                  ))}
              </select>
              <span>{selectedCategory?.rows.length ?? 0} registros</span>
            </div>
            <DashboardFeedback
              loading={report.isPending}
              error={
                selectedCategory?.status === "error"
                  ? selectedCategory.message
                  : !data
                    ? report.error?.message
                    : undefined
              }
              empty={selectedCategory?.status === "ok" && !categoryRows.length}
            />
            {selectedCategory?.status === "ok" && !!categoryRows.length && (
              <>
                <div className="openai-category-totals">
                  {metrics.map((metric) => (
                    <ValueHint
                      key={metric}
                      text={`${OPENAI_METRICS[metric]}: ${numberFormat(selectedCategory.totals[metric] ?? 0)}`}
                    >
                      <span>{OPENAI_METRICS[metric]}</span>
                      <strong>
                        {compactNumber(selectedCategory.totals[metric] ?? 0)}
                      </strong>
                    </ValueHint>
                  ))}
                </div>
                <DashboardTable
                  label="Métricas por projeto e modelo"
                  resetKey={`${resetKey}:${category}`}
                  rows={categoryRows}
                  rowHeight={32}
                  rowKey={(row) => row.key}
                  columns={[
                    {
                      label: "Projeto / modelo",
                      width: "45%",
                      render: (row) => (
                        <div className="openai-double-cell">
                          <ValueHint text={projectName(row.projectId)} />
                          <ValueHint text={row.model || "—"} />
                        </div>
                      ),
                    },
                    {
                      label: "Métrica",
                      width: "33%",
                      render: (row) => (
                        <ValueHint text={OPENAI_METRICS[row.metric]} />
                      ),
                    },
                    {
                      label: "Valor",
                      width: "22%",
                      numeric: true,
                      sortDirection: "descending",
                      render: (row) => numeric(row.value),
                    },
                  ]}
                />
              </>
            )}
          </>
        );
      case "daily": {
        const columns: DashboardColumn<(typeof series)[number]>[] = [
          {
            label: "Data UTC",
            width: "17%",
            render: (row) => <ValueHint text={dateLabel(row.date)} />,
          },
          {
            label: `Atual · ${currency}`,
            numeric: true,
            render: (row) =>
              row.costPending ? (
                <ValueHint text="Em processamento" />
              ) : row.cost === null ? (
                <ValueHint text="Indisponível" />
              ) : (
                <ValueHint
                  text={`${moneyFormat(row.cost, currency)}${row.isPartial ? " · parcial" : ""}`}
                />
              ),
          },
          {
            label: "Data anterior",
            render: (row) => (
              <ValueHint
                text={
                  row.previousDate
                    ? dateLabel(row.previousDate)
                    : "Sem equivalente"
                }
              />
            ),
          },
          {
            label: `Anterior · ${currency}`,
            numeric: true,
            render: (row) => (
              <ValueHint
                text={
                  row.previousCost === null
                    ? "Indisponível"
                    : moneyFormat(row.previousCost, currency)
                }
              />
            ),
          },
          {
            label: "Entrada",
            numeric: true,
            render: (row) => (row.input === null ? "—" : numeric(row.input)),
          },
          {
            label: "Saída",
            numeric: true,
            render: (row) => (row.output === null ? "—" : numeric(row.output)),
          },
        ];
        return (
          <DashboardTable
            label="Dados diários de custos e tokens"
            resetKey={resetKey}
            rows={series}
            rowKey={(row) => row.date}
            columns={columns}
          />
        );
      }
    }
  }

  return (
    <div className="openai-monitor openai-dashboard dark">
      <a className="openai-skip" href="#openai-content">
        Pular para o conteúdo
      </a>
      <header className="openai-toolbar">
        <div className="openai-brand">
          <span className="openai-brand-mark">
            <SiOpenai size={26} aria-hidden="true" />
          </span>
          <div>
            <h1>Gestão da OpenAI</h1>
            <p>POLO INTELLIGENCE · VISÃO EXECUTIVA</p>
          </div>
        </div>
        <div className="openai-header-scope">
          <CalendarDays size={13} aria-hidden="true" />
          <span>
            Mês atual · {dateLabel(filters.startDate)} — {dateLabel(today)} UTC
          </span>
          <ValueHint text={selectedName} />
        </div>
        <div className="openai-toolbar-actions">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-label="Filtros de projeto, moeda e gráficos"
              >
                <SlidersHorizontal size={13} />
                Filtros
                {(projectId || hiddenCharts.length > 0 || converting) && (
                  <span className="openai-filter-dot" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="openai-dashboard openai-filter-popover dark"
            >
              <h2>Escopo do painel</h2>
              <p>Os painéis financeiros usam dias em UTC.</p>
              <label htmlFor="openai-project">Projeto</label>
              <select
                id="openai-project"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                disabled={projects.isPending}
              >
                <option value="">Todos os projetos</option>
                {projects.data?.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                    {project.status === "archived" ? " (arquivado)" : ""}
                  </option>
                ))}
              </select>
              <label htmlFor="openai-currency">Moeda</label>
              <select
                id="openai-currency"
                value={currency}
                onChange={(event) => setCurrencyChoice(event.target.value)}
              >
                {currencies.map((value) => (
                  <option key={value} value={value}>
                    {value === "BRL"
                      ? "Real (BRL)"
                      : value === "USD"
                        ? "Dólar (USD)"
                        : value}
                  </option>
                ))}
              </select>
              <p>
                {converting
                  ? "Conversão de referência USD → BRL · cotação a cada 5 minutos."
                  : "Custos na moeda de origem informada pela OpenAI."}
              </p>
              {converting && (
                <p role="status">
                  {quoteLoading
                    ? "Consultando cotação…"
                    : quoteError || exchangeNote}
                  {quote.isError &&
                    quote.data &&
                    " Cotação desatualizada: a última consulta falhou; mantida a taxa anterior."}{" "}
                  <a
                    href="https://docs.awesomeapi.com.br/api-de-moedas"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Fonte da cotação
                  </a>
                </p>
              )}
              <fieldset className="openai-chart-visibility">
                <legend>Gráficos visíveis</legend>
                <p>
                  Desmarque para ocultar. Os demais ocupam o espaço liberado.
                </p>
                {OPENAI_CHARTS.map((chart) => (
                  <label key={chart} className="openai-chart-toggle">
                    <input
                      type="checkbox"
                      checked={!hiddenCharts.includes(chart)}
                      onChange={(event) =>
                        setHiddenCharts((current) =>
                          event.target.checked
                            ? current.filter((id) => id !== chart)
                            : [...current, chart],
                        )
                      }
                    />
                    <span>{names[chart]}</span>
                  </label>
                ))}
                <button
                  type="button"
                  className="openai-text-button"
                  disabled={!hiddenCharts.length}
                  onClick={() => setHiddenCharts([])}
                >
                  Mostrar todos
                </button>
              </fieldset>
              {projects.isError && (
                <p role="status">{projects.error.message}</p>
              )}
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void Promise.all([
                refresh(),
                ...(converting ? [quote.refetch()] : []),
              ])
            }
            disabled={refreshing || (converting && quote.isFetching)}
            aria-label="Atualizar relatórios da OpenAI"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            <span>{refreshing ? "Atualizando" : "Atualizar"}</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => void toggleFullscreen()}
            aria-label={fullscreen ? "Sair da tela cheia" : "Ativar tela cheia"}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Expand size={14} />}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/">
              <ArrowLeft size={13} />
              <span>Dashboard</span>
            </Link>
          </Button>
        </div>
      </header>
      <div className="openai-status">
        <div>
          <span
            className={
              report.isError || available < badges ? "is-warning" : "is-ready"
            }
          >
            <i />
            {data
              ? `${available}/${badges} fontes disponíveis`
              : "Conectando à OpenAI"}
          </span>
          <span>
            <ShieldCheck size={11} />
            Acesso administrativo
          </span>
          {converting && (
            <span className={quote.isError ? "is-warning" : "is-ready"}>
              <ValueHint
                text={
                  quoteError ||
                  `${exchangeNote || "Consultando cotação USD/BRL…"}${quote.isError ? " Cotação desatualizada: última consulta falhou; mantida a taxa anterior." : ""}`
                }
              >
                {quoteLoading
                  ? "Câmbio: consultando…"
                  : quote.isError
                    ? "Câmbio: atenção à atualização"
                    : "USD → BRL · referência · 5 min"}
              </ValueHint>
            </span>
          )}
          {(browserMessage || report.isError) && (
            <ValueHint
              text={
                browserMessage ||
                `${report.error?.message} Dados mantidos; podem estar desatualizados.`
              }
            >
              Atenção à atualização
            </ValueHint>
          )}
        </div>
        <div>
          <VolumeX size={11} />
          <span>Silencioso</span>
          <span>
            Consulta: {data ? fullTime(data.fetchedAt) : "—"} (Manaus)
          </span>
          <span>
            {visible ? "Atualização a cada 60 s" : "Atualização pausada"}
          </span>
        </div>
      </div>
      <main
        id="openai-content"
        tabIndex={-1}
        className="openai-content"
        data-has-charts={layout.visible.length > 0}
      >
        <div className="openai-kpis">
          <MonitorKpi
            label="Gasto no mês"
            value={costsOk ? moneyFormat(total, currency) : "—"}
            hint={
              converting
                ? "Referência em reais · cotação atual"
                : "Custos informados pela OpenAI"
            }
            badge={converting ? "Convertido" : "Realizado"}
            icon={<Coins size={13} />}
            loading={report.isPending || quoteLoading}
            featured
          />
          <MonitorKpi
            label="Gasto de hoje · UTC"
            value={
              dayCost !== null
                ? moneyFormat(dayCost, currency)
                : costsOk
                  ? "Em processamento"
                  : "—"
            }
            hint={dateLabel(today)}
            badge="Parcial"
            icon={<CalendarDays size={13} />}
            loading={report.isPending || quoteLoading}
            featured
          />
          <MonitorKpi
            label="Projeção do mês"
            value={projection ? moneyFormat(projection.amount, currency) : "—"}
            hint={
              projection
                ? `Base: ${projection.elapsedDays} dias fechados`
                : "Aguardando dias completos"
            }
            badge="Estimativa"
            icon={<TrendingUp size={13} />}
            loading={report.isPending || quoteLoading}
            featured
          />
          <MonitorKpi
            label="Tokens de entrada"
            value={
              usageOk ? numberFormat(source.totals.input_tokens ?? 0) : "—"
            }
            hint="Conversações · inclui cache"
            icon={<ArrowDownToLine size={13} />}
            loading={report.isPending}
          />
          <MonitorKpi
            label="Tokens de saída"
            value={
              usageOk ? numberFormat(source.totals.output_tokens ?? 0) : "—"
            }
            hint="Conversações · saídas dos modelos"
            icon={<ArrowUpFromLine size={13} />}
            loading={report.isPending}
          />
          <MonitorKpi
            label="Tokens em cache"
            value={
              usageOk
                ? numberFormat(source.totals.input_cached_tokens ?? 0)
                : "—"
            }
            hint="Já contabilizados na entrada"
            icon={<Database size={13} />}
            loading={report.isPending}
          />
        </div>
        {!!layout.visible.length && (
          <div
            className="openai-charts"
            style={
              { "--openai-chart-columns": layout.columns } as CSSProperties
            }
          >
            {layout.visible.map((id) => (
              <DashboardPanel
                key={id}
                id={id}
                title={names[id]}
                icon={icons[id]}
                onExpand={() => openPanel(id)}
                subtitle={
                  id === "costs"
                    ? `${currency} · mês anterior tracejado`
                    : id === "recent"
                      ? "Conversações · por minuto · Manaus (UTC−4)"
                      : id === "monthly"
                        ? `Mês atual · ${currency}`
                        : `${range.startDate.slice(8)}/${range.startDate.slice(5, 7)} — ${range.endDate.slice(8)}/${range.endDate.slice(5, 7)} · UTC`
                }
                action={
                  id === "ranking" ? (
                    <select
                      className="openai-ranking-period"
                      aria-label="Intervalo do ranking"
                      value={rankingDays}
                      onChange={(event) =>
                        setRankingDays(
                          Number(event.target.value) as RankingDays,
                        )
                      }
                    >
                      {([1, 7, 15, 30] as const).map((days) => (
                        <option key={days} value={days}>
                          {days} {days === 1 ? "dia" : "dias"}
                        </option>
                      ))}
                    </select>
                  ) : undefined
                }
              >
                {panelBody(id)}
              </DashboardPanel>
            ))}
          </div>
        )}
        <div className="openai-details">
          {(["models", "billing", "categories"] as const).map((id) => (
            <DashboardPanel
              key={id}
              id={id}
              title={names[id]}
              icon={icons[id]}
              onExpand={() => openPanel(id)}
              subtitle={
                id === "models"
                  ? "Conversações · mês atual"
                  : id === "billing"
                    ? `${converting ? "Referência convertida" : "Custos reais"} · ${currency} · mês atual`
                    : "Unidades próprias de cada serviço"
              }
            >
              {panelBody(id)}
            </DashboardPanel>
          ))}
        </div>
      </main>
      <footer className="openai-footer">
        <span>
          Dados reais da OpenAI · o dia atual é parcial e pode ser revisado após
          o uso.
        </span>
        <span>Somente leitura · sem áudio</span>
      </footer>
      <Dialog
        open={expanded !== null}
        onOpenChange={(open) => {
          if (!open) setExpanded(null);
        }}
      >
        <DialogContent
          className="openai-dashboard openai-expanded dark"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            dialogTitle.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            dialogOpener.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle ref={dialogTitle} tabIndex={-1}>
              {expanded ? names[expanded] : "Detalhamento"}
            </DialogTitle>
            <DialogDescription>
              {selectedName} ·{" "}
              {expanded === "recent"
                ? "Janela móvel das últimas 3 horas · Manaus (UTC−4)"
                : `${currency}${converting ? " · conversão de referência" : ""} · ${dateLabel(filters.startDate)} — ${dateLabel(today)} UTC`}
            </DialogDescription>
          </DialogHeader>
          <div
            className={`openai-expanded-body ${expanded === "recent" ? "has-minute-data" : ""}`}
          >
            {expanded && panelBody(expanded, true)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
