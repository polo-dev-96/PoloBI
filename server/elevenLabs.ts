import type { Express } from "express";

const MAX_TEXT_LENGTH = 1500;
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const QUOTA_RETRY_MS = 5 * 60_000;

export function registerElevenLabsRoute(app: Express): void {
  const requests = new Map<string, { count: number; expiresAt: number }>();
  let quotaRetryAt = 0;

  app.post("/api/announcements/speech", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
    if (!apiKey || !voiceId || Date.now() < quotaRetryAt) return res.sendStatus(503);
    const speedValue = process.env.ELEVENLABS_VOICE_SPEED?.trim();
    const speed = speedValue ? Number(speedValue) : NaN;
    const voiceSettings = Number.isFinite(speed) && speed >= 0.7 && speed <= 1.2
      ? { speed }
      : undefined;

    const text = req.body?.text;
    if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_LENGTH) {
      return res.sendStatus(400);
    }

    const now = Date.now();
    requests.forEach((entry, address) => {
      if (entry.expiresAt <= now) requests.delete(address);
    });
    const address = req.ip || "unknown";
    const entry = requests.get(address) ?? { count: 0, expiresAt: now + RATE_WINDOW_MS };
    if (entry.count >= MAX_REQUESTS_PER_WINDOW) return res.sendStatus(429);
    entry.count += 1;
    requests.set(address, entry);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", onClose);
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
        {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({
            text: text.trim(),
            model_id: process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_multilingual_v2",
            ...(voiceSettings && { voice_settings: voiceSettings }),
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { detail?: { code?: string; status?: string; type?: string } } | null;
        const detail = error?.detail;
        if (response.status === 402 || detail?.type === "payment_required" ||
            [detail?.code, detail?.status].some((code) => code === "quota_exceeded" || code === "insufficient_credits")) {
          quotaRetryAt = Date.now() + QUOTA_RETRY_MS;
        }
        return res.sendStatus(503);
      }
      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length || !response.headers.get("content-type")?.startsWith("audio/")) return res.sendStatus(502);
      res.type("audio/mpeg").send(audio);
    } catch {
      if (!res.destroyed) res.sendStatus(503);
    } finally {
      clearTimeout(timeout);
      res.off("close", onClose);
    }
  });
}
