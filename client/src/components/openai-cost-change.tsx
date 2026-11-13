import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { moneyFormat } from "@/components/openai-monitoring";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  costPeriodChange,
  type CostComparisonPoint,
} from "@/services/openaiReport";

const dateLabel = (date: string) => date.split("-").reverse().join("/");

export function OpenAICostChange({
  points,
  currency,
  pending,
  error,
}: {
  points: CostComparisonPoint[];
  currency: string;
  pending: boolean;
  error: boolean;
}) {
  const change = costPeriodChange(points);
  if (!change)
    return (
      <span
        className="openai-cost-change"
        data-direction="unavailable"
        role="status"
      >
        {pending
          ? "Calculando variação…"
          : error
            ? "Variação indisponível"
            : points.every((point) => point.isPartial)
              ? "Variação após fechar o dia"
              : "Sem base comparável"}
      </span>
    );
  const Icon =
    change.direction === "down"
      ? TrendingDown
      : change.direction === "up"
        ? TrendingUp
        : Minus;
  const label =
    change.direction === "down"
      ? "Gasto diminuiu"
      : change.direction === "up"
        ? "Gasto aumentou"
        : "Gasto estável";
  const difference = moneyFormat(Math.abs(change.delta), currency);
  const amount =
    change.percent === null
      ? difference
      : change.percent > 0 && change.percent < 0.1
        ? "<0,1%"
        : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(change.percent)}%`;
  const explanation = `${label} ${difference}. Selecionado: ${dateLabel(change.startDate)} a ${dateLabel(change.endDate)}, ${moneyFormat(change.current, currency)}. Anterior: ${dateLabel(change.previousStartDate)} a ${dateLabel(change.previousEndDate)}, ${moneyFormat(change.previous, currency)}. Somente ${change.days} dias UTC fechados e equivalentes.${change.excludesToday ? " Hoje está em andamento e não entra na variação." : ""}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="openai-cost-change"
          data-direction={change.direction}
          tabIndex={0}
          aria-label={explanation}
        >
          <span className="openai-cost-change-value">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label} <strong>{change.direction === "equal" ? "" : amount}</strong>
          </span>
          <span className="openai-cost-change-basis">
            vs mês anterior · {change.days}{" "}
            {change.days === 1 ? "dia fechado" : "dias fechados"}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 text-xs leading-relaxed">
        {explanation}
      </TooltipContent>
    </Tooltip>
  );
}
