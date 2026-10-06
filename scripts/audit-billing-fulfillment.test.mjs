import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('./audit-billing-fulfillment.mjs', import.meta.url));
describe('billing audit CLI safe failure boundary (no provider calls)', () => {
  it('documents read-only stages and does not require credentials for help', () => {
    const output = execFileSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
    expect(output).toContain('--expect active|cancel_at_period_end|cancelled|refunded|unpaid');
  });
  it('records a private, redacted unverified result when configuration is absent', () => {
    const filename = `output/private/billing-audit-cli-fixture-${process.pid}-${Date.now()}.json`;
    const env = { ...process.env, STRIPE_MODE: '', STRIPE_SECRET_KEY: 'redacted-fixture-secret', SUPABASE_SERVICE_ROLE_KEY: 'redacted-fixture-server-key' };
    try {
      const result = spawnSync(process.execPath, [script, '--session', 'cs_fixture', '--expect', 'active', '--receipt', filename], { cwd: root, env, encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      const summary = JSON.parse(result.stdout);
      expect(summary.status).toBe('unverified');
      expect(summary.paidCheckoutVerified).toBe(false);
      expect(summary.fullPurchaseLifecycleVerified).toBe(false);
      const stored = readFileSync(`${root}${filename}`, 'utf8');
      expect(statSync(`${root}${filename}`).mode & 0o777).toBe(0o600);
      for (const secret of ['redacted-fixture-secret', 'redacted-fixture-server-key', 'cs_fixture']) expect(stored + result.stdout).not.toContain(secret);
      expect(JSON.parse(stored).checks).toEqual([{ name: 'configuration_unverified', status: 'unverified' }]);
      const repeat = spawnSync(process.execPath, [script, '--session', 'cs_fixture', '--expect', 'active', '--receipt', filename], { cwd: root, env, encoding: 'utf8' });
      expect(repeat.status).toBe(1);
      expect(readFileSync(`${root}${filename}`, 'utf8')).toBe(stored);
    } finally { try { unlinkSync(`${root}${filename}`); } catch {} }
  });
  it('rejects receipt paths outside ignored private output before doing provider work', () => {
    const result = spawnSync(process.execPath, [script, '--session', 'cs_fixture', '--expect', 'active', '--receipt', 'public/billing.json'], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Audit receipts must be private JSON files');
  });
});
