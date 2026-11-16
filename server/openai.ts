import type { Express } from "express";
import { z } from "zod";
import {
  OPENAI_METRICS,
  OPENAI_USAGE_CATEGORIES,
  type OpenAICostReport,
  type OpenAIErrorCode,
  type OpenAIMetrics,
  type OpenAIMoney,
  type OpenAIProject,
  type OpenAIReport,
  type OpenAIRecentUsage,
  type OpenAIUsageReport,
} from "../shared/openai";
import { requireAdmin } from "./adminSession";

const DAY = 86_400_000;
const TTL = 60_000;
const projectIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const recentUsageQuerySchema = z
  .object({ projectId: projectIdSchema.optional() })
  .strict();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  });
export const reportQuerySchema = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    projectId: projectIdSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = Date.parse(value.startDate);
    const end = Date.parse(value.endDate);
    const today = Math.floor(Date.now() / DAY) * DAY;
    if (end < start || end - start >= 90 * DAY || end > today) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selecione até 90 dias, sem datas futuras.",
      });
    }
  });
type ReportQuery = z.infer<typeof reportQuerySchema>;
const bucketSchema = z.object({
  start_time: z.number().finite(),
  end_time: z.number().finite().optional(),
  results: z.array(z.record(z.unknown())),
});
const pageSchema = z.object({
  data: z.array(bucketSchema),
  has_more: z.boolean().optional(),
  next_page: z.string().nullable().optional(),
});
type Bucket = z.infer<typeof bucketSchema>;
const messages: Record<OpenAIErrorCode, string> = {
  not_configured:
    "A chave administrativa da OpenAI não está configurada no servidor.",
  invalid_key: "A OpenAI recusou a chave administrativa configurada.",
  forbidden: "A chave não tem permissão para consultar estes dados.",
  rate_limited:
    "Limite de consultas da OpenAI atingido. Aguarde a próxima atualização.",
  unavailable:
    "Não foi possível consultar esta categoria na OpenAI. Tente atualizar novamente.",
};
export class OpenAIServiceError extends Error {
  constructor(public code: OpenAIErrorCode) {
    super(messages[code]);
  }
}

// Soma decimal exata; a conversão para Number fica restrita à apresentação dos gráficos.
export function sumDecimal(values: (string | number)[]): string {
  const parts = values.map((value) => {
    const match = String(value).match(
      /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i,
    );
    if (!match) throw new OpenAIServiceError("unavailable");
    const scale = (match[3]?.length ?? 0) - Number(match[4] ?? 0);
    return { digits: BigInt(`${match[1]}${match[2]}${match[3] ?? ""}`), scale };
  });
  const scale = Math.max(0, ...parts.map((part) => part.scale));
  const zero = BigInt(0);
  const total = parts.reduce(
    (sum, part) =>
      sum + part.digits * BigInt(`1${"0".repeat(scale - part.scale)}`),
    zero,
  );
  const sign = total < zero ? "-" : "";
  const digits = (total < zero ? -total : total)
    .toString()
    .padStart(scale + 1, "0");
  if (!scale) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(
    /\.?0+$/,
    "",
  );
}

function addMetrics(target: OpenAIMetrics, source: Record<string, unknown>) {
  for (const key of Object.keys(OPENAI_METRICS) as (keyof OpenAIMetrics)[]) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      throw new OpenAIServiceError("unavailable");
    target[key] = (target[key] ?? 0) + value;
  }
}
const identifier = (value: unknown) =>
  typeof value === "string" ? value : null;
const bucketDate = (bucket: Bucket) =>
  new Date(bucket.start_time * 1000).toISOString().slice(0, 10);

export function aggregateUsage(
  category: (typeof OPENAI_USAGE_CATEGORIES)[number],
  buckets: Bucket[],
  fetchedAt: string,
): OpenAIUsageReport {
  const daily = new Map<string, OpenAIMetrics>();
  const rows = new Map<string, OpenAIUsageReport["rows"][number]>();
  const totals: OpenAIMetrics = {};
  const latestDay = buckets.length
    ? Math.max(...buckets.map((bucket) => bucket.start_time))
    : null;
  for (const bucket of buckets) {
    const date = bucketDate(bucket);
    const day = daily.get(date) ?? {};
    for (const result of bucket.results) {
      addMetrics(day, result);
      // Armazenamento é um retrato do último dia, não a soma de bytes de vários dias.
      if (category.id === "vector_stores" && bucket.start_time !== latestDay)
        continue;
      const projectId = identifier(result.project_id);
      const model = identifier(result.model);
      const key = JSON.stringify([projectId, model]);
      const row = rows.get(key) ?? { projectId, model, metrics: {} };
      addMetrics(row.metrics, result);
      addMetrics(totals, result);
      rows.set(key, row);
    }
    daily.set(date, day);
  }
  return {
    id: category.id,
    label: category.label,
    status: "ok",
    fetchedAt,
    totals,
    daily: Array.from(daily)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, metrics]) => ({ date, metrics })),
    rows: Array.from(rows.values()),
  };
}

export function aggregateCosts(
  buckets: Bucket[],
  fetchedAt: string,
): OpenAICostReport {
  const totals = new Map<string, string>();
  const daily = new Map<string, Map<string, string>>();
  const rows = new Map<string, OpenAICostReport["rows"][number]>();
  for (const bucket of buckets) {
    const date = bucketDate(bucket);
    const day = daily.get(date) ?? new Map<string, string>();
    for (const result of bucket.results) {
      const amount = z
        .object({
          value: z.union([z.number().finite(), z.string().max(100)]),
          currency: z.string().regex(/^[a-zA-Z]{3}$/),
        })
        .parse(result.amount);
      const currency = amount.currency.toUpperCase();
      const projectId = identifier(result.project_id);
      const lineItem = identifier(result.line_item);
      const key = JSON.stringify([projectId, lineItem, currency]);
      const row = rows.get(key) ?? {
        projectId,
        lineItem,
        currency,
        amount: "0",
      };
      row.amount = sumDecimal([row.amount, amount.value]);
      rows.set(key, row);
      totals.set(
        currency,
        sumDecimal([totals.get(currency) ?? "0", amount.value]),
      );
      day.set(currency, sumDecimal([day.get(currency) ?? "0", amount.value]));
    }
    daily.set(date, day);
  }
  const amounts = (map: Map<string, string>): OpenAIMoney[] =>
    Array.from(map).map(([currency, amount]) => ({ currency, amount }));
  return {
    status: "ok",
    fetchedAt,
    totals: amounts(totals),
    rows: Array.from(rows.values()),
    daily: Array.from(daily)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, map]) => ({ date, amounts: amounts(map) })),
  };
}

export function aggregateRecentUsage(
  buckets: Bucket[],
  start: number,
  end: number,
  fetchedAt: string,
  projectId?: string,
): OpenAIRecentUsage {
  const byMinute = new Map<number, OpenAIMetrics>();
  for (const bucket of buckets) {
    if (
      bucket.start_time >= end ||
      (bucket.end_time ?? bucket.start_time + 60) <= start
    )
      continue;
    const minute = Math.floor(bucket.start_time / 60) * 60;
    const metrics = byMinute.get(minute) ?? {};
    bucket.results.forEach((result) => addMetrics(metrics, result));
    byMinute.set(minute, metrics);
  }
  const totals: OpenAIMetrics = {};
  const series: OpenAIRecentUsage["series"] = [];
  for (let minute = Math.floor(start / 60) * 60; minute < end; minute += 60) {
    const metrics = byMinute.get(minute) ?? {};
    addMetrics(totals, metrics);
    series.push({
      startTime: new Date(Math.max(start, minute) * 1000).toISOString(),
      endTime: new Date(Math.min(end, minute + 60) * 1000).toISOString(),
      partial: minute < start || minute + 60 > end,
      metrics,
    });
  }
  return {
    status: "ok",
    fetchedAt,
    projectId,
    startTime: new Date(start * 1000).toISOString(),
    endTime: new Date(end * 1000).toISOString(),
    totals,
    series,
  };
}

export function createOpenAIService(
  options: {
    fetch?: typeof fetch;
    now?: () => number;
    getKey?: () => string | undefined;
  } = {},
) {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const getKey = options.getKey ?? (() => process.env.OPENAI_ADMIN_KEY?.trim());
  let active = 0;
  let retryAt = 0;
  const waiting: (() => void)[] = [];
  async function get(path: string, params: URLSearchParams): Promise<unknown> {
    const key = getKey();
    if (!key) throw new OpenAIServiceError("not_configured");
    if (active >= 4)
      await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      if (now() < retryAt) throw new OpenAIServiceError("rate_limited");
      const response = await request(
        `https://api.openai.com/v1/organization/${path}?${params}`,
        {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          const delay =
            retryAfter && /^\d+(\.\d+)?$/.test(retryAfter)
              ? Number(retryAfter) * 1000
              : retryAfter
                ? Date.parse(retryAfter) - now()
                : TTL;
          retryAt = now() + Math.max(TTL, Number.isFinite(delay) ? delay : TTL);
        }
        throw new OpenAIServiceError(
          response.status === 401
            ? "invalid_key"
            : response.status === 403
              ? "forbidden"
              : response.status === 429
                ? "rate_limited"
                : "unavailable",
        );
      }
      return await response.json();
    } catch (error) {
      throw error instanceof OpenAIServiceError
        ? error
        : new OpenAIServiceError("unavailable");
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }
  async function buckets(
    path: string,
    query: ReportQuery,
    groups: string[],
  ): Promise<Bucket[]> {
    const params = new URLSearchParams({
      start_time: String(Date.parse(query.startDate) / 1000),
      // Custos exigem o limite diário completo para retornar o bucket parcial de hoje.
      end_time: String(
        Math.floor(
          (path === "costs"
            ? Date.parse(query.endDate) + DAY
            : Math.min(Date.parse(query.endDate) + DAY, now())) / 1000,
        ),
      ),
      bucket_width: "1d",
      limit: path === "costs" ? "90" : "31",
    });
    groups.forEach((group) => params.append("group_by", group));
    if (query.projectId) params.append("project_ids", query.projectId);
    return readBuckets(path, params);
  }
  async function readBuckets(
    path: string,
    params: URLSearchParams,
  ): Promise<Bucket[]> {
    const all: Bucket[] = [];
    const cursors = new Set<string>();
    for (;;) {
      const page = pageSchema.parse(await get(path, params));
      all.push(...page.data);
      if (!page.next_page) {
        if (page.has_more) throw new OpenAIServiceError("unavailable");
        break;
      }
      if (cursors.has(page.next_page))
        throw new OpenAIServiceError("unavailable");
      cursors.add(page.next_page);
      params.set("page", page.next_page);
    }
    return all;
  }
  const cache = new Map<
    string,
    { expiresAt: number; value: Promise<OpenAIReport> }
  >();
  type CacheEntry<T> = { expiresAt: number; value: Promise<T> };
  const costCache = new Map<string, CacheEntry<OpenAICostReport>>();
  const recentCache = new Map<string, CacheEntry<OpenAIRecentUsage>>();
  function cached<T>(
    entries: Map<string, CacheEntry<T>>,
    key: string,
    load: () => Promise<T>,
  ) {
    const previous = entries.get(key);
    if (previous && previous.expiresAt > now()) return previous.value;
    for (const [id, entry] of Array.from(entries))
      if (entry.expiresAt <= now()) entries.delete(id);
    if (entries.size >= 20) entries.delete(entries.keys().next().value!);
    const value = load();
    const entry = { expiresAt: Infinity, value };
    entries.set(key, entry);
    void value.then(
      () => {
        entry.expiresAt = now() + TTL;
      },
      () => {
        entries.delete(key);
      },
    );
    return value;
  }
  const stamp = () => new Date(now()).toISOString();
  function failure(error: unknown) {
    const code =
      error instanceof OpenAIServiceError ? error.code : "unavailable";
    return {
      status: "error" as const,
      errorCode: code,
      message: messages[code],
      fetchedAt: stamp(),
    };
  }
  function costs(query: ReportQuery): Promise<OpenAICostReport> {
    const key = JSON.stringify([
      query.startDate,
      query.endDate,
      query.projectId ?? null,
    ]);
    return cached(costCache, key, () =>
      buckets("costs", query, ["project_id", "line_item"])
        .then((data) => aggregateCosts(data, stamp()))
        .catch((error): OpenAICostReport => ({
          ...failure(error),
          totals: [],
          daily: [],
          rows: [],
        })),
    );
  }
  let projectCache:
    { expiresAt: number; value: Promise<OpenAIProject[]> } | undefined;
  return {
    costs,
    recentUsage(projectId?: string): Promise<OpenAIRecentUsage> {
      return cached(recentCache, projectId ?? "", async () => {
        const end = Math.floor(now() / 1000);
        const start = end - 3 * 3600;
        const params = new URLSearchParams({
          start_time: String(start),
          end_time: String(end),
          bucket_width: "1m",
          limit: "1440",
        });
        if (projectId) params.set("project_ids", projectId);
        try {
          const data = await readBuckets("usage/completions", params);
          return aggregateRecentUsage(data, start, end, stamp(), projectId);
        } catch (error) {
          return {
            ...failure(error),
            projectId,
            startTime: new Date(start * 1000).toISOString(),
            endTime: new Date(end * 1000).toISOString(),
            totals: {},
            series: [],
          };
        }
      });
    },
    projects(): Promise<OpenAIProject[]> {
      if (projectCache && projectCache.expiresAt > now())
        return projectCache.value;
      const value = (async () => {
        const params = new URLSearchParams({
          limit: "100",
          include_archived: "true",
        });
        const all: OpenAIProject[] = [];
        const cursors = new Set<string>();
        for (;;) {
          const page = z
            .object({
              data: z.array(
                z.object({
                  id: z.string(),
                  name: z.string().nullable().optional(),
                  status: z.string().nullable().optional(),
                }),
              ),
              has_more: z.boolean(),
              last_id: z.string().nullable().optional(),
            })
            .parse(await get("projects", params));
          all.push(
            ...page.data.map((project) => ({
              id: project.id,
              name: project.name || project.id,
              status: project.status || "unknown",
            })),
          );
          if (!page.has_more) break;
          if (!page.last_id || cursors.has(page.last_id))
            throw new OpenAIServiceError("unavailable");
          cursors.add(page.last_id);
          params.set("after", page.last_id);
        }
        return all;
      })();
      const entry = { expiresAt: Infinity, value };
      projectCache = entry;
      void value.then(
        () => {
          entry.expiresAt = now() + TTL;
        },
        () => {},
      );
      void value.catch(() => {
        if (projectCache?.value === value) projectCache = undefined;
      });
      return value;
    },
    report(query: ReportQuery): Promise<OpenAIReport> {
      const key = JSON.stringify([
        query.startDate,
        query.endDate,
        query.projectId ?? null,
      ]);
      const existing = cache.get(key);
      if (existing && existing.expiresAt > now()) return existing.value;
      for (const [cachedKey, entry] of Array.from(cache))
        if (entry.expiresAt <= now()) cache.delete(cachedKey);
      if (cache.size >= 20) cache.delete(cache.keys().next().value!);
      const value = (async () => {
        const [costReport, usage] = await Promise.all([
          costs(query),
          Promise.all(
            OPENAI_USAGE_CATEGORIES.map(
              async (category): Promise<OpenAIUsageReport> => {
                try {
                  const data = await buckets(
                    `usage/${category.id}`,
                    query,
                    category.model ? ["project_id", "model"] : ["project_id"],
                  );
                  return aggregateUsage(category, data, stamp());
                } catch (error) {
                  return {
                    ...failure(error),
                    id: category.id,
                    label: category.label,
                    totals: {},
                    daily: [],
                    rows: [],
                  };
                }
              },
            ),
          ),
        ]);
        return { ...query, fetchedAt: stamp(), costs: costReport, usage };
      })();
      // Manter a entrada durante consultas longas também evita pedidos duplicados.
      const entry = { expiresAt: Infinity, value };
      cache.set(key, entry);
      void value.then(
        () => {
          entry.expiresAt = now() + TTL;
        },
        () => cache.delete(key),
      );
      return value;
    },
  };
}

export function registerOpenAIRoutes(app: Express) {
  const service = createOpenAIService();
  app.get("/api/openai/costs", requireAdmin, async (req, res) => {
    const parsed = reportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({
          message:
            "Informe um período válido de até 90 dias, sem datas futuras.",
        });
      return;
    }
    res.json(await service.costs(parsed.data));
  });
  app.get("/api/openai/recent-usage", requireAdmin, async (req, res) => {
    const parsed = recentUsageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: "Informe um projeto válido." });
      return;
    }
    res.json(await service.recentUsage(parsed.data.projectId));
  });
  app.get("/api/openai/projects", requireAdmin, async (_req, res) => {
    try {
      res.json({ projects: await service.projects() });
    } catch (error) {
      const code =
        error instanceof OpenAIServiceError ? error.code : "unavailable";
      res
        .status(code === "rate_limited" ? 429 : 503)
        .json({ code, message: messages[code] });
    }
  });
  app.get("/api/openai/report", requireAdmin, async (req, res) => {
    const parsed = reportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        message: "Informe um período válido de até 90 dias, sem datas futuras.",
      });
      return;
    }
    try {
      res.json(await service.report(parsed.data));
    } catch {
      res
        .status(503)
        .json({ code: "unavailable", message: messages.unavailable });
    }
  });
}
