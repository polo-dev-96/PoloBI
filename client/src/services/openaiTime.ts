export const RECENT_TIME_ZONE = "America/Manaus";

export function recentTime(value: number, includeDate = false) {
  return new Intl.DateTimeFormat("pt-BR", {
    ...(includeDate ? ({ day: "2-digit", month: "2-digit" } as const) : {}),
    hour: "2-digit",
    minute: "2-digit",
    timeZone: RECENT_TIME_ZONE,
  }).format(value);
}
