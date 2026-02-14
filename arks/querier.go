package arks

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
)

type Querier interface {
	// Query returns the target URL for the given item.
	// If the item is not found, it should return an [os.ErrNotExist].
	Query(ctx context.Context, v Item) (string, error)
}

type FsQuerier struct {
	fs.FS
}

func (q FsQuerier) Query(ctx context.Context, v Item) (string, error) {
	p := v.Path
	for {
		if p == "" {
			return "", os.ErrNotExist
		}
		if p[0] != '/' {
			break
		}
		p = p[1:]
	}

	f, err := q.Open(p)
	if err != nil {
		return "", err
	}
	if info, err := f.Stat(); err != nil {
		return "", err
	} else if !info.IsDir() {
		return "", os.ErrNotExist
	}

	app := App{}
	found := false

	c := NewConfig()
	walker := FsWalker{Fs: q.FS.(fs.ReadDirFS)}
	for i, r := range p {
		p_ := p[:i]
		if i == len(p)-1 && r != '/' {
			// Last entry.
			p_ = p
		} else if r != '/' {
			continue
		}

		c, err = walker.Step(c, p_, func(c Config, p string, a App) error {
			app = a
			found = true
			return nil
		})
		if err != nil {
			return "", err
		}
	}

	if !found {
		return "", io.EOF
	}

	platform, ok := app.Platforms.Resolve(v.Platform)
	if !ok {
		return "", os.ErrNotExist
	}

	app.Versions = []string{v.Version}
	app.Platforms = PlatformMap{platform: platform}

	build, err := c.Build(app)
	if err != nil {
		return "", fmt.Errorf("prepare build for app: %w", err)
	}

	for items, err := range build {
		if err != nil {
			return "", fmt.Errorf("build app: %w", err)
		}
		if len(items) == 0 {
			return "", os.ErrNotExist
		}

		return items[0].Target, nil
	}

	return "", os.ErrNotExist
}
