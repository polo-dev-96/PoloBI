import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Database,
  Loader2,
  Maximize2,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { tablePage } from "@/services/openaiReport";

export function ValueHint({
  text,
  children,
}: {
  text: string;
  children?: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="openai-value-hint" tabIndex={0} aria-label={text}>
          {children ?? text}
        </span>
      </TooltipTrigger>
      <TooltipContent className="openai-tooltip max-w-80 break-words text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export function DashboardPanel({
  title,
  subtitle,
  icon,
  action,
  onExpand,
  children,
  id,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  action?: ReactNode;
  onExpand: () => void;
  children: ReactNode;
  id: string;
}) {
  const heading = useId();
  return (
    <section
      className="openai-dash-panel"
      data-panel={id}
      aria-labelledby={heading}
    >
      <div className="openai-dash-panel-heading">
        <span className="openai-dash-panel-icon" aria-hidden="true">
          {icon}
        </span>
        <div className="openai-dash-panel-title">
          <h2 id={heading}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="openai-dash-panel-actions">
          {action}
          <button
            type="button"
            className="openai-icon-button"
            onClick={onExpand}
            aria-label={`Ampliar ${title}`}
            title={`Ampliar ${title}`}
          >
            <Maximize2 size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="openai-dash-panel-body">{children}</div>
    </section>
  );
}

export function DashboardFeedback({
  loading,
  error,
  empty,
}: {
  loading?: boolean;
  error?: string;
  empty?: boolean;
}) {
  if (!loading && !error && !empty) return null;
  const Icon = loading ? Loader2 : error ? AlertCircle : Database;
  return (
    <div
      className={`openai-dash-feedback ${error ? "is-error" : ""}`}
      role="status"
    >
      <Icon
        size={19}
        aria-hidden="true"
        className={loading ? "animate-spin" : ""}
      />
      <span>
        {loading
          ? "Consultando a OpenAI…"
          : error || "Nenhum registro neste período."}
      </span>
    </div>
  );
}

export function StaleNotice({ error }: { error?: string }) {
  return error ? (
    <p className="openai-stale-notice" role="status">
      <AlertCircle size={12} aria-hidden="true" />
      <ValueHint
        text={`${error} Dados da última consulta mantidos; podem estar desatualizados.`}
      >
        Dados mantidos · falha na atualização
      </ValueHint>
    </p>
  ) : null;
}

export type DashboardColumn<T> = {
  label: string;
  render: (row: T) => ReactNode;
  width?: string;
  numeric?: boolean;
  sortDirection?: "descending";
};

export function DashboardTable<T>({
  label,
  columns,
  rows,
  rowKey,
  resetKey,
  rowHeight = 28,
}: {
  label: string;
  columns: DashboardColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  resetKey: string;
  rowHeight?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLTableSectionElement>(null);
  const pager = useRef<HTMLElement>(null);
  const [size, setSize] = useState(4);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [resetKey]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const available =
        element.clientHeight -
        (header.current?.getBoundingClientRect().height ?? 25) -
        (pager.current?.getBoundingClientRect().height ?? 30) -
        3;
      setSize(Math.max(1, Math.floor(available / rowHeight)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [rowHeight]);
  const bounds = tablePage(rows.length, page, size);
  return (
    <div ref={root} className="openai-paged-table" data-table={label}>
      <table>
        <caption className="sr-only">{label}</caption>
        <colgroup>
          {columns.map((column, index) => (
            <col key={index} style={{ width: column.width }} />
          ))}
        </colgroup>
        <thead ref={header}>
          <tr>
            {columns.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={column.numeric ? "is-numeric" : ""}
                aria-sort={column.sortDirection}
              >
                <ValueHint
                  text={
                    column.sortDirection
                      ? `${column.label} · maior para o menor`
                      : column.label
                  }
                >
                  {column.label}
                  {column.sortDirection && " ↓"}
                </ValueHint>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(bounds.start, bounds.end).map((row, index) => (
            <tr
              key={rowKey(row, bounds.start + index)}
              style={{ height: rowHeight }}
            >
              {columns.map((column, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={column.label} scope="row">
                    {column.render(row)}
                  </th>
                ) : (
                  <td
                    key={column.label}
                    className={column.numeric ? "is-numeric" : ""}
                  >
                    {column.render(row)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <nav
        ref={pager}
        className="openai-table-pagination"
        aria-label={`Paginação: ${label}`}
      >
        <span aria-live="polite">
          {rows.length ? bounds.start + 1 : 0}–{bounds.end} de {rows.length}
        </span>
        <div>
          <button
            type="button"
            className="openai-icon-button"
            disabled={bounds.page === 0}
            onClick={() => setPage(bounds.page - 1)}
            aria-label={`Página anterior: ${label}`}
          >
            <ChevronLeft size={13} aria-hidden="true" />
          </button>
          <span>
            {bounds.page + 1}/{bounds.pages}
          </span>
          <button
            type="button"
            className="openai-icon-button"
            disabled={bounds.page + 1 === bounds.pages}
            onClick={() => setPage(bounds.page + 1)}
            aria-label={`Próxima página: ${label}`}
          >
            <ChevronRight size={13} aria-hidden="true" />
          </button>
        </div>
      </nav>
    </div>
  );
}
