import { expect, test } from "bun:test";
import {
  createHandlerRegistry,
  createSalesOsContext,
  type SalesOsHandler,
} from "../../supabase/functions/sales-os-api/contracts";
import { createSalesOsRequestHandler } from "../../supabase/functions/sales-os-api/router";

const caller = { userId: "user-1", roles: ["salesperson" as const] };
const audit = async () => ({ error: null });

function errorResponse(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

function makeRouter(handler?: SalesOsHandler) {
  let authCalls = 0;
  const registry = createHandlerRegistry(
    handler ? [{ name: "test", handlers: { known: handler } }] : [],
  );
  const route = createSalesOsRequestHandler({
    handlers: registry.handlers,
    corsHeaders: { "Access-Control-Allow-Origin": "https://agent.phc-sa.com" },
    errorResponse,
    resolveCaller: async () => {
      authCalls += 1;
      return caller;
    },
    createContext: (resolvedCaller) =>
      createSalesOsContext(resolvedCaller, () => ({ marker: "svc" }) as never, audit as never),
  });
  return { route, authCalls: () => authCalls };
}

test("router preserves pre-auth method, size, JSON, and unknown-action guards", async () => {
  const { route, authCalls } = makeRouter();
  const options = await route(new Request("https://example.test", { method: "OPTIONS" }));
  expect(options.status).toBe(200);
  expect(options.headers.get("Access-Control-Allow-Origin")).toBe("https://agent.phc-sa.com");
  expect((await route(new Request("https://example.test", { method: "GET" }))).status).toBe(405);
  expect(
    (
      await route(
        new Request("https://example.test", {
          method: "POST",
          headers: { "content-length": "1048577" },
          body: "{}",
        }),
      )
    ).status,
  ).toBe(413);
  expect(
    (await route(new Request("https://example.test", { method: "POST", body: "{" }))).status,
  ).toBe(400);
  expect(
    (
      await route(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ action: "missing" }),
        }),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await route(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ action: "toString" }),
        }),
      )
    ).status,
  ).toBe(404);
  expect(authCalls()).toBe(0);
});

test("router passes payload and caller context to the selected handler", async () => {
  const handler: SalesOsHandler = async (payload, context) =>
    Response.json({ payload, userId: context.caller.userId });
  const { route, authCalls } = makeRouter(handler);
  const response = await route(
    new Request("https://example.test", {
      method: "POST",
      headers: { authorization: "Bearer test" },
      body: JSON.stringify({ action: "known", payload: { id: "record-1" } }),
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ payload: { id: "record-1" }, userId: "user-1" });
  expect(authCalls()).toBe(1);
});

test("router preserves authorization and handler error responses", async () => {
  const unauthorized = createSalesOsRequestHandler({
    handlers: { known: async () => new Response("unused") },
    corsHeaders: {},
    errorResponse,
    resolveCaller: async () => {
      throw { status: 403, message: "Forbidden" };
    },
    createContext: () => {
      throw new Error("must not create context");
    },
  });
  const request = () =>
    new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ action: "known" }),
    });
  expect((await unauthorized(request())).status).toBe(403);

  const failing = makeRouter(async () => {
    throw new Error("handler failed");
  }).route;
  const response = await failing(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "handler failed" });

  const nonErrorFailure = makeRouter(async () => {
    throw "non-error failure";
  }).route;
  const fallbackResponse = await nonErrorFailure(request());
  expect(fallbackResponse.status).toBe(500);
  expect(await fallbackResponse.json()).toEqual({ error: "Internal error" });
});

test("service client creation stays lazy and is cached per request context", () => {
  let creations = 0;
  const serviceClient = { marker: "svc" };
  const context = createSalesOsContext(
    caller,
    () => {
      creations += 1;
      return serviceClient as never;
    },
    audit as never,
  );
  expect(creations).toBe(0);
  expect(context.svc).toBe(serviceClient);
  expect(context.svc).toBe(serviceClient);
  expect(creations).toBe(1);
});
