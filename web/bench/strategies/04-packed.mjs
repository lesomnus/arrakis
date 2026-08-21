// 03 with the corpus repacked as flat byte buffers.
//
// The previous strategies scan an array of JS objects and compare JS strings.
// Every document costs a property load, a string header dereference and a
// UTF-16 comparison. Packing the text into one Uint8Array with Uint32Array
// offsets turns the scan into a contiguous byte walk -- the classic
// struct-of-arrays rewrite, and about as far as a scan goes without WASM.
//
// The matcher is reimplemented over bytes, so it is duplicated logic rather
// than a wrapper. That is a real cost: the agreement check in run.mjs is what
// keeps it honest, and a divergence here is a bug, not a tuning choice.

import { BONUS_BOUNDARY, BONUS_CONSECUTIVE, BONUS_FIRST_CHAR, PENALTY_GAP_EXTEND, PENALTY_GAP_START, SCORE_MATCH, byScore, maskOf, normalize, passes } from '../../search.js';

export { chunks } from './02-split.mjs';

export const id = '04-packed';
export const label = '+ packed columns';
export const notes = 'flat Uint8Array + Uint32Array offsets; byte-level matcher';

// Byte codes of the boundary characters in search.js. A 256-entry lookup beats
// a Set probe in the inner loop.
const IS_BOUNDARY = new Uint8Array(256);
for (const c of ['/', '-', '.', '_', ' ', '@', ':']) IS_BOUNDARY[c.charCodeAt(0)] = 1;

const SHARD_SIZE = 32;

export function build(ports) {
	const n = ports.length;
	const hOff = new Uint32Array(n + 1);
	const nOff = new Uint32Array(n + 1);
	const iOff = new Uint32Array(n + 1);
	const m0 = new Int32Array(n);
	const m1 = new Int32Array(n);

	const texts = new Array(n);
	const shards = new Map();
	const shardCount = Math.max(1, Math.ceil(n / SHARD_SIZE));

	for (let i = 0; i < n; i++) {
		const p = ports[i];
		const haystack = normalize(p.haystack);
		const name = normalize(p.name);
		const pid = normalize(p.id);

		const [lo, hi] = maskOf(haystack);
		m0[i] = lo;
		m1[i] = hi;

		texts[i] = [haystack, name, pid];
		hOff[i + 1] = hOff[i] + haystack.length;
		nOff[i + 1] = nOff[i] + name.length;
		iOff[i + 1] = iOff[i] + pid.length;

		const key = shardOf(p.id, shardCount);
		if (!shards.has(key)) shards.set(key, {});
		shards.get(key)[p.id] = { versions: p.versions, platforms: p.platforms, target: p.target };
	}

	const hBuf = new Uint8Array(hOff[n]);
	const nBuf = new Uint8Array(nOff[n]);
	const iBuf = new Uint8Array(iOff[n]);
	for (let i = 0; i < n; i++) {
		writeAscii(hBuf, hOff[i], texts[i][0]);
		writeAscii(nBuf, nOff[i], texts[i][1]);
		writeAscii(iBuf, iOff[i], texts[i][2]);
	}

	return { n, hBuf, nBuf, iBuf, hOff, nOff, iOff, m0, m1, shards, ids: new Array(n) };
}

function writeAscii(buf, at, s) {
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		// The packed layout is one byte per character. Port ids and upstream
		// paths are ASCII; anything else would silently truncate.
		if (c > 127) throw new Error(`non-ASCII character ${JSON.stringify(s[i])} in ${JSON.stringify(s)}`);
		buf[at + i] = c;
	}
}

function shardOf(id, count) {
	let h = 0x811c9dc5;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0) % count;
}

export function serialize(index) {
	// Binary rather than JSON: this is what would actually be shipped.
	const head = Buffer.alloc(4);
	head.writeUInt32LE(index.n, 0);
	return Buffer.concat([
		head,
		Buffer.from(index.hOff.buffer, index.hOff.byteOffset, index.hOff.byteLength),
		Buffer.from(index.nOff.buffer, index.nOff.byteOffset, index.nOff.byteLength),
		Buffer.from(index.iOff.buffer, index.iOff.byteOffset, index.iOff.byteLength),
		Buffer.from(index.m0.buffer, index.m0.byteOffset, index.m0.byteLength),
		Buffer.from(index.m1.buffer, index.m1.byteOffset, index.m1.byteLength),
		Buffer.from(index.hBuf),
		Buffer.from(index.nBuf),
		Buffer.from(index.iBuf),
	]);
}

export function search(index, query, limit) {
	const k = limit ?? Infinity;
	const q = normalize(query);
	const needle = new Uint8Array(q.length);
	writeAscii(needle, 0, q);
	const [qLo, qHi] = maskOf(q);

	const { n, hBuf, nBuf, iBuf, hOff, nOff, iOff, m0, m1 } = index;
	const heap = [];
	const all = Number.isFinite(k) ? null : [];

	for (let i = 0; i < n; i++) {
		if ((m0[i] & qLo) !== qLo || (m1[i] & qHi) !== qHi) continue;

		const onHay = score(needle, hBuf, hOff[i], hOff[i + 1]);
		if (onHay === null) continue;

		const onName = score(needle, nBuf, nOff[i], nOff[i + 1]);
		const onId = score(needle, iBuf, iOff[i], iOff[i + 1]);

		let total = onHay;
		if (onId !== null) total += onId;
		if (onName !== null) total += onName * 2;
		total -= (iOff[i + 1] - iOff[i]) * 0.1;

		const entry = { id: idAt(index, i), score: total };
		if (all !== null) {
			all.push(entry);
		} else if (heap.length < k) {
			push(heap, entry);
		} else if (byScore(entry, heap[0]) < 0) {
			heap[0] = entry;
			down(heap, 0);
		}
	}

	return (all ?? heap).sort(byScore);
}

/** Decode an id only when it reaches the result set. */
function idAt(index, i) {
	let s = index.ids[i];
	if (s === undefined) {
		s = String.fromCharCode(...index.iBuf.subarray(index.iOff[i], index.iOff[i + 1]));
		index.ids[i] = s;
	}
	return s;
}

/**
 * Byte-level equivalent of match() in search.js, returning the score only.
 * Positions are not needed here, which saves the array allocation per hit.
 */
function score(needle, buf, start, end) {
	const n = needle.length;
	const len = end - start;
	if (n === 0) return 0;
	if (n > len) return null;

	let ni = 0;
	let stop = -1;
	for (let i = start; i < end; i++) {
		if (buf[i] === needle[ni] && ++ni === n) {
			stop = i + 1;
			break;
		}
	}
	if (stop < 0) return null;

	ni = n - 1;
	let from = start;
	for (let i = stop - 1; i >= start; i--) {
		if (buf[i] === needle[ni] && ni-- === 0) {
			from = i;
			break;
		}
	}

	let total = 0;
	let consecutive = 0;
	let inGap = false;
	ni = 0;
	for (let i = from; i < stop; i++) {
		if (buf[i] === needle[ni]) {
			total += SCORE_MATCH;
			let bonus = i === start || IS_BOUNDARY[buf[i - 1]] === 1 ? BONUS_BOUNDARY : 0;
			if (consecutive > 0 && bonus < BONUS_CONSECUTIVE) bonus = BONUS_CONSECUTIVE;
			if (ni === 0) bonus += BONUS_FIRST_CHAR;
			total += bonus;
			consecutive++;
			inGap = false;
			ni++;
		} else {
			total += inGap ? PENALTY_GAP_EXTEND : PENALTY_GAP_START;
			inGap = true;
			consecutive = 0;
		}
	}
	return total;
}

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

export function probe(index, query) {
	const q = normalize(query);
	const needle = new Uint8Array(q.length);
	writeAscii(needle, 0, q);
	const [qLo, qHi] = maskOf(q);

	let scored = 0;
	let matched = 0;
	for (let i = 0; i < index.n; i++) {
		if ((index.m0[i] & qLo) !== qLo || (index.m1[i] & qHi) !== qHi) continue;
		scored++;
		if (score(needle, index.hBuf, index.hOff[i], index.hOff[i + 1]) !== null) matched++;
	}
	return { scanned: index.n, scored, matched };
}
