# arrakis

The artifacts must flow.

```sh
$ curl -v https://pkg.opt.td/lesomnus/arks@0.0.1/linux/$(uname -m)
> GET /lesomnus/arks@0.0.1/linux/x86_64 HTTP/2
< HTTP/2 301
< location: https://github.com/lesomnus/arrakis/releases/download/v0.0.1/arks-linux-amd64
```


Browse the registered ports at
**[lesomnus.github.io/arrakis](https://lesomnus.github.io/arrakis/)**, or read
the same data as JSON at
[`/index.json`](https://lesomnus.github.io/arrakis/index.json). Both are
regenerated from `port/**` on every push; see [web/](web/README.md).

## Usage

### Linux
```sh
curl -LO https://pkg.opt.td/lesomnus/arks@0.0.1/linux/$(uname -m)
```

### Windows
```sh
curl -LO "https://pkg.opt.td/lesomnus/arks@0.0.1/windows/${env:PROCESSOR_ARCHITECTURE}"
```

### Dockerfile
```Dockerfile
RUN curl -LO https://pkg.opt.td/lesomnus/arks@0.0.1/linux/${TARGETARCH}
```

## Contributing

### Naming a port

A port's name is the path you type after `pkg.opt.td/`, and it is chosen
independently of where the binaries actually live.

**Name it after the project's own domain.** `terraform` is at
`hashicorp.com/terraform` even though the files come from
`releases.hashicorp.com`; `oras` is at `oras.land/oras` even though the files
come from GitHub releases. A domain is the one name a project gives itself that
nobody else assigns, it survives the project moving its hosting, and in a
download URL it reads as what it is -- the terraform from hashicorp.com.

**When there is no such domain, name it `<publisher>/<tool>`.** `golang/go`,
`lesomnus/arks`. The repository is left out on purpose: it is an implementation
detail of where the source happens to sit, and a project can publish several
tools from one repository or one tool from several.

**Tools published by the forge itself drop the org**, so GitHub's CLI is
`github.com/gh` rather than `github.com/cli/gh`. `github.com` is already the
project's domain in that case, and repeating the org would read as if `cli`
were a separate vendor.

The directory layout mirrors the name, and the redirect target is set separately
in `config.yaml`:

```yaml
# port/oras.land/config.yaml -- gives the port oras.land/oras
target:
  path: github.com/oras-project/oras
  suffix: /releases/download/
```

> [!NOTE]
> Every port added before this rule was written is exempt from it, and stays as
> it is. `bufbuild/buf/buf` would be `buf.build/buf`, `golang/go` would be
> `go.dev/go`, and `protocolbuffers/protobuf/protoc` would be
> `protobuf.dev/protoc` -- all three domains exist. Renaming them would break
> every URL already pointing at them, which is not a trade worth making for
> tidiness. New ports follow the rule.
>
> `arks` is the exception to the exemption: it was `lesomnus/arrakis/arks` and
> is now `lesomnus/arks`, because it is this project's own tool and there is
> nobody else to break. Its old keys stay in KV, because nothing deletes keys --
> see below.

### Add a new version for the port

1. Update `versions` file in the port directory.

	E.g. [ports/go.dev/go/versions](ports/go.dev/go/versions):

	```diff
	--- a/port/go.dev/go/versions
	+++ b/port/go.dev/go/versions
	@@ -1,3 +1,4 @@
	1.26.0
	1.26.1
	-1.26.2 1.26 latest
	+1.26.2
	+1.26.3 1.26 latest
	```

2. Test should pass without any errors.
	
	```sh
	arks test
	```

3. Verify the new version is added in diff.

	```text
	go 1.26.3
		go.dev/dl/go1.26.3.darwin-amd64.tar.gz
				golang/go@1.26.3/darwin/amd64
				golang/go@1.26.3/darwin/x86_64
	...
	```

### What sync does not do

`arks diff` reports what the port tree has that the snapshot does not, and the
`Sync` workflow feeds that to `wrangler kv bulk put`. Nothing anywhere computes
or applies a deletion, so **KV only ever grows**. A port that is renamed or
removed, or a version dropped from a `versions` file, leaves its keys behind.

Exact keys keep working, which is harmless. Alias keys do not: an orphaned
`@latest` is never written again, so it freezes at whatever it last resolved to
and quietly serves an old binary rather than failing. That is worse than a 404,
and it is why nothing in CI should reach for a tool through an alias it also
publishes -- the `Sync` job fetches `arks` straight from GitHub releases for
exactly this reason.

Making KV a function of the port tree means a prune step: list every key, render
the full desired set, delete the difference. It is not implemented.

### Discover new versions automatically

Place a `source.yaml` next to a `versions` file to let `arks bump` discover new
versions and append them (existing versions are never removed). Alias tags
(`latest` and the series alias like `2.89`) are regenerated automatically, so the
`versions` file only needs bare version numbers.

```sh
arks bump           # discover and write
arks bump --dry-run # print what would change
```

The `Bump` workflow runs this on a schedule and opens a pull request.

**GitHub releases** — for anything released via GitHub releases:

```yaml
# port/github.com/cli/gh/source.yaml
kind: github
repo: cli/cli
limit: 20   # consider only the newest 20 releases
```

**HTTP** — the escape hatch. Fetches a URL and extracts every version matched by
`match` (capture group 1). Works with any JSON/HTML/text endpoint:

```yaml
# port/go.dev/go/source.yaml
kind: http
url: https://go.dev/dl/?mode=json&include=all
match: '"version":\s*"go([\d.]+)"'
limit: 12
```

> [!IMPORTANT]
> Anchor the `match` regex so it can't capture a prefix of a prerelease. For
> example `go(\d+\.\d+)` would turn `go1.27rc1` into a bogus stable `1.27`;
> requiring a trailing `"` as above rejects it.

Common fields: `match` (regex, default `^v?(.+)$`), `prerelease` (keep
prereleases, default `false`), `limit` (consider newest N discovered, `0` = all),
and `alias.series` / `alias.latest` (set `series: false` to emit only `latest`).
