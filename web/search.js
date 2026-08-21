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

const NEG = -Infinity;

// Scratch rows for the score-only path, grown on demand and reused. Scoring
// runs once per port per keystroke, so allocating here would dominate.
let rowPrev = new Float64Array(0);
let rowCurr = new Float64Array(0);

function grow(n) {
	if (rowPrev.length < n) {
		rowPrev = new Float64Array(n);
		rowCurr = new Float64Array(n);
	}
}

/** A match at j starts a word when it opens the string or follows a separator. */
function bonusAt(haystack, j) {
	return j === 0 || BOUNDARY.has(haystack[j - 1]) ? BONUS_BOUNDARY : 0;
}

/**
 * Best score for `needle` as a subsequence of `haystack`, or null if it is not
 * one. Both must already be normalized.
 *
 * This is a dynamic program over (needle index, haystack index) rather than a
 * single greedy pass. Greedy takes the leftmost match, which for "gh" against
 * "github.com/gh" lands on g...h inside "github" and leaves the exact "gh" at
 * the end unhighlighted -- correct by the letter, obviously wrong to a reader.
 *
 * The gap penalty is affine, so the search over previous positions collapses
 * into a running maximum and the whole thing stays O(needle x haystack).
 */
export function score(needle, haystack) {
	const m = needle.length;
	const n = haystack.length;
	if (m === 0) return 0;
	if (m > n) return null;

	grow(n);
	let prev = rowPrev;
	let curr = rowCurr;

	// First needle character: no predecessor, so only the opening bonus applies.
	for (let j = 0; j < n; j++) {
		prev[j] = haystack[j] === needle[0] ? SCORE_MATCH + bonusAt(haystack, j) + BONUS_FIRST_CHAR : NEG;
	}

	for (let k = 1; k < m; k++) {
		const ch = needle[k];
		// best over i <= j-2 of (prev[i] + i); the affine gap term folds into it.
		let running = NEG;

		for (let j = 0; j < n; j++) {
			if (j >= 2 && prev[j - 2] !== NEG) {
				const v = prev[j - 2] + (j - 2);
				if (v > running) running = v;
			}
			if (haystack[j] !== ch) {
				curr[j] = NEG;
				continue;
			}

			const boundary = bonusAt(haystack, j);
			let best = NEG;
			// Adjacent to the previous match: no gap, consecutive bonus applies.
			if (j >= 1 && prev[j - 1] !== NEG) {
				best = prev[j - 1] + SCORE_MATCH + Math.max(boundary, BONUS_CONSECUTIVE);
			}
			// Separated by a gap of length j-i-1, penalised as -2-(gap length).
			if (running !== NEG) {
				const withGap = running - j - 1 + SCORE_MATCH + boundary;
				if (withGap > best) best = withGap;
			}
			curr[j] = best;
		}

		const t = prev;
		prev = curr;
		curr = t;
	}

	let best = NEG;
	for (let j = 0; j < n; j++) if (prev[j] > best) best = prev[j];
	return best === NEG ? null : best;
}

/**
 * The matched character positions of the best alignment, for highlighting.
 *
 * Kept apart from score() on purpose: only the rows actually rendered need
 * positions, so the full table and its backtrack are paid for a few dozen
 * times per keystroke rather than once per port.
 */
export function positionsOf(needle, haystack) {
	const m = needle.length;
	const n = haystack.length;
	if (m === 0 || m > n) return [];

	const table = [];
	const from = [];

	let prev = new Float64Array(n);
	for (let j = 0; j < n; j++) {
		prev[j] = haystack[j] === needle[0] ? SCORE_MATCH + bonusAt(haystack, j) + BONUS_FIRST_CHAR : NEG;
	}
	table.push(prev);
	from.push(new Int32Array(n).fill(-1));

	for (let k = 1; k < m; k++) {
		const ch = needle[k];
		const curr = new Float64Array(n);
		const back = new Int32Array(n).fill(-1);

		let running = NEG;
		let runningAt = -1;
		for (let j = 0; j < n; j++) {
			if (j >= 2 && prev[j - 2] !== NEG) {
				const v = prev[j - 2] + (j - 2);
				if (v > running) {
					running = v;
					runningAt = j - 2;
				}
			}
			if (haystack[j] !== ch) {
				curr[j] = NEG;
				continue;
			}

			const boundary = bonusAt(haystack, j);
			let best = NEG;
			let at = -1;
			if (j >= 1 && prev[j - 1] !== NEG) {
				best = prev[j - 1] + SCORE_MATCH + Math.max(boundary, BONUS_CONSECUTIVE);
				at = j - 1;
			}
			if (running !== NEG) {
				const withGap = running - j - 1 + SCORE_MATCH + boundary;
				if (withGap > best) {
					best = withGap;
					at = runningAt;
				}
			}
			curr[j] = best;
			back[j] = at;
		}

		table.push(curr);
		from.push(back);
		prev = curr;
	}

	let end = -1;
	let best = NEG;
	for (let j = 0; j < n; j++) if (prev[j] > best) ((best = prev[j]), (end = j));
	if (end < 0) return [];

	const out = new Array(m);
	for (let k = m - 1; k >= 0; k--) {
		out[k] = end;
		end = from[k][end];
	}
	return out;
}

/**
 * Score a port record. `haystack` drives recall (it contains the upstream repo
 * so "protobuf" finds "protoc"), while a match on the shorter id/name is worth
 * more so that boilerplate tokens like "releases" cannot outrank an exact hit.
 */
export function scorePort(query, port) {
	const onHay = score(query, port.haystack);
	if (onHay === null) return null;

	const onName = score(query, port.name);
	const onId = score(query, port.id);

	let total = onHay;
	if (onId !== null) total += onId;
	if (onName !== null) total += onName * 2;
	// Shorter ids win ties.
	total -= port.id.length * 0.1;

	return { score: total, onId: onId !== null };
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
