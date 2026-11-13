import type { ReactNode } from "react";
import { AlertCircle, Database, Loader2 } from "lucide-react";
import type { OpenAISourceState } from "@shared/openai";

export const numberFormat = (value: number) =>
  new Intl.NumberFormat("pt-BR").format(value);
export const moneyFormat = (value: string | number, currency: string) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));

export function MonitorPanel({
  title,
  description,
  icon,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`openai-panel min-w-0 rounded-2xl border border-slate-800/90 bg-[#0b1220]/90 ${className}`}
    >
      <div className="openai-panel-heading flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/70 px-4 py-3.5 sm:px-5">
        <div className="flex items-start gap-2.5">
          {icon && (
            <span
              className="openai-panel-icon mt-0.5 text-cyan-400"
              aria-hidden="true"
            >
              {icon}
            </span>
          )}
          <div>
            <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {description}
              </p>
            )}
          </div>
        </div>
        {action}
      </div>
      <div className="openai-panel-body p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function SourceMessage({
  source,
  loading = false,
  empty = false,
}: {
  source?: OpenAISourceState;
  loading?: boolean;
  empty?: boolean;
}) {
  if (loading)
    return (
      <div
        role="status"
        className="flex min-h-36 items-center justify-center gap-2 text-sm text-slate-400"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Consultando a OpenAI…
      </div>
    );
  if (source?.status === "error")
    return (
      <div
        role="status"
        className="flex min-h-28 items-center gap-3 rounded-xl border border-amber-400/15 bg-amber-400/5 p-4 text-sm leading-relaxed text-amber-200"
      >
        <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>{source.message}</span>
      </div>
    );
  if (empty)
    return (
      <div className="flex min-h-28 flex-col items-center justify-center gap-2 text-center text-sm text-slate-400">
        <Database className="h-5 w-5 text-slate-500" aria-hidden="true" />
        <span>Nenhum registro neste período.</span>
      </div>
    );
  return null;
}

export function MonitorTable({
  label,
  headers,
  children,
}: {
  label: string;
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div
      className="openai-table max-h-[420px] overflow-auto rounded-xl border border-slate-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <table className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">{label}</caption>
        <thead className="sticky top-0 z-10 bg-[#111c2d] text-[10px] uppercase tracking-wider text-slate-400">
          <tr>
            {headers.map((header, index) => (
              <th
                key={header}
                scope="col"
                className={`whitespace-nowrap px-3 py-3 font-medium ${index > 0 ? "text-right" : ""}`}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 text-slate-300">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function MonitorKpi({
  label,
  value,
  hint,
  icon,
  loading,
  accent = "cyan",
  featured = false,
  badge,
}: {
  label: string;
  value: ReactNode;
  hint: string;
  icon: ReactNode;
  loading: boolean;
  accent?: "cyan" | "emerald";
  featured?: boolean;
  badge?: string;
}) {
  const color = accent === "emerald" ? "text-emerald-300" : "text-cyan-300";
  return (
    <article
      className={`openai-kpi openai-kpi--${accent} relative min-w-0 overflow-hidden rounded-2xl border border-slate-800/90 bg-[#0b1220] p-4`}
      data-featured={featured}
    >
      <div className="openai-kpi-heading flex items-start justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          {label}
        </h2>
        <span
          className={`openai-kpi-icon ${color} shrink-0`}
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>
      <div
        className={`openai-kpi-value mt-4 break-words font-mono text-2xl font-semibold tracking-tight ${color}`}
      >
        {loading ? (
          <span
            className="block h-8 w-24 animate-pulse rounded bg-slate-800"
            aria-label="Carregando"
          />
        ) : (
          value
        )}
      </div>
      <div className="openai-kpi-caption">
        {badge && <span className="openai-kpi-badge">{badge}</span>}
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          {hint}
        </p>
      </div>
    </article>
  );
}
