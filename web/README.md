# web

Static port index for GitHub Pages. No build step, no dependencies -- the page
is plain ES modules loading a generated JSON file.

```
index.html   the list
app.js
port.html    one port in full
port.js
shared.js    index loading, platform choice, command, logos
search.js    fuzzy matcher, shared with the benchmark
style.css
index.json   generated, not committed
bench/       strategy comparison harness
tools/       screenshot harness for looking at the page
```

## The two pages

**The list** answers one question -- what is the command for this port on my
platform -- and is built so that answering it never moves anything. Rows are a
grid with identical track sizes, so the version, the name and the two controls
line up all the way down. Nothing expands: the command line lives under the
platform picker and rewrites itself to follow whichever row has focus, or is
hovered when nothing has focus, or the first result when neither. Pointing at a
different port changes one line of text and nothing else.

**The port page** (`port.html?id=<port>`) is where everything the list leaves
out goes: which upstream source the versions are discovered from and how, the
full version table with its aliases, every platform with the arch spellings that
resolve, and a link to the port's files. A query parameter rather than a
generated file per port, so it costs nothing to add ports.

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
  "schema": 2,
  "ports": [
    {
      "id": "github.com/gh",
      "path": "github.com",
      "name": "gh",
      "target": "github.com/cli/cli/releases/download/",
      "dir": "github.com/cli/gh",
      "source": {
        "kind": "github",
        "repo": "cli/cli",
        "match": "^v?(.+)$",
        "prerelease": false,
        "limit": 20,
        "series": true,
        "latest": true
      },
      "latest": "2.97.0",
      "versions": [{ "v": "2.97.0", "aliases": ["2.97", "latest"] }],
      "platforms": [{ "os": "linux", "arch": "amd64", "accepts": ["amd64", "x86_64"] }],
      "haystack": "github.com/gh gh github.com/cli/cli/releases/download github.com cli releases download"
    }
  ]
}
```

`source` mirrors the port's `source.yaml` **with the defaults already applied**,
so the page shows what will actually happen rather than what the file happens to
spell out -- `match` is filled in even when the file omits it. It is absent for
ports whose versions are added by hand. `dir` is relative to the port root, so
the page prefixes `port/` to link back to the files.

Nothing in the search path reads either field; they exist for the port page.

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

`tools/probe.mjs` covers the other half -- behaviour a picture cannot show,
because it is about what happens *between* two states:

```sh
node tools/probe.mjs
node tools/probe.mjs --url https://lesomnus.github.io/arrakis/
```

It walks the pointer down the list a few pixels at a time and asserts the
command line only ever moves forward, checks that focus beats hover and that
tabbing between one row's controls does not leave it, and measures every row's
geometry before and after interacting to prove nothing moved. Both run in CI.

### The version dropdown

Versions are ruled off between series -- the version with its last dot-segment
removed, the same grouping the alias generator uses -- and within a series only
the newest patch is undimmed, since that is the one the series alias resolves
to. Older patches stay selectable for pinning. A version with no dot opts out of
grouping rather than becoming a group of one.

The list's dropdown shows the newest three majors, the newest three minors
within each, and the newest three patches within each of those: at most 27
entries, and in practice far fewer -- `gh` drops from 21 versions to 3, `go`
from 17 to 7. It is a menu for picking something to run now, and twenty releases
make that harder rather than easier. Whatever was left out is named on a
disabled last line (`+18 more on the port page`) rather than silently dropped;
the port page carries the complete set, which is where a reference belongs.

Only Chromium can style options inside an open `<select>`, so elsewhere the
separators show and the dimming does not. The separators carry the structure, so
that degrades acceptably.

### The command box

The box is one height whatever it holds. `overflow-x: scroll` rather than
`auto`, because on platforms that give a scrollbar its own space `auto` makes
the box taller the moment a command is long enough to need one; reserving the
gutter always keeps it constant, and a transparent track means nothing shows
when there is nothing to scroll. Whichever edge the command continues past gets
a gradient, driven by a `data-fade` attribute the scroll handler keeps up to
date, so a line that is cut off looks cut off.

**Headless Chromium draws no scrollbar at all**, with or without
`--disable-features=OverlayScrollbar` and on both the headless shell and the
full channel: the gutter measures zero either way. So neither the scrollbar
styling nor the height-constancy it protects can be checked by `tools/shot.mjs`
— `tools/probe.mjs` asserts the height never changes, but it would pass with or
without the fix here. Both need a real browser.

### The version dropdown, continued

The picker's scrollbar is styled with `scrollbar-width` / `scrollbar-color`
rather than the `::-webkit-scrollbar` pseudo-elements: Chrome ignores those once
`scrollbar-color` is set, and chaining them after `::picker()` is not something
the selector grammar allows. Like the command box's, this cannot be checked here; see above.

### Why the probe exists

The pointer walk exists because of a real regression: rows have gaps between
them, so dragging down the list puts the pointer over the background between
every pair, and clearing the hover there made the command line snap back to the
first result and forward again -- 13 changes for 7 rows. It is the kind of fault
that is obvious in use and invisible in both the code and a screenshot.

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
| linear scan | 11.66 MB | - | 323.23 ms | 595.51 ms | 100% | 1.00x |
| + char bitmask | 12.18 MB | - | 246.97 ms | 550.83 ms | 69% | 1.31x |
| + split payload | 3.86 MB | 3.4 KB | 241.69 ms | 585.98 ms | 69% | 1.34x |
| + top-K heap | 3.86 MB | 3.4 KB | 198.08 ms | 490.74 ms | 69% | 1.63x |
| + packed columns | **3.73 MB** | 3.4 KB | **130.32 ms** | 333.97 ms | 69% | **2.48x** |

**Splitting the payload is the largest single win and it is not a speed win at
all.** 11.66 MB down to 3.86 MB, with a click costing 3.4 KB, and latency
unchanged to within noise. Versions and platforms dominate the bytes and are
only ever needed for the one port the user selects.

**Packing the corpus into byte buffers is the largest speed win** -- 1.63x to
2.48x from replacing an array of JS objects with a flat `Uint8Array` and
`Uint32Array` offsets. Property loads and UTF-16 comparisons, not the matching
algorithm, were a third of the remaining time. `--check` confirms the byte
matcher returns the same ranking as the string one.

**Bounding the result set to K is the cheapest win** -- 1.34x to 1.63x, with no
change to the index format. A one-character query matches most of the corpus,
so the baseline built a 100,000-element array and sorted all of it to render 50
rows.

**The character bitmask is weak on this corpus** -- 1.31x. The `kept by query
length` row explains it: the filter rejects 15% of the corpus on a 1-character
query and 43% on a 6-character one. Search boxes receive mostly short prefixes,
and nearly every port contains `b` or `u`. It works well in fzf because file
paths have a far sparser character distribution than package names do.

### What changed when the matcher got heavier

These numbers were re-measured after `score()` moved from a single greedy pass
to the dynamic program described below. The whole table got about three times
slower, but not uniformly, and the pattern is the useful part:

| | greedy | optimal DP |
|---|---|---|
| baseline mean | 110.72 ms | 323.23 ms |
| bitmask, marginal | 1.13x | 1.31x |
| top-K, marginal | 2.03x | 1.22x |
| packed, marginal | 3.27x | 1.52x |
| end to end | 7.66x | 2.48x |

The prefilter got **more** valuable, because the work it skips is now more
expensive. Sorting and memory layout got **less** valuable, because matching
now dominates the time they used to share. Optimizing the data path pays in
proportion to how cheap the algorithm is; make the algorithm heavier and those
gains compress toward nothing.

If the corpus ever grew enough for this to matter, the move is not to undo the
DP but to split it the way positions already are: greedy scores for ranking,
the DP only for the rows on screen. The greedy scores put the right port first
on every query tried before the switch, but that was never measured at scale --
so treat it as a lead to verify, not a result. At seven ports it is not worth a
second code path either way.

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
- **~5,000 ports** -- a query passes 16 ms, one frame, so typing starts to feel
  it. `03` is the cheap fix and does not touch the index format.
- **beyond that** -- `04`, then greedy-score-with-DP-highlighting, and then the
  question stops being about JavaScript.
