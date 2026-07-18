import type { SalesOsCaller, SalesOsContext, SalesOsHandler } from "./contracts.ts";

export interface SalesOsRouterDependencies {
  readonly handlers: Readonly<Record<string, SalesOsHandler>>;
  readonly corsHeaders: HeadersInit;
  readonly errorResponse: (message: string, status?: number) => Response;
  readonly resolveCaller: (authorization: string | null) => Promise<SalesOsCaller>;
  readonly createContext: (caller: SalesOsCaller) => SalesOsContext;
}

export function createSalesOsRequestHandler(
  dependencies: SalesOsRouterDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: dependencies.corsHeaders });
    }
    if (request.method !== "POST") {
      return dependencies.errorResponse("Method not allowed", 405);
    }

    const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
    if (contentLength > 1_048_576) {
      return dependencies.errorResponse("Request body exceeds 1 MB limit", 413);
    }

    let body: { action?: string; payload?: Record<string, unknown> };
    try {
      body = await request.json();
    } catch {
      return dependencies.errorResponse("Invalid JSON body");
    }

    const action = body.action ?? "";
    const handler = dependencies.handlers[action];
    if (!handler) return dependencies.errorResponse(`Unknown action: ${action}`, 404);

    let caller: SalesOsCaller;
    try {
      caller = await dependencies.resolveCaller(request.headers.get("Authorization"));
    } catch (error) {
      const authError = error as { status?: number; message?: string };
      return dependencies.errorResponse(
        authError.message ?? "Unauthorized",
        authError.status ?? 401,
      );
    }

    try {
      return await handler(body.payload ?? {}, dependencies.createContext(caller));
    } catch (error) {
      return dependencies.errorResponse(
        error instanceof Error ? error.message : "Internal error",
        500,
      );
    }
  };
}
