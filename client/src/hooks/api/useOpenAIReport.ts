import { useCallback, useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import type { OpenAIProject, OpenAIReport } from "@shared/openai";
import { periodDates, previousMonthRanges } from "@/services/openaiReport";

export function useOpenAIReport(filters: {
  startDate: string;
  endDate: string;
  projectId: string;
}) {
  const { token, logout } = useAuth();
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
      if (!response.ok)
        throw new Error(
          typeof data?.message === "string"
            ? data.message
            : "Não foi possível consultar a OpenAI.",
        );
      if (!data)
        throw new Error(
          "O servidor retornou uma resposta inválida. Tente atualizar novamente.",
        );
      return data as T;
    },
    [token, logout],
  );
  const projects = useQuery({
    queryKey: ["openai", "projects", token],
    queryFn: ({ signal }) =>
      request<{ projects: OpenAIProject[] }>("/api/openai/projects", signal),
    enabled: !!token,
    staleTime: 60_000,
    refetchInterval: visible ? 60_000 : false,
    refetchOnWindowFocus: true,
  });
  const readReport = (range: typeof filters, signal: AbortSignal) => {
    const params = new URLSearchParams({
      startDate: range.startDate,
      endDate: range.endDate,
    });
    if (range.projectId) params.set("projectId", range.projectId);
    return request<OpenAIReport>(`/api/openai/report?${params}`, signal);
  };
  const report = useQuery({
    queryKey: ["openai", "report", token, filters],
    queryFn: ({ signal }) => readReport(filters, signal),
    enabled: !!token,
    staleTime: 60_000,
    refetchInterval: visible ? 60_000 : false,
    refetchOnWindowFocus: true,
  });
  const month = { ...periodDates("month"), projectId: filters.projectId };
  const usesCurrentReport =
    filters.startDate === month.startDate && filters.endDate === month.endDate;
  const monthQuery = useQuery({
    queryKey: ["openai", "report", token, month],
    queryFn: ({ signal }) => readReport(month, signal),
    enabled: !!token && !usesCurrentReport,
    staleTime: 60_000,
    refetchInterval: visible ? 60_000 : false,
    refetchOnWindowFocus: true,
  });
  const comparisonQueries = useQueries({
    queries: previousMonthRanges(filters.startDate, filters.endDate).map(
      (range) => {
        const previous = { ...range, projectId: filters.projectId };
        return {
          queryKey: ["openai", "report", token, previous],
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            readReport(previous, signal),
          enabled: !!token,
          staleTime: 60_000,
          refetchInterval: visible ? 60_000 : (false as const),
          refetchOnWindowFocus: true,
        };
      },
    ),
  });
  return {
    projects,
    report,
    monthlyReport: usesCurrentReport ? report : monthQuery,
    comparison: {
      reports: comparisonQueries.map((query) => query.data),
      isPending: comparisonQueries.some((query) => query.isPending),
      isFetching: comparisonQueries.some((query) => query.isFetching),
      hasError: comparisonQueries.some(
        (query) => query.isError || query.data?.costs.status === "error",
      ),
      refetch: () =>
        Promise.all(comparisonQueries.map((query) => query.refetch())),
    },
    visible,
  };
}
