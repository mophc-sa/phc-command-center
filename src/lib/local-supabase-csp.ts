/** Local preview needs REST/WebSocket access to its disposable Supabase.
 * Neither a hosted build nor a hosted request may opt into loopback access. */
export function localSupabaseCsp(policy: string, api: string | undefined, requestUrl: string): string {
  const request = new URL(requestUrl);
  if (api !== 'http://127.0.0.1:56321' || request.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(request.hostname)) return policy;
  return policy.replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:56321 ws://127.0.0.1:56321");
}
