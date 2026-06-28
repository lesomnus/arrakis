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
