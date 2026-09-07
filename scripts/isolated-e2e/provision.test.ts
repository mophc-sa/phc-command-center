import { test, expect } from 'bun:test';
import { requireLocalApi } from './provision';
test('provisioner refuses hosted or redirected endpoints', () => {
  for (const url of ['https://lrfdtoexyeghrzynapyn.supabase.co', 'http://localhost:56321', 'http://127.0.0.1:56321@evil.test', 'http://127.0.0.1:56321/path']) expect(() => requireLocalApi(url)).toThrow();
  expect(() => requireLocalApi('http://127.0.0.1:56321')).not.toThrow();
});
