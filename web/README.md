# web

Static port index for GitHub Pages. No build step, no dependencies -- the page
is plain ES modules loading a generated JSON file.

```
index.html   page shell
style.css
app.js       page logic
search.js    fuzzy matcher, shared with the benchmark
index.json   generated, not committed
bench/       strategy comparison harness
tools/       screenshot harness for looking at the page
```

## Generating the index

```sh
go run . render --kind index > web/index.json
python3 -m http.server -d web 8000   # any static server will do
```

The `Pages` workflow does the same on every push that touches `port/**` or
`web/**`, then deploys. `index.json` is deliberately not committed: it is
derived from `port/**`, so committing it would only produce churn.

## Index schema

One record per port, not per resolvable URL. The seven ports currently expand
to 1031 KV keys; searching over keys would be searching the same seven names
over and over. Versions and platforms are what you pick *after* choosing a port.

```json
{
  "schema": 1,
  "ports": [
    {
      "id": "github.com/gh",
      "path": "github.com",
      "name": "gh",
      "target": "github.com/cli/cli/releases/download/",
      "latest": "2.97.0",
      "versions": [{ "v": "2.97.0", "aliases": ["2.97", "latest"] }],
      "platforms": [{ "os": "linux", "arch": "amd64", "accepts": ["amd64", "x86_64"] }],
      "haystack": "github.com/gh gh github.com/cli/cli/releases/download github.com cli releases download"
    }
  ]
}
```

Two fields exist purely for search:

- **`target`** carries the upstream repository, which the id often does not.
  `protoc` lives in `protocolbuffers/protobuf`, so without this a search for
  "protobuf" would find nothing.
- **`haystack`** is the pre-lowercased, pre-tokenized search string. It drives
  recall; `app.js` scores a match on the shorter `id`/`name` higher so that
  boilerplate tokens like "releases" cannot outrank an exact hit.

`accepts` is ground truth rather than documentation: an arch spelling absent
from it does not resolve. Note that Windows registers `AMD64`, uppercase.

## Looking at the page

Reading the markup only goes so far. `tools/shot.mjs` drives headless Chromium
over the states that static review cannot answer.

```sh
npm install && npx playwright install chromium
node tools/shot.mjs                    # all scenes -> tools/shots/
node tools/shot.mjs --only dropdown
node tools/shot.mjs --url https://lesomnus.github.io/arrakis/
node tools/shot.mjs --keep             # leave the server up
```

The scenes are chosen for what is otherwise invisible: whether the theme
actually flips, whether the styled `<select>` popup renders (Chromium is the
only engine that lets CSS reach it), whether an unsupported platform reads as
deliberate rather than broken, and whether the layout survives a phone. Each
run also fails loudly on console errors, failed requests, and horizontal
overflow -- that last one is easy to miss in a full-page screenshot and
impossible to miss on a phone.

Every scene is a plain object in the file; add one rather than clicking through
by hand.

## Benchmark

The real index has 7 ports, which cannot distinguish one strategy from another.
`bench/` generates a synthetic corpus with the same record shape and sweeps
corpus size.

```sh
node web/bench/run.mjs                    # full sweep
node web/bench/run.mjs --n 1000,100000    # pick sizes
node web/bench/run.mjs --only 01-bitmask
node web/bench/run.mjs --check            # strategies must agree on ranking
```

Run `--check` before trusting a timing: a strategy that returns a different
ranking is not a faster strategy, it is a broken one.

A strategy is a module in `bench/strategies/` exporting `id`, `label`,
`build(ports)`, `serialize(index)`, `search(index, query, limit)`, and
optionally `probe(index, query)` for prefilter diagnostics.

### Strategies

Cumulative -- each adds exactly one change to the one above it, so a row's delta
is attributable to a single decision.

| | strategy | change |
|---|---|---|
| `00` | linear scan | baseline: ship the index as generated, score every port |
| `01` | + char bitmask | 64-bit character-presence mask rejects before scoring |
| `02` | + split payload | lean index up front, detail sharded and fetched on click |
| `03` | + top-K heap | size-K min-heap instead of sorting every hit |
| `04` | + packed columns | flat `Uint8Array` + `Uint32Array` offsets, byte-level matcher |

### Results

At N = 100,000, on one machine, with the query workload in `corpus.mjs`:

| strategy | upfront | +click | mean | p99 | kept | vs base |
|---|---|---|---|---|---|---|
| linear scan | 11.66 MB | - | 110.72 ms | 179.76 ms | 100% | 1.00x |
| + char bitmask | 12.18 MB | - | 97.93 ms | 185.50 ms | 69% | 1.13x |
| + split payload | 3.86 MB | 3.4 KB | 99.98 ms | 206.04 ms | 69% | 1.11x |
| + top-K heap | 3.86 MB | 3.4 KB | 49.15 ms | 96.96 ms | 69% | 2.25x |
| + packed columns | **3.73 MB** | 3.4 KB | **14.46 ms** | 32.89 ms | 69% | **7.66x** |

Three findings, in order of how much they moved the number.

**Packing the corpus into byte buffers is worth more than any filter** -- 2.25x
to 7.66x from that change alone. The baseline spends most of its time on
property loads and UTF-16 string comparisons, not on the matching algorithm.
Struct-of-arrays removes that overhead and nothing else changed: `--check`
confirms the byte matcher returns the same ranking as the string one.

**Sorting was about half the cost at scale.** A one-character query matches most
of the corpus, so the baseline built a 100,000-element array and sorted all of
it to render 50 rows. Bounding the selection to K is the single cheapest win
here (1.11x to 2.25x) and needs no change to the index.

**The character bitmask is weak on this corpus** -- 1.13x. The `kept by query
length` row explains it: the filter rejects 15% of the corpus on a 1-character
query and 43% on a 6-character one. Search boxes receive mostly short prefixes,
and nearly every port contains `b` or `u`. It works well in fzf because file
paths have a far sparser character distribution than package names do.

Splitting the payload does not change latency at all -- it is purely a transfer
win, and a large one: 11.66 MB to 3.86 MB, with a click costing 3.4 KB.

### On the matcher

`search.js` scores a match with a dynamic program over (needle, haystack)
rather than a single greedy pass, and it is worth knowing why, because the
greedy version is both simpler and faster.

Greedy takes the leftmost alignment. For `gh` against `github.com/gh` that is
`g` at 0 and `h` at 3 -- a real subsequence, but it highlights `gith` and
leaves the exact `gh` at the end unmarked. Correct by the letter, obviously
wrong to anyone reading the screen. The same thing turned `arks` into
`arra`k`i`s.

The gap penalty is affine, so the search over previous positions collapses into
a running maximum and the program stays O(needle x haystack) rather than
O(needle x haystack^2). It is still several times the cost of one greedy pass;
the results table above is what that costs.

Positions are computed separately from scores. Scoring runs once per port per
keystroke, but only the rows actually on screen need their alignment
backtracked, so `positionsOf` is called a few dozen times rather than tens of
thousands.

The DP is checked against brute-force enumeration of every alignment on random
short inputs -- see the note in `score()`. A scoring function that is merely
plausible is not worth optimizing.

### Why there is no trigram strategy

A trigram inverted index is the usual next step, and it is **unsound here**. Our
matcher accepts subsequences, not just substrings: `ghcli` matches
`github.com/gh ... cli` with gaps. Trigram intersection would reject that, so
the index would silently lose recall rather than run faster. `--check` catches
it, which is the point of having the check.

Sound prefilters for subsequence matching are limited to necessary conditions on
character content -- the bitmask is one, and the results above show how little
that buys. Making a trigram index viable means changing the matcher's semantics
to substring first, which is a product decision, not an optimization.

## Why the live site is still `00`

Seven ports. `index.json` is 12.7 KB, 1.07 KB gzipped, and a query takes ~50 µs.
Splitting it would add a round trip to save nothing, and a byte-packed index
would be a rewrite for microseconds nobody can perceive.

The measured thresholds for revisiting that:

- **~1,000 ports** -- the upfront payload passes ~100 KB gzipped, at which point
  the transfer saved by `02` exceeds the round trip it costs on click.
- **~10,000 ports** -- a query passes 16 ms, one frame, so typing starts to feel
  it. `03` is the cheap fix and does not touch the index format.
- **beyond that** -- `04`, and then the question stops being about JavaScript.
