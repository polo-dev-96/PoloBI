import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import { createAdminSessions, adminSessions } from "./adminSession";
import {
  aggregateCosts,
  aggregateUsage,
  aggregateRecentUsage,
  createOpenAIService,
  registerOpenAIRoutes,
  reportQuerySchema,
  sumDecimal,
} from "./openai";
import { registerRoutes } from "./routes";
import { OPENAI_USAGE_CATEGORIES } from "../shared/openai";

const stamp = "2026-01-03T12:00:00Z";
const start = Date.parse("2026-01-01") / 1000;
const query = { startDate: "2026-01-01", endDate: "2026-01-02" };
const bucket = (results: Record<string, unknown>[], offset = 0) => ({
  start_time: start + offset * 86400,
  results,
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const mockFetch =
  (handler: (url: URL) => Response | Promise<Response>): typeof fetch =>
  async (url) =>
    handler(new URL(String(url)));

test("sessões são aleatórias, expiram após 12 horas e podem ser revogadas", () => {
  let time = 0;
  const sessions = createAdminSessions(() => time);
  const first = sessions.create();
  const second = sessions.create();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.equal(sessions.verify("qualquer-token"), false);
  assert.equal(sessions.verify(first), true);
  sessions.revoke(first);
  assert.equal(sessions.verify(first), false);
  time = 12 * 3600_000;
  assert.equal(sessions.verify(second), false);
});

test("valida dias reais, ordem, limite inclusivo de 90 dias e filtros", () => {
  assert.equal(reportQuerySchema.safeParse(query).success, true);
  for (const invalid of [
    { ...query, startDate: "2026-02-30" },
    { ...query, endDate: "2025-01-01" },
    { startDate: "2025-01-01", endDate: "2025-04-01" },
    { ...query, projectId: ["proj-a"] },
    { ...query, unexpected: "value" },
    { ...query, endDate: "2999-01-01" },
  ])
    assert.equal(reportQuerySchema.safeParse(invalid).success, false);
  assert.equal(
    reportQuerySchema.safeParse({
      startDate: "2025-01-01",
      endDate: "2025-03-31",
    }).success,
    true,
  );
});

test("soma financeira é decimal exata, incluindo valores pequenos e créditos", () => {
  assert.equal(sumDecimal([0.1, 0.2]), "0.3");
  assert.equal(sumDecimal(["0.000000000001", 1e-12]), "0.000000000002");
  assert.equal(sumDecimal(["10.00", "-0.10", "-0.20"]), "9.7");
  assert.equal(sumDecimal([1e3, 1e-3]), "1000.001");
  assert.equal(sumDecimal(["1", "-1"]), "0");
});

test("custos preservam moedas, dias, projetos e itens sem arredondar linhas", () => {
  const costs = aggregateCosts(
    [
      bucket([
        {
          project_id: "proj-a",
          line_item: "modelo, input",
          amount: { value: 0.1, currency: "usd" },
        },
      ]),
      bucket(
        [
          {
            project_id: "proj-a",
            line_item: "modelo, input",
            amount: { value: 0.2, currency: "usd" },
          },
          { amount: { value: 2.12, currency: "eur" } },
        ],
        1,
      ),
    ],
    stamp,
  );
  assert.deepEqual(costs.totals, [
    { currency: "USD", amount: "0.3" },
    { currency: "EUR", amount: "2.12" },
  ]);
  assert.equal(costs.rows[0].amount, "0.3");
  assert.equal(costs.daily[1].date, "2026-01-02");
  assert.equal(costs.rows[1].projectId, null);
});

test("consumo não soma cache novamente e mantém as categorias separadas", () => {
  const usage = aggregateUsage(
    OPENAI_USAGE_CATEGORIES[0],
    [
      bucket([
        {
          project_id: "proj-a",
          model: "modelo-a",
          input_tokens: 100,
          input_cached_tokens: 60,
          output_tokens: 20,
          num_model_requests: 2,
        },
        {
          project_id: "proj-b",
          model: "modelo-a",
          input_tokens: 200,
          input_cached_tokens: 100,
          output_tokens: 30,
          num_model_requests: 3,
        },
      ]),
    ],
    stamp,
  );
  assert.equal(usage.totals.input_tokens, 300);
  assert.equal(usage.totals.input_cached_tokens, 160);
  assert.equal(usage.totals.num_model_requests, 5);
  assert.equal(usage.rows.length, 2);
});

test("custos incluem hoje até o limite exclusivo do dia seguinte, mantendo consumo até agora", async () => {
  const current = {
    startDate: "2026-01-01",
    endDate: "2026-01-03",
    projectId: "proj-a",
  };
  const tomorrow = Date.parse("2026-01-04") / 1000;
  for (const hour of ["00:05:00", "23:59:00"]) {
    const time = Date.parse(`2026-01-03T${hour}Z`);
    const service = createOpenAIService({
      getKey: () => "test-only",
      now: () => time,
      fetch: mockFetch((url) => {
        const isCost = url.pathname.endsWith("/costs");
        const historical =
          url.searchParams.get("end_time") ===
          String(Date.parse("2026-01-03") / 1000);
        assert.equal(url.searchParams.get("project_ids"), "proj-a");
        assert.equal(
          url.searchParams.get("end_time"),
          String(
            historical
              ? Date.parse("2026-01-03") / 1000
              : isCost
                ? tomorrow
                : time / 1000,
          ),
        );
        if (isCost)
          assert.deepEqual(url.searchParams.getAll("group_by"), [
            "project_id",
            "line_item",
          ]);
        return response({
          data:
            isCost && !historical
              ? [
                  bucket(
                    [
                      {
                        project_id: "proj-a",
                        amount: { value: "5.921378035", currency: "usd" },
                      },
                    ],
                    2,
                  ),
                ]
              : [],
          has_more: false,
        });
      }),
    });
    const month = await service.report(current);
    assert.equal(month.costs.status, "ok");
    assert.equal(month.costs.daily[0].date, "2026-01-03");
    assert.equal(month.costs.totals[0].amount, "5.921378035");
    const today = await service.report({ ...current, startDate: "2026-01-03" });
    assert.equal(today.costs.totals[0].amount, month.costs.totals[0].amount);
    const past = await service.report({ ...current, endDate: "2026-01-02" });
    assert.deepEqual(past.costs.daily, []);
  }
});

test("armazenamento reflete o último dia sem acumular snapshots", () => {
  const vector = OPENAI_USAGE_CATEGORIES.find(
    (category) => category.id === "vector_stores",
  )!;
  const usage = aggregateUsage(
    vector,
    [
      bucket([{ project_id: "a", usage_bytes: 400 }]),
      bucket([{ project_id: "a", usage_bytes: 100 }], 1),
    ],
    stamp,
  );
  assert.equal(usage.totals.usage_bytes, 100);
  assert.equal(usage.rows[0].metrics.usage_bytes, 100);
  assert.equal(usage.daily[0].metrics.usage_bytes, 400);
});

test("pagina todas as categorias, respeita grupos e filtros, limita concorrência e deduplica cache", async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  let time = Date.parse(stamp);
  const service = createOpenAIService({
    getKey: () => "test-only",
    now: () => time,
    fetch: mockFetch(async (url) => {
      calls++;
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      assert.equal(url.searchParams.get("project_ids"), "proj-a");
      assert.equal(url.searchParams.get("bucket_width"), "1d");
      assert.equal(
        url.searchParams.get("end_time"),
        String(Date.parse("2026-01-03") / 1000),
      );
      const vectorOrCode = /vector_stores|code_interpreter_sessions/.test(
        url.pathname,
      );
      if (vectorOrCode)
        assert.deepEqual(url.searchParams.getAll("group_by"), ["project_id"]);
      const last = url.searchParams.has("page");
      return response({
        data: [bucket([])],
        has_more: !last,
        next_page: last ? null : "next",
      });
    }),
  });
  const filters = { ...query, projectId: "proj-a" };
  const first = service.report(filters);
  assert.equal(service.report(filters), first);
  const report = await first;
  assert.equal(peak, 4);
  assert.equal(calls, (OPENAI_USAGE_CATEGORIES.length + 1) * 2);
  assert.equal(
    report.usage.every((category) => category.status === "ok"),
    true,
  );
  await service.report(filters);
  assert.equal(calls, 24);
  time += 60_001;
  await service.report(filters);
  assert.equal(calls, 48);
});

test("inclui projetos arquivados e pagina a lista", async () => {
  let calls = 0;
  const service = createOpenAIService({
    getKey: () => "test-only",
    fetch: mockFetch((url) => {
      calls++;
      assert.equal(url.searchParams.get("include_archived"), "true");
      return response(
        url.searchParams.has("after")
          ? {
              data: [{ id: "b", name: "Projeto antigo", status: "archived" }],
              has_more: false,
            }
          : {
              data: [{ id: "a", name: null, status: "active" }],
              has_more: true,
              last_id: "a",
            },
      );
    }),
  });
  const projects = await service.projects();
  assert.equal(projects.length, 2);
  assert.equal(projects[1].status, "archived");
  assert.equal(projects[0].name, "a");
  await service.projects();
  assert.equal(calls, 2);
});

test("falhas parciais 401/403 não removem fontes disponíveis", async () => {
  const service = createOpenAIService({
    getKey: () => "test-only",
    fetch: mockFetch((url) => {
      if (url.pathname.endsWith("/costs")) return response({}, 401);
      if (url.pathname.endsWith("/images")) return response({}, 403);
      return response({ data: [bucket([])], next_page: null });
    }),
  });
  const report = await service.report(query);
  assert.equal(report.costs.errorCode, "invalid_key");
  assert.equal(
    report.usage.find((category) => category.id === "images")?.errorCode,
    "forbidden",
  );
  assert.equal(
    report.usage.find((category) => category.id === "completions")?.status,
    "ok",
  );
});

test("429 interrompe novas chamadas durante o Retry-After", async () => {
  let calls = 0;
  let time = Date.parse(stamp);
  const service = createOpenAIService({
    getKey: () => "test-only",
    now: () => time,
    fetch: mockFetch(() => {
      calls++;
      return new Response("{}", {
        status: 429,
        headers: { "Retry-After": "120" },
      });
    }),
  });
  const first = await service.report(query);
  assert.equal(
    first.usage.every((category) => category.errorCode === "rate_limited"),
    true,
  );
  const previous = calls;
  time += 61_000;
  await service.report(query);
  assert.equal(calls, previous);
  time += 61_000;
  await service.report(query);
  assert.ok(calls > previous);
});

test("chave ausente, falha de rede e respostas incompletas não fabricam dados", async () => {
  const missing = createOpenAIService({ getKey: () => undefined });
  const report = await missing.report(query);
  assert.equal(report.costs.errorCode, "not_configured");
  assert.equal(report.costs.totals.length, 0);
  assert.equal(
    report.usage.every((source) => source.errorCode === "not_configured"),
    true,
  );
  const network = createOpenAIService({
    getKey: () => "test-only",
    fetch: mockFetch(() => {
      throw new Error("network");
    }),
  });
  assert.equal((await network.report(query)).costs.errorCode, "unavailable");
  const broken = createOpenAIService({
    getKey: () => "test-only",
    fetch: mockFetch(() => response({ data: [], has_more: true })),
  });
  assert.equal((await broken.report(query)).costs.status, "error");
});

test("rotas recusam acesso sem sessão e tokens falsos antes de consultar OpenAI", async () => {
  const app = express();
  registerOpenAIRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    for (const path of [
      "/api/openai/projects",
      "/api/openai/report",
      "/api/openai/costs",
      "/api/openai/recent-usage",
    ]) {
      assert.equal((await fetch(url + path)).status, 401);
      assert.equal(
        (
          await fetch(url + path, {
            headers: { Authorization: `Bearer ${"a".repeat(64)}` },
          })
        ).status,
        401,
      );
    }
    const token = adminSessions.create();
    const response = await fetch(`${url}/api/openai/report?startDate=invalid`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    for (const path of [
      "/api/openai/costs?startDate=invalid",
      "/api/openai/recent-usage?projectId=bad%20project",
      "/api/openai/recent-usage?hours=24",
    ]) {
      assert.equal(
        (
          await fetch(url + path, {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).status,
        400,
      );
    }
    adminSessions.revoke(token);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("consumo recente mantém minutos, cruza a meia-noite e não soma cache à entrada", () => {
  const end = Date.parse("2026-01-03T01:00:30Z") / 1000;
  const start = end - 10800;
  const recent = aggregateRecentUsage(
    [
      { start_time: start - 90, results: [{ input_tokens: 999 }] },
      {
        start_time: Math.floor(start / 60) * 60,
        end_time: Math.floor(start / 60) * 60 + 60,
        results: [
          {
            input_tokens: 100,
            input_cached_tokens: 60,
            output_tokens: 10,
            num_model_requests: 2,
          },
          { input_tokens: 50, input_cached_tokens: 20, num_model_requests: 1 },
        ],
      },
      {
        start_time: Math.floor(end / 60) * 60,
        results: [{ input_tokens: 5, num_model_requests: 1 }],
      },
      { start_time: end + 60, results: [{ input_tokens: 999 }] },
    ],
    start,
    end,
    stamp,
    "proj-a",
  );
  assert.equal(recent.status, "ok");
  assert.equal(recent.projectId, "proj-a");
  assert.equal(recent.series.length, 181);
  assert.equal(recent.startTime, "2026-01-02T22:00:30.000Z");
  assert.equal(recent.endTime, "2026-01-03T01:00:30.000Z");
  assert.equal(recent.series[0].partial, true);
  assert.equal(recent.series[180].partial, true);
  assert.equal(recent.series[1].partial, false);
  assert.deepEqual(recent.totals, {
    input_tokens: 155,
    input_cached_tokens: 80,
    output_tokens: 10,
    num_model_requests: 4,
  });
  assert.deepEqual(recent.series[1].metrics, {});
  assert.equal(aggregateRecentUsage([], start, end, stamp).series.length, 181);
});

test("novas consultas paginam, compartilham custos com relatório e deduplicam por 60 segundos", async () => {
  let time = Date.parse(stamp);
  const paths: string[] = [];
  const service = createOpenAIService({
    now: () => time,
    getKey: () => "test-only",
    fetch: mockFetch((url) => {
      paths.push(url.pathname);
      if (url.searchParams.get("bucket_width") === "1m") {
        assert.equal(url.searchParams.get("limit"), "1440");
        assert.equal(url.searchParams.get("project_ids"), "proj-a");
        assert.equal(
          Number(url.searchParams.get("end_time")) -
            Number(url.searchParams.get("start_time")),
          10800,
        );
        const page = url.searchParams.has("page");
        return response({
          data: [
            {
              start_time: time / 1000 - (page ? 60 : 120),
              results: [{ input_tokens: page ? 5 : 10, num_model_requests: 1 }],
            },
          ],
          has_more: !page,
          next_page: page ? null : "second",
        });
      }
      return response({ data: [], has_more: false });
    }),
  });
  const first = service.recentUsage("proj-a");
  assert.equal(service.recentUsage("proj-a"), first);
  const recent = await first;
  assert.equal(recent.totals.input_tokens, 15);
  assert.equal(paths.length, 2);
  const cost = service.costs(query);
  assert.equal(service.costs(query), cost);
  await cost;
  assert.equal(paths.length, 3);
  assert.equal(paths[2], "/v1/organization/costs");
  await service.report(query);
  assert.equal(paths.filter((path) => path.endsWith("/costs")).length, 1);
  time += 59_000;
  assert.equal(service.recentUsage("proj-a"), first);
  time += 1001;
  const refreshed = await service.recentUsage("proj-a");
  assert.notEqual(refreshed.endTime, recent.endTime);
  assert.equal(paths.filter((path) => path.endsWith("/completions")).length, 5);
});

test("custos e consumo recente respeitam juntos o limite de quatro chamadas", async () => {
  let active = 0;
  let peak = 0;
  const service = createOpenAIService({
    getKey: () => "test-only",
    now: () => Date.parse(stamp),
    fetch: mockFetch(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return response({ data: [], has_more: false });
    }),
  });
  await Promise.all([
    service.report(query),
    service.costs({ ...query, projectId: "a" }),
    ...["a", "b", "c", "d"].map((id) => service.recentUsage(id)),
  ]);
  assert.equal(peak, 4);
});

test("falhas intradiárias e financeiras nunca fabricam pontos zerados", async () => {
  for (const status of [401, 403, 429, 502]) {
    const service = createOpenAIService({
      getKey: () => "test-only",
      now: () => Date.parse(stamp),
      fetch: mockFetch(() => response({}, status)),
    });
    const recent = await service.recentUsage();
    assert.equal(recent.status, "error");
    assert.deepEqual(recent.series, []);
    assert.deepEqual(recent.totals, {});
    const costs = await service.costs(query);
    assert.equal(costs.status, "error");
    assert.deepEqual(costs.daily, []);
  }
  const missing = createOpenAIService({ getKey: () => undefined });
  assert.equal((await missing.recentUsage()).errorCode, "not_configured");
});

test("login, restauração validada e logout preservam o contrato existente", async () => {
  const original = {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  };
  process.env.ADMIN_EMAIL = "admin@example.test";
  process.env.ADMIN_PASSWORD = "test-only-password";
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const denied = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@example.test", password: "wrong" }),
    });
    assert.equal(denied.status, 401);
    const login = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@example.test",
        password: "test-only-password",
      }),
    });
    const data = await login.json();
    assert.equal(data.success, true);
    assert.equal(data.user.role, "admin");
    assert.match(data.token, /^[a-f0-9]{64}$/);
    const headers = { Authorization: `Bearer ${data.token}` };
    const verified = await fetch(`${url}/api/auth/verify`, { headers });
    assert.equal((await verified.json()).valid, true);
    assert.equal(
      (await fetch(`${url}/api/auth/logout`, { method: "POST", headers }))
        .status,
      200,
    );
    assert.equal(
      (await fetch(`${url}/api/auth/verify`, { headers })).status,
      401,
    );
    assert.equal(
      (await fetch(`${url}/api/openai/projects`, { headers })).status,
      401,
    );
  } finally {
    if (original.email === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = original.email;
    if (original.password === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = original.password;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
