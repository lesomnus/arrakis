# arrakis

The artifacts must flow.

```sh
$ curl -v https://pkg.opt.td/lesomnus/arrakis/arks@0.0.1/linux/$(uname -m)
> GET /lesomnus/arrakis/arks@0.0.1/linux/x86_64 HTTP/2
< HTTP/2 301
< location: https://github.com/lesomnus/arrakis/releases/download/v0.0.1/arks-linux-amd64
```


## Usage

### Linux
```sh
curl -LO https://pkg.opt.td/lesomnus/arrakis/arks@0.0.1/linux/$(uname -m)
```

### Windows
```sh
curl -LO "https://pkg.opt.td/lesomnus/arrakis/arks@0.0.1/windows/${env:PROCESSOR_ARCHITECTURE}"
```

### Dockerfile
```Dockerfile
RUN curl -LO https://pkg.opt.td/lesomnus/arrakis/arks@0.0.1/linux/${TARGETARCH}
```

## Contributing

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
