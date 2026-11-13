import { useEffect, useMemo, useState } from "react";
import "@/styles/openai-monitoring.css";
import { Link } from "wouter";
import { SiOpenai } from "react-icons/si";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Coins,
  Database,
  Expand,
  Layers3,
  Minimize2,
  RefreshCw,
  ShieldCheck,
  VolumeX,
  TrendingUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { OpenAICostChart } from "@/components/openai-cost-chart";
import { OpenAICostChange } from "@/components/openai-cost-change";
import {
  MonitorKpi,
  MonitorPanel,
  MonitorTable,
  SourceMessage,
  moneyFormat,
  numberFormat,
} from "@/components/openai-monitoring";
import { useOpenAIReport } from "@/hooks/api/useOpenAIReport";
import {
  costComparisonSeries,
  dailyCostPeak,
  dateRangeError,
  modelRows,
  periodDates,
  monthlyProjection,
  topProjectCosts,
  type OpenAIPeriod,
} from "@/services/openaiReport";
import {
  OPENAI_METRICS,
  type OpenAIMetric,
  type OpenAIUsageCategory,
} from "@shared/openai";

const fieldClass =
  "openai-field h-10 min-w-0 w-full rounded-lg border border-slate-700/80 bg-[#080f1b] px-3 text-sm text-slate-200 outline-none focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30 disabled:opacity-60 [color-scheme:dark]";
const cell = "whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums";
const periodLabels: Record<OpenAIPeriod, string> = {
  month: "Mês atual",
  today: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  custom: "Personalizado",
};

export default function GestaoOpenAI() {
  const [utcToday, setUtcToday] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [draftPeriod, setDraftPeriod] = useState<OpenAIPeriod>("month");
  const [draftRange, setDraftRange] = useState(() => periodDates("month"));
  const [draftProject, setDraftProject] = useState("");
  const [applied, setApplied] = useState({
    period: "month" as OpenAIPeriod,
    ...periodDates("month"),
    projectId: "",
  });
  const [validation, setValidation] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(
    () => !!document.fullscreenElement,
  );
  const [browserMessage, setBrowserMessage] = useState<string | null>(null);
  const [currencyChoice, setCurrencyChoice] = useState("");
  const [category, setCategory] = useState<OpenAIUsageCategory>("embeddings");
  useEffect(() => {
    const interval = window.setInterval(
      () => setUtcToday(new Date().toISOString().slice(0, 10)),
      60_000,
    );
    const change = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", change);
    return () => {
      clearInterval(interval);
      document.removeEventListener("fullscreenchange", change);
    };
  }, []);
  const filters = useMemo(
    () => ({
      ...(applied.period === "custom"
        ? { startDate: applied.startDate, endDate: applied.endDate }
        : periodDates(applied.period, new Date(`${utcToday}T12:00:00Z`))),
      projectId: applied.projectId,
    }),
    [applied, utcToday],
  );
  const displayedRange =
    draftPeriod === "custom"
      ? draftRange
      : periodDates(draftPeriod, new Date(`${utcToday}T12:00:00Z`));
  const { report, projects, monthlyReport, comparison, visible } =
    useOpenAIReport(filters);
  const data = report.data;
  const consumption = data?.usage.find((source) => source.id === "completions");
  const selectedCategory = data?.usage.find((source) => source.id === category);
  const models = useMemo(() => modelRows(consumption), [consumption]);
  const currencies = Array.from(
    new Set([
      ...(data?.costs.totals.map((total) => total.currency) ?? []),
      ...comparison.reports.flatMap((previous) =>
        previous?.costs.status === "ok"
          ? previous.costs.totals.map((total) => total.currency)
          : [],
      ),
    ]),
  );
  const currency = currencies.includes(currencyChoice)
    ? currencyChoice
    : currencies[0] || "USD";
  const series = data
    ? costComparisonSeries(data, comparison.reports, currency)
    : [];
  const peak = dailyCostPeak(series);
  const available = data
    ? [data.costs, ...data.usage].filter((source) => source.status === "ok")
        .length
    : 0;
  const sourceCount = data ? data.usage.length + 1 : 0;
  const anyError = !!data && available < sourceCount;
  const usageOk = consumption?.status === "ok";
  const costsOk = data?.costs.status === "ok";
  const hasCostSeries =
    costsOk &&
    (data.costs.totals.length > 0 ||
      series.some((day) => day.costPending) ||
      comparison.reports.some(
        (previous) =>
          previous?.costs.status === "ok" && previous.costs.totals.length > 0,
      ));
  const projectNames = new Map(
    projects.data?.projects.map((project) => [project.id, project.name]),
  );
  const projectName = (id: string | null) =>
    id ? projectNames.get(id) || id : "Não atribuído";
  const topProjects = useMemo(
    () => topProjectCosts(data?.costs, currency),
    [data?.costs, currency],
  );
  const projection = useMemo(
    () =>
      monthlyProjection(monthlyReport.data, new Date(`${utcToday}T12:00:00Z`)),
    [monthlyReport.data, utcToday],
  );
  const monthElapsedDays = Number(utcToday.slice(8, 10)) - 1;
  const refreshing =
    report.isFetching ||
    projects.isFetching ||
    monthlyReport.isFetching ||
    comparison.isFetching;
  const metricKeys = Object.keys(OPENAI_METRICS).filter(
    (key) => selectedCategory?.totals[key as OpenAIMetric] !== undefined,
  ) as OpenAIMetric[];
  const formatTime = (value: string) =>
    new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "America/Manaus",
    }).format(new Date(value));

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
      else
        setBrowserMessage(
          "Este navegador não oferece suporte ao modo de tela cheia.",
        );
    } catch {
      setBrowserMessage(
        "Não foi possível ativar a tela cheia neste navegador.",
      );
    }
  }

  return (
    <div className="openai-monitor dark min-h-svh min-w-0 bg-[#060b14] text-slate-200 [color-scheme:dark]">
      <a
        href="#openai-content"
        className="fixed left-3 top-3 z-50 -translate-y-24 rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 focus:translate-y-0"
      >
        Pular para o conteúdo
      </a>
      <header className="openai-toolbar border-b border-slate-800/80 bg-[#080e19]">
        <div className="grid w-full min-w-0 grid-cols-1 items-center gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:px-6 min-[1440px]:grid-cols-[auto_minmax(0,1fr)_auto] min-[1440px]:gap-4">
          <div className="openai-brand flex min-w-0 items-center gap-3">
            <div className="openai-brand-mark flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
              <SiOpenai className="h-7 w-7" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">
                Gestão da OpenAI
              </h1>
              <p className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                Polo Intelligence
              </p>
            </div>
          </div>
          <form
            className="openai-filters grid min-w-0 gap-2 sm:col-span-2 sm:row-start-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.35fr_auto] min-[1440px]:col-span-1 min-[1440px]:col-start-2 min-[1440px]:row-start-1"
            onSubmit={(event) => {
              event.preventDefault();
              const error = dateRangeError(
                displayedRange.startDate,
                displayedRange.endDate,
              );
              setValidation(error);
              if (!error)
                setApplied({
                  period: draftPeriod,
                  ...displayedRange,
                  projectId: draftProject,
                });
            }}
          >
            <div>
              <label
                htmlFor="openai-period"
                className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400"
              >
                <CalendarDays className="h-3 w-3" aria-hidden="true" />
                Período · UTC
              </label>
              <select
                id="openai-period"
                className={fieldClass}
                value={draftPeriod}
                onChange={(event) => {
                  const value = event.target.value as OpenAIPeriod;
                  setDraftPeriod(value);
                  if (value === "custom") setDraftRange(displayedRange);
                  setValidation(null);
                }}
              >
                {Object.entries(periodLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="openai-start"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-400"
              >
                Data inicial
              </label>
              <input
                id="openai-start"
                type="date"
                required
                max={utcToday}
                readOnly={draftPeriod !== "custom"}
                className={fieldClass}
                value={displayedRange.startDate}
                aria-invalid={!!validation}
                aria-describedby={validation ? "openai-date-error" : undefined}
                onChange={(event) =>
                  setDraftRange((range) => ({
                    ...range,
                    startDate: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label
                htmlFor="openai-end"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-400"
              >
                Data final
              </label>
              <input
                id="openai-end"
                type="date"
                required
                max={utcToday}
                readOnly={draftPeriod !== "custom"}
                className={fieldClass}
                value={displayedRange.endDate}
                aria-invalid={!!validation}
                aria-describedby={validation ? "openai-date-error" : undefined}
                onChange={(event) =>
                  setDraftRange((range) => ({
                    ...range,
                    endDate: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label
                htmlFor="openai-project"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-400"
              >
                Projeto
              </label>
              <select
                id="openai-project"
                className={fieldClass}
                value={draftProject}
                onChange={(event) => setDraftProject(event.target.value)}
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
            </div>
            <Button
              type="submit"
              className="openai-apply self-end bg-cyan-400 text-slate-950 hover:bg-cyan-300"
            >
              Aplicar filtros
            </Button>
            {validation && (
              <p
                id="openai-date-error"
                role="alert"
                className="text-xs text-rose-300 sm:col-span-2 lg:col-span-5"
              >
                {validation}
              </p>
            )}
            {projects.isError && (
              <p
                role="status"
                className="text-xs text-amber-200 sm:col-span-2 lg:col-span-5"
              >
                Projetos: {projects.error.message} A consulta de todos os
                projetos continua disponível.
              </p>
            )}
          </form>
          <div className="flex flex-wrap items-center gap-2 sm:col-start-2 sm:row-start-1 sm:justify-end min-[1440px]:col-start-3">
            <span className="mr-2 inline-flex items-center gap-1.5 text-xs text-slate-400">
              <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
              Silencioso
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void report.refetch();
                void projects.refetch();
                if (monthlyReport !== report) void monthlyReport.refetch();
                void comparison.refetch();
              }}
              disabled={refreshing}
              aria-label="Atualizar relatórios da OpenAI"
            >
              <RefreshCw
                className={refreshing ? "animate-spin" : ""}
                aria-hidden="true"
              />
              <span>{refreshing ? "Atualizando…" : "Atualizar"}</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void toggleFullscreen()}
              aria-label={
                fullscreen ? "Sair da tela cheia" : "Ativar tela cheia"
              }
              title={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
            >
              {fullscreen ? (
                <Minimize2 aria-hidden="true" />
              ) : (
                <Expand aria-hidden="true" />
              )}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/">
                <ArrowLeft aria-hidden="true" />
                Dashboard
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main
        id="openai-content"
        tabIndex={-1}
        className="openai-content w-full min-w-0 space-y-5 p-3 pb-8 outline-none sm:p-5 lg:p-6"
      >
        <div className="openai-status flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span
              className={`inline-flex items-center gap-2 ${report.isError || anyError ? "text-amber-300" : data ? "text-emerald-300" : "text-slate-400"}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${report.isError || anyError ? "bg-amber-400" : data ? "bg-emerald-400" : "bg-slate-500"}`}
                aria-hidden="true"
              />
              {report.isError
                ? "Falha na atualização"
                : data
                  ? `${available}/${sourceCount} fontes disponíveis`
                  : "Conectando à OpenAI"}
            </span>
            <span className="inline-flex items-center gap-1.5 text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Acesso administrativo
            </span>
          </div>
          <p className="text-slate-400">
            {data
              ? `Consulta: ${formatTime(data.fetchedAt)} (Manaus)`
              : "Aguardando primeira consulta"}
            <span className="mx-2 text-slate-600">·</span>
            {visible
              ? "Atualização a cada 60 s"
              : "Atualização pausada nesta aba"}
          </p>
        </div>

        {(browserMessage || report.isError) && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200"
          >
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <p>
              {browserMessage || report.error?.message}
              {report.isError &&
                data &&
                " Os dados da última consulta foram mantidos e podem estar desatualizados."}
            </p>
          </div>
        )}

        <div className="openai-overview">
          <div>
            <p className="openai-eyebrow">Finanças & operação</p>
            <h2>Visão executiva</h2>
          </div>
          <div className="openai-scope">
            <span>
              <CalendarDays
                className="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              {filters.startDate.split("-").reverse().join("/")} —{" "}
              {filters.endDate.split("-").reverse().join("/")}{" "}
              <span className="text-slate-400">UTC</span>
            </span>
            <span>
              <Layers3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">
                {filters.projectId
                  ? projectName(filters.projectId)
                  : "Toda a organização"}
              </span>
            </span>
            {data && !report.isError && !anyError && (
              <span>
                <CheckCircle2
                  className="h-3.5 w-3.5 shrink-0 text-emerald-300"
                  aria-hidden="true"
                />
                Dados consolidados
              </span>
            )}
          </div>
        </div>

        <div className="openai-kpis grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MonitorKpi
            label="Gasto no período"
            value={
              costsOk
                ? data.costs.totals.length
                  ? data.costs.totals.map((total) => (
                      <span key={total.currency} className="block">
                        {moneyFormat(total.amount, total.currency)}
                      </span>
                    ))
                  : "—"
                : "—"
            }
            hint={
              costsOk
                ? data.costs.totals.length
                  ? "Custos informados pela OpenAI"
                  : "Nenhuma cobrança no período"
                : "Dados financeiros indisponíveis"
            }
            icon={<Coins className="h-4 w-4" />}
            loading={report.isPending}
            accent="emerald"
            featured
            badge="Realizado"
          />
          <MonitorKpi
            label="Projeção até o fim do mês"
            value={
              projection?.length
                ? projection.map((total) => (
                    <span key={total.currency} className="block">
                      {moneyFormat(total.amount, total.currency)}
                    </span>
                  ))
                : "—"
            }
            hint={
              monthlyReport.isError
                ? "Estimativa desatualizada · tente atualizar"
                : monthlyReport.data?.costs.status === "error"
                  ? "Custos do mês atual indisponíveis"
                  : projection?.length
                    ? `Média de ${projection[0].elapsedDays} dias completos do mês atual`
                    : monthElapsedDays < 1
                      ? "Disponível após o primeiro dia completo do mês"
                      : monthlyReport.isPending
                        ? "Consultando custos do mês atual"
                        : "Sem dados de cobrança para estimar"
            }
            icon={<TrendingUp className="h-4 w-4" />}
            loading={monthlyReport.isPending}
            accent="cyan"
            featured
            badge="Estimativa"
          />
          <MonitorKpi
            label="Tokens de entrada"
            value={
              usageOk ? numberFormat(consumption.totals.input_tokens ?? 0) : "—"
            }
            hint="Conversações · inclui tokens em cache"
            icon={<ArrowDownToLine className="h-4 w-4" />}
            loading={report.isPending}
          />
          <MonitorKpi
            label="Tokens de saída"
            value={
              usageOk
                ? numberFormat(consumption.totals.output_tokens ?? 0)
                : "—"
            }
            hint="Conversações · saída dos modelos"
            icon={<ArrowUpFromLine className="h-4 w-4" />}
            loading={report.isPending}
          />
          <MonitorKpi
            label="Tokens em cache"
            value={
              usageOk
                ? numberFormat(consumption.totals.input_cached_tokens ?? 0)
                : "—"
            }
            hint="Já contabilizados nos tokens de entrada"
            icon={<Database className="h-4 w-4" />}
            loading={report.isPending}
            accent="emerald"
          />
        </div>

        <div className="openai-charts grid min-w-0 gap-4 xl:grid-cols-2">
          <MonitorPanel
            title="Evolução dos custos"
            description="Gastos diários comparados com o mês anterior"
            icon={<Coins className="h-4 w-4" />}
            action={
              <div className="openai-cost-heading-actions">
                {data && (
                  <OpenAICostChange
                    points={series}
                    currency={currency}
                    pending={comparison.isPending}
                    error={comparison.hasError || !costsOk}
                  />
                )}
                {peak && (
                  <span
                    className="openai-cost-peak"
                    aria-label={`Pico do período em ${peak.date.split("-").reverse().join("/")}: ${moneyFormat(peak.cost, currency)}`}
                  >
                    <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      Pico atual · {peak.date.slice(8, 10)}/{peak.date.slice(5, 7)}
                    </span>
                    <strong>{moneyFormat(peak.cost, currency)}</strong>
                  </span>
                )}
                {currencies.length > 1 ? (
                  <select
                    className={`${fieldClass} !h-8 !w-auto !text-xs`}
                    aria-label="Moeda do gráfico de custos"
                    value={currency}
                    onChange={(event) => setCurrencyChoice(event.target.value)}
                  >
                    {currencies.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                ) : (
                  <span className="openai-panel-tag">
                    {currencies.length ? currency : "UTC"} · DIÁRIO
                  </span>
                )}
              </div>
            }
          >
            <SourceMessage
              source={data?.costs}
              loading={
                report.isPending ||
                (costsOk && !data.costs.totals.length && comparison.isPending)
              }
              empty={costsOk && !hasCostSeries && !comparison.isPending}
            />
            {hasCostSeries && (
              <OpenAICostChart
                points={series}
                currency={currency}
                comparisonPending={comparison.isPending}
                comparisonError={comparison.hasError}
              />
            )}
          </MonitorPanel>
          <MonitorPanel
            title="Top 10 projetos por gasto"
            action={
              costsOk ? (
                <span className="openai-panel-tag">
                  {topProjects.length} PROJETOS
                </span>
              ) : undefined
            }
            description={`Maiores custos no período selecionado · ${currency}`}
            icon={<BarChart3 className="h-4 w-4" />}
          >
            <SourceMessage
              source={data?.costs}
              loading={report.isPending}
              empty={costsOk && !topProjects.length}
            />
            {costsOk && !!topProjects.length && (
              <ol
                aria-label="Top 10 projetos por gasto"
                className="openai-ranking flex min-h-64 flex-col justify-center gap-5"
              >
                {topProjects.map((project, index) => (
                  <li key={project.projectId} className="min-w-0">
                    <div className="mb-2 flex min-w-0 items-start justify-between gap-3 text-xs">
                      <span className="openai-rank-name flex min-w-0 items-start gap-2.5">
                        <span className="openai-rank-number font-mono text-slate-500">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="break-words font-medium text-slate-200">
                          {projectName(project.projectId)}
                        </span>
                      </span>
                      <span className="openai-rank-value shrink-0 font-mono font-semibold text-cyan-300">
                        {moneyFormat(project.amount, currency)}
                      </span>
                    </div>
                    <div
                      className="openai-rank-track h-2 overflow-hidden rounded-full bg-slate-800"
                      aria-hidden="true"
                    >
                      <div
                        className={`openai-rank-fill h-full rounded-full ${index === 0 ? "bg-cyan-400" : "bg-emerald-400/80"}`}
                        style={{
                          width: `${(project.amount / topProjects[0].amount) * 100}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {costsOk &&
              data.costs.rows.some(
                (row) =>
                  row.currency === currency &&
                  !row.projectId &&
                  Number(row.amount) !== 0,
              ) && (
                <p className="mt-3 text-[11px] text-slate-400">
                  Cobranças sem projeto atribuído não entram no ranking.
                </p>
              )}
          </MonitorPanel>
        </div>

        {data && (
          <details className="openai-daily rounded-xl border border-slate-800/80 bg-[#0b1220] p-4">
            <summary className="cursor-pointer text-xs font-medium text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
              Ver dados diários · UTC
            </summary>
            <div className="mt-4">
              <MonitorTable
                label="Dados diários de custos e tokens"
                headers={[
                  "Data (UTC)",
                  `Custo (${currency})`,
                  "Data anterior (UTC)",
                  `Custo anterior (${currency})`,
                  "Entrada",
                  "Saída",
                ]}
              >
                {series.map((day) => (
                  <tr key={day.date}>
                    <th
                      scope="row"
                      className="whitespace-nowrap px-3 py-3 font-normal"
                    >
                      {day.label}/{day.date.slice(0, 4)}
                    </th>
                    <td className={cell}>
                      {day.cost === null
                        ? day.costPending
                          ? "Em processamento"
                          : "Indisponível"
                        : costsOk && !currencies.length
                          ? "Sem cobrança"
                          : moneyFormat(day.cost, currency)}
                      {day.isPartial && costsOk && (
                        <span className="mt-1 block font-sans text-[10px] text-amber-200">
                          Dia em andamento · parcial
                        </span>
                      )}
                    </td>
                    <td className={cell}>
                      {day.previousDate
                        ? day.previousDate.split("-").reverse().join("/")
                        : "Sem dia equivalente"}
                    </td>
                    <td className={cell}>
                      {day.previousCost === null
                        ? comparison.isPending && day.previousDate
                          ? "Carregando…"
                          : "Indisponível"
                        : moneyFormat(day.previousCost, currency)}
                    </td>
                    <td className={cell}>
                      {day.input === null
                        ? "Indisponível"
                        : numberFormat(day.input)}
                    </td>
                    <td className={cell}>
                      {day.output === null
                        ? "Indisponível"
                        : numberFormat(day.output)}
                    </td>
                  </tr>
                ))}
              </MonitorTable>
            </div>
          </details>
        )}

        <div className="openai-section-label">
          <span>Detalhamento de uso</span>
        </div>
        <div className="grid min-w-0 gap-4 xl:grid-cols-[1.05fr_1fr]">
          <MonitorPanel
            title="Consumo por modelo"
            action={
              usageOk ? (
                <span className="openai-panel-tag">
                  {models.length} MODELOS
                </span>
              ) : undefined
            }
            description="Conversações · ordenado por quantidade de requisições"
            icon={<Layers3 className="h-4 w-4" />}
          >
            <SourceMessage
              source={consumption}
              loading={report.isPending}
              empty={usageOk && !models.length}
            />
            {usageOk && !!models.length && (
              <MonitorTable
                label="Consumo de conversações por modelo"
                headers={[
                  "Modelo",
                  "Entrada",
                  "Saída",
                  "Cache¹",
                  "Requisições",
                ]}
              >
                {models.map((model) => (
                  <tr key={model.model}>
                    <th
                      scope="row"
                      className="min-w-40 max-w-64 break-words px-3 py-3 text-xs font-medium text-slate-200"
                    >
                      {model.model}
                    </th>
                    <td className={cell}>{numberFormat(model.input)}</td>
                    <td className={cell}>{numberFormat(model.output)}</td>
                    <td className={`${cell} text-emerald-300`}>
                      {numberFormat(model.cached)}
                    </td>
                    <td className={`${cell} text-cyan-300`}>
                      {numberFormat(model.requests)}
                    </td>
                  </tr>
                ))}
              </MonitorTable>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
              ¹ O cache faz parte da entrada. As demais categorias são
              apresentadas separadamente abaixo.
            </p>
          </MonitorPanel>
          <MonitorPanel
            title="Custos por projeto e cobrança"
            className="openai-cost-details"
            action={
              costsOk ? (
                <span className="openai-panel-tag">
                  {data.costs.rows.length} ITENS
                </span>
              ) : undefined
            }
            description="Itens retornados pela OpenAI · sem estimativa por modelo"
            icon={<Coins className="h-4 w-4" />}
          >
            <SourceMessage
              source={data?.costs}
              loading={report.isPending}
              empty={costsOk && !data.costs.rows.length}
            />
            {costsOk && !!data.costs.rows.length && (
              <MonitorTable
                label="Custos por projeto e item de cobrança"
                headers={["Projeto / item de cobrança", "Valor"]}
              >
                {data.costs.rows.map((row, index) => (
                  <tr key={index}>
                    <th
                      scope="row"
                      className="min-w-52 max-w-96 break-words px-3 py-3 font-normal"
                    >
                      <span className="block text-slate-200">
                        {projectName(row.projectId)}
                      </span>
                      <span className="mt-1 block text-[11px] text-slate-400">
                        {row.lineItem || "Item não informado"}
                      </span>
                    </th>
                    <td className={`${cell} text-emerald-300`}>
                      {moneyFormat(row.amount, row.currency)}
                    </td>
                  </tr>
                ))}
              </MonitorTable>
            )}
          </MonitorPanel>
        </div>

        <MonitorPanel
          title="Outras categorias de uso"
          description="Unidades específicas de cada serviço · métricas independentes das conversações"
          icon={<Database className="h-4 w-4" />}
          action={
            data ? (
              <>
                <label htmlFor="openai-category" className="sr-only">
                  Categoria de uso
                </label>
                <select
                  id="openai-category"
                  className={`${fieldClass} !h-9 sm:!w-64`}
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as OpenAIUsageCategory)
                  }
                >
                  {data.usage
                    .filter((source) => source.id !== "completions")
                    .map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.label}
                        {source.status === "error" ? " · indisponível" : ""}
                      </option>
                    ))}
                </select>
              </>
            ) : undefined
          }
        >
          {report.isPending ? (
            <SourceMessage loading />
          ) : !data ? (
            <p className="text-sm text-slate-400">
              Atualize o relatório para consultar as categorias.
            </p>
          ) : (
            <>
              <SourceMessage
                source={selectedCategory}
                empty={
                  selectedCategory?.status === "ok" &&
                  !selectedCategory.rows.length
                }
              />
              {selectedCategory?.status === "ok" &&
                !!selectedCategory.rows.length && (
                  <>
                    <div className="openai-category-metrics mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {metricKeys.map((metric) => (
                        <div
                          key={metric}
                          className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"
                        >
                          <p className="text-xs text-slate-400">
                            {OPENAI_METRICS[metric]}
                          </p>
                          <p className="mt-2 font-mono text-xl font-semibold text-cyan-300">
                            {numberFormat(selectedCategory.totals[metric] ?? 0)}
                          </p>
                        </div>
                      ))}
                    </div>
                    <MonitorTable
                      label={`Detalhamento: ${selectedCategory.label}`}
                      headers={[
                        "Projeto / modelo",
                        ...metricKeys.map((metric) => OPENAI_METRICS[metric]),
                      ]}
                    >
                      {selectedCategory.rows.map((row, index) => (
                        <tr key={index}>
                          <th
                            scope="row"
                            className="min-w-48 break-words px-3 py-3 font-normal"
                          >
                            <span className="block">
                              {projectName(row.projectId)}
                            </span>
                            {row.model && (
                              <span className="mt-1 block text-[11px] text-slate-400">
                                {row.model}
                              </span>
                            )}
                          </th>
                          {metricKeys.map((metric) => (
                            <td key={metric} className={cell}>
                              {row.metrics[metric] === undefined
                                ? "—"
                                : numberFormat(row.metrics[metric]!)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </MonitorTable>
                  </>
                )}
            </>
          )}
        </MonitorPanel>
        <footer className="openai-footer flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] leading-relaxed text-slate-400">
          <p>
            Os dados refletem o processamento da OpenAI e podem ser atualizados
            após o uso.
          </p>
          <span>Somente leitura · Sem reprodução de áudio</span>
        </footer>
      </main>
    </div>
  );
}
