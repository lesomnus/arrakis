#!/usr/bin/env node
// Compare search strategies over a corpus-size sweep.
//
//   node web/bench/run.mjs                       # default sweep
//   node web/bench/run.mjs --n 1000,100000       # pick sizes
//   node web/bench/run.mjs --only 01-bitmask
//   node web/bench/run.mjs --check               # agreement check only
//
// Reports, per (strategy, N):
//   upfront  gzipped bytes downloaded before the first keystroke
//   +click   gzipped bytes of the median detail shard, for strategies that
//            hold detail back until a port is selected
//   mean/p99 per-query latency -- what the search box feels
//   kept     share of the corpus surviving the prefilter, i.e. still scored
//
// Strategies are cumulative: 01 is 00 plus one change, 02 is 01 plus one, and
// so on, so each row's delta is attributable to a single decision.

import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

function kb(b) {
	return b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`;
}

function ms(v) {
	return v < 1 ? `${(v * 1000).toFixed(0)} µs` : `${v.toFixed(2)} ms`;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const LIMIT = 50; // rows the UI would actually render

const argv = parseArgs(process.argv.slice(2));
const SIZES = argv.n ? argv.n.split(',').map(Number) : [10, 100, 1_000, 10_000, 100_000];

const { generate, queries } = await import(join(HERE, 'corpus.mjs'));
const strategies = await load(argv.only);

const seedPorts = readSeed();
console.log(`strategies: ${strategies.map((s) => s.id).join(', ')}`);
console.log(`seed ports: ${seedPorts.length} (from web/index.json)\n`);

if (argv.check) {
	checkAgreement();
	process.exit(0);
}

for (const n of SIZES) {
	const ports = generate(n, { seedPorts });
	const qs = queries(ports);

	console.log(`N = ${n.toLocaleString()}  (${qs.length} queries)`);
	console.log(`  ${'strategy'.padEnd(22)} ${'upfront'.padStart(9)} ${'+click'.padStart(9)} ${'build'.padStart(8)} ${'mean'.padStart(9)} ${'p99'.padStart(9)} ${'kept'.padStart(6)}   vs base`);

	const base = {};
	for (const s of strategies) {
		const t0 = performance.now();
		const index = s.build(ports);
		const buildMs = performance.now() - t0;

		const payload = Buffer.from(s.serialize(index));
		const gz = gzipSync(payload, { level: 9 });

		// What a click costs on top of the upfront payload, for strategies that
		// hold detail back. Reported as the median shard so one fat shard does
		// not read as the typical case.
		const shards = s.chunks ? s.chunks(index).map((c) => gzipSync(c, { level: 9 }).length).sort((a, b) => a - b) : [];
		const chunk = shards.length > 0 ? shards[Math.floor(shards.length / 2)] : 0;

		// Warm up so JIT state is comparable across strategies.
		for (let i = 0; i < 3; i++) for (const q of qs) s.search(index, q, LIMIT);

		const samples = [];
		let hits = 0;
		const reps = n <= 1_000 ? 20 : n <= 10_000 ? 5 : 2;
		for (let r = 0; r < reps; r++) {
			for (const q of qs) {
				const t = performance.now();
				const out = s.search(index, q, LIMIT);
				samples.push(performance.now() - t);
				hits += out.length;
			}
		}
		samples.sort((a, b) => a - b);

		// Prefilter effectiveness, measured outside the timing loop.
		let scored = 0;
		let scanned = 0;
		if (s.probe) {
			for (const q of qs) {
				const p = s.probe(index, q);
				scored += p.scored;
				scanned += p.scanned;
			}
		}
		const kept = scanned > 0 ? scored / scanned : 1;

		const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
		const row = {
			payload: payload.length,
			gzip: gz.length,
			build: buildMs,
			mean,
			p50: samples[Math.floor(samples.length * 0.5)],
			p99: samples[Math.floor(samples.length * 0.99)],
			hits: hits / samples.length,
			chunk,
			shards: shards.length,
			kept,
		};
		if (!base.mean) Object.assign(base, row);

		const speedup = row === base ? '' : `  ${(base.mean / row.mean).toFixed(2)}x`;
		console.log(
			`  ${s.label.padEnd(22)} ${kb(row.gzip).padStart(9)} ${(row.chunk ? kb(row.chunk) : '-').padStart(9)} ${ms(row.build).padStart(8)} ${ms(row.mean).padStart(9)} ${ms(row.p99).padStart(9)} ${(row.kept * 100).toFixed(0).padStart(5)}%${speedup}`,
		);
	}
	if (strategies.some((s) => s.probe)) breakdown(ports, qs);
	console.log();
}

/**
 * Prefilter effectiveness bucketed by query length. An average hides the fact
 * that a character filter is nearly useless on the short prefixes a search box
 * actually receives.
 */
function breakdown(ports, qs) {
	const filters = strategies.filter((s) => s.probe && s.id !== '00-linear');
	if (filters.length === 0) return;

	// Strategies that share a prefilter produce identical rows; collapse them
	// so a genuinely different filter stands out.
	const rows = new Map();
	for (const s of filters) {
		const buckets = new Map();
		const index = s.build(ports);
		for (const q of qs) {
			const len = Math.min(q.length, 6);
			const p = s.probe(index, q);
			const b = buckets.get(len) ?? { scored: 0, scanned: 0 };
			b.scored += p.scored;
			b.scanned += p.scanned;
			buckets.set(len, b);
		}
		const cells = [...buckets.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([len, b]) => `${len}${len === 6 ? '+' : ' '}:${((b.scored / b.scanned) * 100).toFixed(0).padStart(4)}%`)
			.join('  ');
		rows.set(cells, [...(rows.get(cells) ?? []), s.id]);
	}

	console.log(`  ${''.padEnd(22)} kept by query length`);
	for (const [cells, ids] of rows) {
		console.log(`  ${(ids.length > 1 ? `${ids[0]}..${ids.at(-1)}` : ids[0]).padEnd(22)} ${cells}`);
	}
}

/** Every strategy must return the same ranking; a faster wrong answer is not a result. */
function checkAgreement() {
	const ports = generate(2_000, { seedPorts });
	const qs = queries(ports);
	const built = strategies.map((s) => ({ s, index: s.build(ports) }));

	let bad = 0;
	for (const q of qs) {
		const outs = built.map(({ s, index }) => s.search(index, q, LIMIT).map((h) => h.id).join('|'));
		if (new Set(outs).size !== 1) {
			bad++;
			if (bad <= 3) {
				console.log(`MISMATCH ${JSON.stringify(q)}`);
				outs.forEach((o, i) => console.log(`  ${built[i].s.id}: ${o.slice(0, 100)}`));
			}
		}
	}
	console.log(bad === 0 ? `agreement OK across ${qs.length} queries` : `${bad}/${qs.length} queries disagree`);
	if (bad > 0) process.exitCode = 1;
}

async function load(only) {
	const dir = join(HERE, 'strategies');
	const files = (await readdir(dir)).filter((f) => f.endsWith('.mjs')).sort();
	const out = [];
	for (const f of files) {
		const mod = await import(join(dir, f));
		if (!only || mod.id === only || mod.id.includes(only)) out.push(mod);
	}
	if (out.length === 0) throw new Error(`no strategy matches ${only}`);
	return out;
}

function readSeed() {
	try {
		return JSON.parse(readFileSync(join(HERE, '..', 'index.json'), 'utf8')).ports;
	} catch {
		return []; // run `arks render --kind index > web/index.json` to include real ports
	}
}

function parseArgs(args) {
	const out = {};
	for (let i = 0; i < args.length; i++) {
		if (!args[i].startsWith('--')) continue;
		const key = args[i].slice(2);
		out[key] = args[i + 1]?.startsWith('--') || args[i + 1] === undefined ? true : args[++i];
	}
	return out;
}
