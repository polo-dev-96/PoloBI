import { useQuery } from "@tanstack/react-query";
import {
  EXCHANGE_REFRESH_MS,
  EXCHANGE_URL,
  parseDollarQuote,
} from "@/services/openaiCurrency";

export function useDollarQuote(enabled: boolean, visible: boolean) {
  return useQuery({
    queryKey: ["openai", "usd-brl-quote"],
    enabled,
    staleTime: EXCHANGE_REFRESH_MS,
    refetchInterval: visible ? EXCHANGE_REFRESH_MS : false,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async ({ signal }) => {
      // Consulta pública: nunca enviar credenciais da aplicação ou da OpenAI.
      const response = await fetch(EXCHANGE_URL, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error("Não foi possível atualizar a cotação USD/BRL.");
      return parseDollarQuote(await response.json());
    },
  });
}
