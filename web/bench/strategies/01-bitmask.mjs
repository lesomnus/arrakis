// Baseline plus a character-presence prefilter.
//
// Each port carries a 64-bit mask of the characters present in its haystack,
// split over two 32-bit words. A query whose characters are not all present
// cannot be a subsequence, so two ANDs reject it before the O(len) scan.
// This is the trick fzf uses. It costs ~20 bytes per port in the payload.

import { byScore, maskOf, normalize, passes, scorePort } from '../../search.js';

export const id = '01-bitmask';
export const label = 'linear + char bitmask';
export const notes = 'two ANDs reject before scoring; +2 ints per port';

export function build(ports) {
	return ports.map((p) => {
		const haystack = normalize(p.haystack);
		const [lo, hi] = maskOf(haystack);
		return { ...p, id: normalize(p.id), name: normalize(p.name), haystack, m0: lo, m1: hi };
	});
}

export function serialize(index) {
	return JSON.stringify({ schema: 1, ports: index });
}

export function search(index, query, limit) {
	const q = normalize(query);
	const [qLo, qHi] = maskOf(q);

	const hits = [];
	for (const port of index) {
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
	for (const port of index) {
		if (!passes(port.m0, port.m1, qLo, qHi)) continue;
		scored++;
		if (scorePort(q, port) !== null) matched++;
	}
	return { scanned: index.length, scored, matched };
}
