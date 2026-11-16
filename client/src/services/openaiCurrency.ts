import type { OpenAICostReport } from "@shared/openai";

export const EXCHANGE_REFRESH_MS = 5 * 60_000;
export const EXCHANGE_URL =
  "https://economia.awesomeapi.com.br/json/last/USD-BRL";

export interface DollarQuote {
  rate: number;
  quotedAt: string;
}

export function parseDollarQuote(value: unknown): DollarQuote {
  const quote = (value as { USDBRL?: Record<string, unknown> } | null)?.USDBRL;
  const rate = Number(quote?.ask);
  const timestamp = Number(quote?.timestamp) * 1000;
  if (
    quote?.code !== "USD" ||
    quote.codein !== "BRL" ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0 ||
    !Number.isFinite(new Date(timestamp).getTime())
  )
    throw new Error("A fonte retornou uma cotação inválida.");
  return { rate, quotedAt: new Date(timestamp).toISOString() };
}

// Somente apresentação: os valores e a precisão originais permanecem no cache.
export function costsInReais(
  costs: OpenAICostReport,
  rate: number,
): OpenAICostReport {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Cotação inválida.");
  const convert = <T extends { amount: string; currency: string }>(
    money: T,
  ): T =>
    money.currency === "USD"
      ? {
          ...money,
          currency: "BRL",
          amount: String(Number(money.amount) * rate),
        }
      : { ...money };
  return {
    ...costs,
    totals: costs.totals.map(convert),
    daily: costs.daily.map((day) => ({
      ...day,
      amounts: day.amounts.map(convert),
    })),
    rows: costs.rows.map(convert),
  };
}
