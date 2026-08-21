// 02 plus bounded top-K selection.
//
// The UI renders 50 rows. A one-character query matches most of the corpus, so
// the baseline builds a 100,000-element array and sorts all of it to show 50.
// A size-K min-heap keeps the cost at O(n log K) and, more importantly, stops
// allocating an array proportional to the corpus.
//
// Results are identical, not merely similar: both paths use the total order in
// search.js, so ties resolve the same way.

import { byScore, maskOf, normalize, passes, scorePort } from '../../search.js';

export { build, serialize, chunks, probe } from './02-split.mjs';

export const id = '03-topk';
export const label = '+ top-K heap';
export const notes = 'size-K min-heap instead of sorting every hit';

export function search(index, query, limit) {
	const k = limit ?? Infinity;
	if (!Number.isFinite(k)) return sortAll(index, query);

	const q = normalize(query);
	const [qLo, qHi] = maskOf(q);

	// Min-heap of the best k seen so far, ordered by byScore. Its root is the
	// weakest survivor, so one comparison decides whether a hit can enter.
	const heap = [];
	for (const port of index.lean) {
		if (!passes(port.m0, port.m1, qLo, qHi)) continue;
		const hit = scorePort(q, port);
		if (hit === null) continue;

		const entry = { id: port.id, score: hit.score };
		if (heap.length < k) {
			push(heap, entry);
		} else if (byScore(entry, heap[0]) < 0) {
			heap[0] = entry;
			down(heap, 0);
		}
	}

	return heap.sort(byScore);
}

// The heap is a min-heap under byScore, i.e. the *worst* hit sits at the root.
function push(heap, entry) {
	heap.push(entry);
	let i = heap.length - 1;
	while (i > 0) {
		const parent = (i - 1) >> 1;
		if (byScore(heap[parent], heap[i]) >= 0) break;
		[heap[parent], heap[i]] = [heap[i], heap[parent]];
		i = parent;
	}
}

function down(heap, i) {
	const n = heap.length;
	for (;;) {
		const l = 2 * i + 1;
		const r = l + 1;
		let worst = i;
		if (l < n && byScore(heap[l], heap[worst]) > 0) worst = l;
		if (r < n && byScore(heap[r], heap[worst]) > 0) worst = r;
		if (worst === i) return;
		[heap[worst], heap[i]] = [heap[i], heap[worst]];
		i = worst;
	}
}

function sortAll(index, query) {
	const q = normalize(query);
	const [qLo, qHi] = maskOf(q);
	const hits = [];
	for (const port of index.lean) {
		if (!passes(port.m0, port.m1, qLo, qHi)) continue;
		const hit = scorePort(q, port);
		if (hit !== null) hits.push({ id: port.id, score: hit.score });
	}
	return hits.sort(byScore);
}
