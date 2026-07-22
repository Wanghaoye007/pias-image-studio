#!/usr/bin/env node
import { runReleasePreflight } from './release-preflight-core.mjs';

const reportOnly = process.argv.includes('--report-only');
const report = await runReleasePreflight();
process.stdout.write(`${JSON.stringify(report)}\n`);
if (!reportOnly && !report.ok) process.exitCode = 1;
