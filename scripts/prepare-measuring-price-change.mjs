import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measuringPriceChangeSql } from './lib/measuring-price-change.mjs';

const usage = 'Usage: node scripts/prepare-measuring-price-change.mjs --community <UUID> --old-plan <UUID> --old-price <price_ID> --stripe-price-json <reviewed private Price JSON> --mode <live|test> --output output/private/measuring-price-v2.sql [--activate-new-sales]';
const values = new Map();
let activateNewSales = false;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (key === '--activate-new-sales' && !activateNewSales) { activateNewSales = true; continue; }
  if (!['--community', '--old-plan', '--old-price', '--stripe-price-json', '--mode', '--output'].includes(key) || values.has(key) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(usage);
  values.set(key, args[++index]);
}
if (values.size !== 6) throw new Error(usage);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'output/private');
const output = path.resolve(values.get('--output'));
if (path.dirname(output) !== directory || !output.endsWith('.sql')) throw new Error('Output must be a SQL file directly inside this checkout’s output/private.');
await mkdir(directory, { recursive: true, mode: 0o700 });
if (await realpath(directory) !== directory) throw new Error('Private output directory must not be a symlink.');
const source = path.resolve(values.get('--stripe-price-json'));
if (path.dirname(source) !== directory || await realpath(source) !== source) throw new Error('Reviewed Price JSON must be a regular private file directly inside output/private.');
const sql = measuringPriceChangeSql({ communityId: values.get('--community'), oldPlanId: values.get('--old-plan'), oldStripePriceId: values.get('--old-price'), newStripePrice: JSON.parse(await readFile(source, 'utf8')), mode: values.get('--mode'), activateNewSales });
await writeFile(output, sql, { flag: 'wx', mode: 0o600 });
console.log(`Prepared private SQL ${activateNewSales ? 'with explicit new-sales cutover' : 'for an inactive new version'}. No database or Stripe changes made.`);
