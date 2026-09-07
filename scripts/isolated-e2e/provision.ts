import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { totp } from '../totp';

// Deliberately accepts only the fixed local runner endpoint. Never seed a
// hosted project, even when a caller accidentally supplies production keys.
export function requireLocalApi(value: string) {
  if (value !== 'http://127.0.0.1:56321') throw new Error('Provisioning requires the isolated loopback API');
}

if (import.meta.main) {
  const status = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  requireLocalApi(status.API_URL);
  const envFile = process.env.GITHUB_ENV;
  if (!envFile || !status.SERVICE_ROLE_KEY || !status.ANON_KEY) throw new Error('Local status or runner environment missing');
  const output = (key: string, value: string, secret = false) => {
    if (/[\r\n]/.test(value)) throw new Error('Invalid environment value');
    if (secret) console.log(`::add-mask::${value}`);
    appendFileSync(envFile, `${key}=${value}\n`);
  };
  const api = status.API_URL;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(api, status.SERVICE_ROLE_KEY, options);
  const check = (error: { message: string } | null) => { if (error) throw new Error(error.message); };
  output('SUPABASE_URL', api);
  output('VITE_SUPABASE_URL', api);
  output('SUPABASE_PUBLISHABLE_KEY', status.ANON_KEY, true);
  output('VITE_SUPABASE_PUBLISHABLE_KEY', status.ANON_KEY, true);
  output('TEST_APP_URL', 'http://127.0.0.1:8080');
  output('PLAYWRIGHT_BASE_URL', 'http://127.0.0.1:8080');
  const roles = ['system_admin', 'managing_director', 'general_manager', 'ceo', 'sales_manager', 'bd_manager', 'sales_ops', 'salesperson', 'viewer', 'finance_manager', 'estimation_manager', 'pending', 'suspended'];
  const mfaRoles = new Set(['system_admin', 'managing_director', 'general_manager', 'sales_manager', 'finance_manager']);
  for (const role of roles) {
    const email = `ci-${role.replaceAll('_', '-')}+test@phc-sa.com`;
    const password = randomBytes(32).toString('base64url');
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `CI ${role}` } });
    check(created.error);
    if (!created.data.user) throw new Error('User creation returned no user');
    const id = created.data.user.id;
    check((await admin.from('user_roles').delete().eq('user_id', id)).error);
    if (!['pending', 'suspended'].includes(role)) check((await admin.from('user_roles').insert({ user_id: id, role })).error);
    check((await admin.from('profiles').update({ status: role === 'pending' ? 'pending_approval' : role === 'suspended' ? 'suspended' : 'active' }).eq('id', id)).error);
    output(`TEST_${role.toUpperCase()}_EMAIL`, email);
    output(`TEST_${role.toUpperCase()}_PASSWORD`, password, true);
    if (mfaRoles.has(role)) {
      const user = createClient(api, status.ANON_KEY, options);
      check((await user.auth.signInWithPassword({ email, password })).error);
      const enrolled = await user.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Isolated CI' });
      check(enrolled.error);
      if (!enrolled.data || enrolled.data.type !== 'totp') throw new Error('TOTP enrollment failed');
      const secret = enrolled.data.totp.secret;
      check((await user.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(secret) })).error);
      output(`TEST_${role.toUpperCase()}_TOTP_SECRET`, secret, true);
      await user.auth.signOut();
    }
  }
  console.log('Provisioned 13 isolated accounts, including 5 verified MFA factors.');
}
