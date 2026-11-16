import { useId } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OpenAIRecentUsage } from "@shared/openai";
import { recentUsageSeries } from "@/services/openaiReport";
import { numberFormat } from "@/components/openai-monitoring";
import { recentTime } from "@/services/openaiTime";

export const compactNumber = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

export function OpenAIRecentChart({
  report,
  mode,
}: {
  report: OpenAIRecentUsage;
  mode: "requests" | "tokens";
}) {
  const fill = useId();
  const points = recentUsageSeries(report);
  return (
    <>
      <div
        className="openai-recent-chart"
        role="img"
        aria-label={`Consumo real das últimas três horas no horário de Manaus (UTC−4): ${mode === "requests" ? "requisições" : "tokens de entrada e saída"}. Valores por minuto disponíveis no tooltip e no detalhamento ampliado.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={points}
            margin={{ top: 12, right: 9, bottom: 0, left: 0 }}
            accessibilityLayer
          >
            <defs>
              <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--oa-accent)"
                  stopOpacity={0.2}
                />
                <stop
                  offset="100%"
                  stopColor="var(--oa-accent)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke="var(--oa-grid)"
              strokeDasharray="3 6"
              vertical={false}
            />
            <XAxis
              type="number"
              dataKey="timestamp"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(value: number) => recentTime(value)}
              tick={{ fill: "var(--oa-muted)", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              width={38}
              tickFormatter={compactNumber}
              tick={{ fill: "var(--oa-muted)", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as
                  ReturnType<typeof recentUsageSeries>[number] | undefined;
                if (!active || !point) return null;
                return (
                  <div className="openai-cost-tooltip">
                    <p>
                      {recentTime(point.timestamp, true)} · Manaus (UTC−4)
                      {point.partial ? " · parcial" : ""}
                    </p>
                    {mode === "requests" ? (
                      <div>
                        Requisições{" "}
                        <strong>{numberFormat(point.requests)}</strong>
                      </div>
                    ) : (
                      <>
                        <div>
                          Entrada <strong>{numberFormat(point.input)}</strong>
                        </div>
                        <div>
                          Saída <strong>{numberFormat(point.output)}</strong>
                        </div>
                        <div>
                          Cache¹ <strong>{numberFormat(point.cached)}</strong>
                        </div>
                      </>
                    )}
                  </div>
                );
              }}
            />
            <Area
              type="linear"
              dataKey={mode === "requests" ? "requests" : "input"}
              stroke="var(--oa-accent)"
              strokeWidth={1.8}
              fill={`url(#${fill})`}
              isAnimationActive={false}
              dot={false}
            />
            {mode === "tokens" && (
              <Line
                type="linear"
                dataKey="output"
                stroke="var(--oa-text)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="openai-mini-legend">
        <span className="is-primary">
          {mode === "requests" ? "Requisições por minuto" : "Entrada"}
        </span>
        {mode === "tokens" && (
          <span className="is-secondary">Saída · tracejada</span>
        )}
        <span>
          Manaus (UTC−4) ·{" "}
          {mode === "requests"
            ? "dados de conversações"
            : "cache incluído na entrada"}
        </span>
      </p>
    </>
  );
}
