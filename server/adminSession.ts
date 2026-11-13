import { createHash, randomBytes } from "node:crypto";
import type { RequestHandler } from "express";

const SESSION_TTL = 12 * 60 * 60 * 1000;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export function createAdminSessions(now: () => number = Date.now) {
  const sessions = new Map<string, number>();
  const prune = () => {
    for (const [key, expiresAt] of Array.from(sessions))
      if (expiresAt <= now()) sessions.delete(key);
  };
  return {
    create() {
      prune();
      const token = randomBytes(32).toString("hex");
      sessions.set(digest(token), now() + SESSION_TTL);
      return token;
    },
    verify(token?: string) {
      prune();
      return !!token && sessions.has(digest(token));
    },
    revoke(token?: string) {
      if (token) sessions.delete(digest(token));
    },
  };
}

export const adminSessions = createAdminSessions();
export function bearerToken(authorization?: string) {
  return authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
}
export const requireAdmin: RequestHandler = (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminSessions.verify(bearerToken(req.headers.authorization))) {
    res
      .status(401)
      .json({ message: "Sessão expirada. Entre novamente para continuar." });
    return;
  }
  next();
};
