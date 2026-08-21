// Baseline: ship the index as-is, score every port on every keystroke.
//
// This is what web/app.js does today. Everything else is measured against it.

import { byScore, normalize, scorePort } from '../../search.js';

export const id = '00-linear';
export const label = 'linear scan';
export const notes = 'JSON as generated; full scan per query';

export function build(ports) {
	return ports.map((p) => ({ ...p, id: normalize(p.id), name: normalize(p.name), haystack: normalize(p.haystack) }));
}

/** Bytes the client must download. */
export function serialize(index) {
	return JSON.stringify({ schema: 1, ports: index });
}

export function search(index, query, limit) {
	const q = normalize(query);
	const hits = [];
	for (const port of index) {
		const hit = scorePort(q, port);
		if (hit !== null) hits.push({ id: port.id, score: hit.score });
	}
	hits.sort(byScore);
	return limit ? hits.slice(0, limit) : hits;
}

/** Diagnostics, called outside the timing loop. */
export function probe(index, query) {
	const q = normalize(query);
	let matched = 0;
	for (const port of index) if (scorePort(q, port) !== null) matched++;
	return { scanned: index.length, scored: index.length, matched };
}
