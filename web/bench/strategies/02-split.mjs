// 01 plus a split payload.
//
// The measurement that motivates this: at N=100,000 the full index gzips to
// 3 MB, but the fields the query path reads gzip to about a quarter of that.
// Versions and platforms dominate the payload and are only ever needed for the
// one port the user selects.
//
// So ship the lean records up front and put the detail in shards fetched on
// demand. Sharding rather than one file per port keeps the file count sane; a
// shard is one request and pulls in some neighbours, which is free at CDN
// latency.

import { byScore, maskOf, normalize, passes, scorePort } from '../../search.js';

export const id = '02-split';
export const label = '+ split payload';
export const notes = 'lean index up front, detail sharded on demand';

/** Ports per detail shard. Smaller means less waste but more files. */
const SHARD_SIZE = 32;

export function build(ports) {
	const lean = [];
	const shards = new Map();
	const count = Math.max(1, Math.ceil(ports.length / SHARD_SIZE));

	for (const p of ports) {
		const haystack = normalize(p.haystack);
		const [lo, hi] = maskOf(haystack);
		const key = shardOf(p.id, count);

		lean.push({ id: normalize(p.id), name: normalize(p.name), haystack, latest: p.latest, s: key, m0: lo, m1: hi });

		if (!shards.has(key)) shards.set(key, {});
		shards.get(key)[p.id] = { versions: p.versions, platforms: p.platforms, target: p.target };
	}

	return { lean, shards };
}

/** FNV-1a, so the shard of an id is derivable client-side without a lookup table. */
function shardOf(id, count) {
	let h = 0x811c9dc5;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0) % count;
}

export function serialize(index) {
	return JSON.stringify({ schema: 1, shards: index.shards.size, ports: index.lean });
}

/** What a click costs: one shard, fetched once and cached. */
export function chunks(index) {
	return [...index.shards.values()].map((s) => Buffer.from(JSON.stringify(s)));
}

export function search(index, query, limit) {
	const q = normalize(query);
	const [qLo, qHi] = maskOf(q);

	const hits = [];
	for (const port of index.lean) {
		if (!passes(port.m0, port.m1, qLo, qHi)) continue;
		const hit = scorePort(q, port);
		if (hit !== null) hits.push({ id: port.id, score: hit.score });
	}
	hits.sort(byScore);
	return limit ? hits.slice(0, limit) : hits;
}

export function probe(index, query) {
	const q = normalize(query);
	const [qLo, qHi] = maskOf(q);
	let scored = 0;
	let matched = 0;
	for (const port of index.lean) {
		if (!passes(port.m0, port.m1, qLo, qHi)) continue;
		scored++;
		if (scorePort(q, port) !== null) matched++;
	}
	return { scanned: index.lean.length, scored, matched };
}
