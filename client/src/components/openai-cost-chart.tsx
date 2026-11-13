import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  dailyCostPeak,
  type CostComparisonPoint,
} from "@/services/openaiReport";
import { moneyFormat } from "@/components/openai-monitoring";

const dateLabel = (date: string) => date.split("-").reverse().join("/");
const compact = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

export function OpenAICostChart({
  points,
  currency,
  comparisonPending,
  comparisonError,
}: {
  points: CostComparisonPoint[];
  currency: string;
  comparisonPending: boolean;
  comparisonError: boolean;
}) {
  const peak = dailyCostPeak(points);
  const hasEquivalent = points.some((point) => point.previousDate !== null);
  const currentDay = points.find((point) => point.isPartial);
  const comparisonMessage = comparisonPending
    ? "Consultando os dias equivalentes do mês anterior…"
    : comparisonError
      ? "Não foi possível atualizar todo o mês anterior. Dados disponíveis foram mantidos."
      : !hasEquivalent
        ? "Não há dia equivalente no mês anterior para este período."
        : null;

  return (
    <>
      <div
        className="openai-chart openai-cost-chart min-w-0"
        role="img"
        aria-label={`Comparação de custos diários em ${currency}, com o mês anterior por dia equivalente. Valores e datas disponíveis na tabela diária.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={points}
            margin={{ top: 24, right: 18, bottom: 2, left: 0 }}
            accessibilityLayer
          >
            <defs>
              <linearGradient id="openai-cost-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6ed7c0" stopOpacity={0.23} />
                <stop offset="100%" stopColor="#6ed7c0" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke="#233246"
              strokeDasharray="3 6"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tickFormatter={(date: string) =>
                `${date.slice(8, 10)}/${date.slice(5, 7)}`
              }
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              minTickGap={30}
            />
            <YAxis
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={compact}
              width={48}
            />
            <Tooltip
              cursor={{ stroke: "#8198ad", strokeWidth: 1, strokeOpacity: 0.7 }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as
                  | CostComparisonPoint
                  | undefined;
                if (!active || !point) return null;
                return (
                  <div className="openai-cost-tooltip" role="tooltip">
                    <p>
                      Gasto diário <span>· {currency}</span>
                    </p>
                    <div>
                      <i className="openai-series-current" aria-hidden="true" />
                      <span>Atual · {dateLabel(point.date)}</span>
                      <strong>
                        {point.cost === null
                          ? point.costPending
                            ? "Em processamento"
                            : "Indisponível"
                          : moneyFormat(point.cost, currency)}
                      </strong>
                    </div>
                    <div>
                      <i
                        className="openai-series-previous"
                        aria-hidden="true"
                      />
                      <span>
                        {point.previousDate
                          ? `Anterior · ${dateLabel(point.previousDate)}`
                          : "Sem dia equivalente"}
                      </span>
                      <strong>
                        {point.previousCost === null
                          ? comparisonPending && point.previousDate
                            ? "Carregando…"
                            : "—"
                          : moneyFormat(point.previousCost, currency)}
                      </strong>
                    </div>
                    {point.isPartial && (
                      <p className="openai-cost-tooltip-partial">
                        Dia em andamento ·{" "}
                        {point.costPending
                          ? "custo ainda não informado pela OpenAI"
                          : "custo parcial informado pela OpenAI"}
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Area
              name="Período selecionado"
              type="monotone"
              dataKey="cost"
              stroke="#6ed7c0"
              strokeWidth={2.5}
              fill="url(#openai-cost-fill)"
              activeDot={{
                r: 4,
                stroke: "#e5fff8",
                strokeWidth: 2,
                fill: "#6ed7c0",
              }}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              name="Mês anterior"
              type="monotone"
              dataKey="previousCost"
              stroke="#9aacc3"
              strokeWidth={2}
              strokeDasharray="4 5"
              dot={false}
              activeDot={{
                r: 3.5,
                stroke: "#eef3fa",
                strokeWidth: 2,
                fill: "#9aacc3",
              }}
              isAnimationActive={false}
              connectNulls={false}
            />
            {peak && (
              <ReferenceDot
                className="openai-cost-peak-marker"
                x={peak.date}
                y={peak.cost}
                r={5}
                fill="#6ed7c0"
                stroke="#e5fff8"
                strokeWidth={2}
                ifOverflow="extendDomain"
                label={{
                  value: "Pico atual",
                  position: "top",
                  fill: "#b6f3e4",
                  fontSize: 10,
                  offset: 11,
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="openai-cost-legend" aria-label="Legenda do gráfico">
        <span>
          <i className="openai-series-current" aria-hidden="true" />
          Período selecionado
        </span>
        <span>
          <i className="openai-series-previous" aria-hidden="true" />
          Mês anterior
        </span>
        <span className="openai-cost-alignment">Dias equivalentes · UTC</span>
        {currentDay && (
          <span className="openai-cost-partial">
            {currentDay.label} ·{" "}
            {currentDay.costPending
              ? "custo em processamento"
              : "dia em andamento, valor parcial"}
          </span>
        )}
      </div>
      {comparisonMessage && (
        <p
          className={`openai-comparison-message ${comparisonError ? "text-amber-200" : "text-slate-400"}`}
          role="status"
        >
          {comparisonMessage}
        </p>
      )}
    </>
  );
}
