# arrkis

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
