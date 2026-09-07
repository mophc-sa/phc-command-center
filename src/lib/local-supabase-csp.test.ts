import { expect, test } from 'bun:test';
import { localSupabaseCsp } from './local-supabase-csp';
const policy = "default-src 'self'; connect-src 'self' https://*.supabase.co";
test('local preview allows only the configured local API', () => {
  expect(localSupabaseCsp(policy, 'http://127.0.0.1:56321', 'http://127.0.0.1:8080/auth')).toContain('ws://127.0.0.1:56321');
});
test('hosted requests and builds keep the original CSP', () => {
  for (const origin of ['https://agent.phc-sa.com/auth', 'https://127.0.0.1/auth', 'http://127.0.0.1.evil.test/auth']) expect(localSupabaseCsp(policy, 'http://127.0.0.1:56321', origin)).toBe(policy);
  expect(localSupabaseCsp(policy, 'https://lrfdtoexyeghrzynapyn.supabase.co', 'http://127.0.0.1:8080')).toBe(policy);
  expect(localSupabaseCsp(policy, undefined, 'http://127.0.0.1:8080')).toBe(policy);
});
