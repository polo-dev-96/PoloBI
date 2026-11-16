import type { ReactNode } from "react";
export const numberFormat = (value: number) =>
  new Intl.NumberFormat("pt-BR").format(value);
export const moneyFormat = (value: string | number, currency: string) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));

export function MonitorKpi({
  label,
  value,
  hint,
  icon,
  loading,
  featured = false,
  badge,
}: {
  label: string;
  value: ReactNode;
  hint: string;
  icon: ReactNode;
  loading: boolean;
  featured?: boolean;
  badge?: string;
}) {
  return (
    <article
      className="openai-kpi relative min-w-0 rounded-2xl border p-4"
      data-featured={featured}
    >
      <div className="openai-kpi-heading flex items-start justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em]">
          {label}
        </h2>
        <span className="openai-kpi-icon shrink-0" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="openai-kpi-value mt-4 break-words font-mono text-2xl font-semibold tracking-tight">
        {loading ? (
          <span
            className="openai-kpi-skeleton block h-8 w-24 animate-pulse rounded"
            aria-label="Carregando"
          />
        ) : (
          value
        )}
      </div>
      <div className="openai-kpi-caption">
        {badge && <span className="openai-kpi-badge">{badge}</span>}
        <p className="mt-2 text-[11px] leading-relaxed">{hint}</p>
      </div>
    </article>
  );
}
