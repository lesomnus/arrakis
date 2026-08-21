// Fuzzy matching primitives shared by the site and the benchmark harness.
//
// The matcher is fzf's FuzzyMatchV1: a forward pass locates a subsequence
// match, a backward pass tightens it to the shortest window, then the window
// is scored. It is O(len(haystack)) per document, which is what makes a
// prefilter worth measuring -- see maskOf/passes below.

export const SCORE_MATCH = 16;
export const BONUS_BOUNDARY = 8;
export const BONUS_CONSECUTIVE = 6;
export const BONUS_FIRST_CHAR = 12;
export const PENALTY_GAP_START = -3;
export const PENALTY_GAP_EXTEND = -1;

const BOUNDARY = new Set(['/', '-', '.', '_', ' ', '@', ':']);

/** Lowercase and collapse whitespace. Both index and query go through this. */
export function normalize(s) {
	return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Alphabet slots for the character bitmask. 64 slots split across two 32-bit
// words because JS bitwise operators truncate to 32 bits.
//   0-25  a-z        26-35 0-9        36-42 . / - _ space @ :
//   43    anything else (set only when such a character is actually present)
const SLOT_OTHER = 43;
const SYMBOLS = { '.': 36, '/': 37, '-': 38, '_': 39, ' ': 40, '@': 41, ':': 42 };

function slotOf(code, ch) {
	if (code >= 97 && code <= 122) return code - 97; // a-z
	if (code >= 48 && code <= 57) return code - 48 + 26; // 0-9
	const s = SYMBOLS[ch];
	return s === undefined ? SLOT_OTHER : s;
}

/**
 * Build the character-presence bitmask of a normalized string.
 * Returns [lo, hi]: slot n is bit (n & 31) of lo when n < 32, else of hi.
 */
export function maskOf(s) {
	let lo = 0;
	let hi = 0;
	for (let i = 0; i < s.length; i++) {
		const n = slotOf(s.charCodeAt(i), s[i]);
		if (n < 32) lo |= 1 << n;
		else hi |= 1 << (n - 32);
	}
	return [lo, hi];
}

/**
 * True when every character of the query appears somewhere in the document.
 * A necessary condition for a subsequence match, so a false result is a safe
 * rejection -- two ANDs instead of a full scan.
 */
export function passes(docLo, docHi, qLo, qHi) {
	return (docLo & qLo) === qLo && (docHi & qHi) === qHi;
}

function bonusAt(haystack, i) {
	if (i === 0) return BONUS_BOUNDARY;
	return BOUNDARY.has(haystack[i - 1]) ? BONUS_BOUNDARY : 0;
}

/**
 * Match `needle` against `haystack`, both already normalized.
 * Returns null when `needle` is not a subsequence, otherwise the score and the
 * matched character positions.
 */
export function match(needle, haystack) {
	const n = needle.length;
	const h = haystack.length;
	if (n === 0) return { score: 0, positions: [] };
	if (n > h) return null;

	// Forward: find the earliest position at which the needle is exhausted.
	let ni = 0;
	let end = -1;
	for (let i = 0; i < h; i++) {
		if (haystack[i] === needle[ni]) {
			if (++ni === n) {
				end = i + 1;
				break;
			}
		}
	}
	if (end < 0) return null;

	// Backward: pull the start forward to the shortest window ending at `end`.
	ni = n - 1;
	let start = 0;
	for (let i = end - 1; i >= 0; i--) {
		if (haystack[i] === needle[ni]) {
			if (ni-- === 0) {
				start = i;
				break;
			}
		}
	}

	// Score the window.
	let score = 0;
	let consecutive = 0;
	let inGap = false;
	const positions = [];
	ni = 0;
	for (let i = start; i < end; i++) {
		if (haystack[i] === needle[ni]) {
			positions.push(i);
			score += SCORE_MATCH;
			let bonus = bonusAt(haystack, i);
			if (consecutive > 0) bonus = Math.max(bonus, BONUS_CONSECUTIVE);
			if (ni === 0) bonus += BONUS_FIRST_CHAR;
			score += bonus;
			consecutive++;
			inGap = false;
			ni++;
		} else {
			score += inGap ? PENALTY_GAP_EXTEND : PENALTY_GAP_START;
			inGap = true;
			consecutive = 0;
		}
	}
	return { score, positions };
}

/**
 * Score a port record. `haystack` drives recall (it contains the upstream repo
 * so "protobuf" finds "protoc"), while a match on the shorter id/name is worth
 * more so that boilerplate tokens like "releases" cannot outrank an exact hit.
 */
export function scorePort(query, port) {
	const onHay = match(query, port.haystack);
	if (onHay === null) return null;

	const onName = match(query, port.name);
	const onId = match(query, port.id);

	let score = onHay.score;
	if (onId) score += onId.score;
	if (onName) score += onName.score * 2;
	// Shorter ids win ties.
	score -= port.id.length * 0.1;

	return { score, positions: (onId ?? onHay).positions, field: onId ? 'id' : 'haystack' };
}

/**
 * Total order over hits: score descending, then id ascending.
 *
 * The tiebreak is not cosmetic. Array.prototype.sort is stable, so a full sort
 * leaves equal scores in index order, while a bounded top-K heap does not.
 * Without a total order the two would disagree on ties and the benchmark's
 * agreement check could not tell a real regression from an ordering artifact.
 */
export function byScore(a, b) {
	return b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
