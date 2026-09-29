import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pricingCatalogSql } from './lib/pricing-catalog.mjs';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--community' || args[2] !== '--output') throw new Error('Usage: node scripts/prepare-pricing-catalog.mjs --community <reviewed UUID> --output output/private/pricing-catalog.sql');
const output = path.resolve(args[3]);
const directory = path.resolve('output/private');
if (path.dirname(output) !== directory || !output.endsWith('.sql')) throw new Error('Output must be a SQL file inside output/private.');
const draft = JSON.parse(await readFile(new URL('../docs/academy-pricing.draft.json', import.meta.url), 'utf8'));
const sql = pricingCatalogSql(draft, args[1]);
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(output, sql, { flag: 'wx', mode: 0o600 });
console.log('Prepared five inactive offers. No database or Stripe changes made.');
