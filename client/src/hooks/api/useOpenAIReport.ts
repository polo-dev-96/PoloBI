import { useCallback, useEffect, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import type {
  OpenAICostReport,
  OpenAIProject,
  OpenAIRecentUsage,
  OpenAIReport,
  OpenAISourceState,
} from "@shared/openai";
import {
  previousMonthRanges,
  rankingDates,
  type RankingDays,
} from "@/services/openaiReport";

type Filters = { startDate: string; endDate: string; projectId: string };

export function useOpenAIReport(
  filters: Filters,
  rankingDays: RankingDays = 7,
) {
  const { token, logout } = useAuth();
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const request = useCallback(
    async <T>(url: string, signal: AbortSignal): Promise<T> => {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
        cache: "no-store",
      });
      if (response.status === 401) {
        logout();
        throw new Error("Sessão expirada. Entre novamente.");
      }
      const data = await response.json().catch(() => null);
      if (!response.ok || !data)
        throw new Error(
          typeof data?.message === "string"
            ? data.message
            : "Não foi possível consultar a OpenAI.",
        );
      return data as T;
    },
    [token, logout],
  );
  const options = {
    enabled: !!token,
    staleTime: 60_000,
    refetchInterval: visible ? 60_000 : (false as const),
    refetchOnWindowFocus: true,
    retry: false as const,
  };
  const params = (range: Filters) => {
    const search = new URLSearchParams({
      startDate: range.startDate,
      endDate: range.endDate,
    });
    if (range.projectId) search.set("projectId", range.projectId);
    return search;
  };
  const available = <T extends OpenAISourceState>(source: T): T => {
    if (source.status === "error")
      throw new Error(source.message || "Fonte indisponível. Tente atualizar.");
    return source;
  };
  const projects = useQuery({
    ...options,
    queryKey: ["openai", "projects", token],
    queryFn: ({ signal }) =>
      request<{ projects: OpenAIProject[] }>("/api/openai/projects", signal),
  });
  const reportKey = ["openai", "report", token, filters];
  const report = useQuery({
    ...options,
    queryKey: reportKey,
    queryFn: async ({ signal }) => {
      const next = await request<OpenAIReport>(
        `/api/openai/report?${params(filters)}`,
        signal,
      );
      const previous = queryClient.getQueryData<OpenAIReport>(reportKey);
      if (
        previous &&
        next.costs.status === "error" &&
        next.usage.every((source) => source.status === "error")
      )
        throw new Error(
          next.costs.message || "Não foi possível atualizar o relatório.",
        );
      return next;
    },
  });
  const comparisonQueries = useQueries({
    queries: previousMonthRanges(filters.startDate, filters.endDate).map(
      (dates) => {
        const range = { ...dates, projectId: filters.projectId };
        return {
          ...options,
          queryKey: ["openai", "costs", token, range],
          queryFn: async ({ signal }: { signal: AbortSignal }) => ({
            ...range,
            projectId: range.projectId || undefined,
            costs: available(
              await request<OpenAICostReport>(
                `/api/openai/costs?${params(range)}`,
                signal,
              ),
            ),
          }),
        };
      },
    ),
  });
  const range = {
    ...rankingDates(rankingDays, new Date(`${filters.endDate}T12:00:00Z`)),
    projectId: filters.projectId,
  };
  const ranking = useQuery({
    ...options,
    queryKey: ["openai", "ranking", token, range],
    queryFn: async ({ signal }) =>
      available(
        await request<OpenAICostReport>(
          `/api/openai/costs?${params(range)}`,
          signal,
        ),
      ),
  });
  const recent = useQuery({
    ...options,
    queryKey: ["openai", "recent", token, filters.projectId],
    queryFn: async ({ signal }) => {
      const search = new URLSearchParams();
      if (filters.projectId) search.set("projectId", filters.projectId);
      return available(
        await request<OpenAIRecentUsage>(
          `/api/openai/recent-usage?${search}`,
          signal,
        ),
      );
    },
  });
  return {
    projects,
    report,
    recent,
    ranking,
    visible,
    comparison: {
      reports: comparisonQueries.map((query) => query.data),
      isPending: comparisonQueries.some((query) => query.isPending),
      hasError: comparisonQueries.some((query) => query.isError),
    },
    refreshing: [projects, report, ranking, recent, ...comparisonQueries].some(
      (query) => query.isFetching,
    ),
    refresh: () =>
      Promise.all([
        projects.refetch(),
        report.refetch(),
        ranking.refetch(),
        recent.refetch(),
        ...comparisonQueries.map((query) => query.refetch()),
      ]),
  };
}
