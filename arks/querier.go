package arks

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"go.yaml.in/yaml/v4"
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

	c := NewConfig()
	for i, r := range p {
		p_ := p[:i]
		if i == len(p)-1 && r != '/' {
			// Last entry.
			p_ = p
		} else if r != '/' {
			continue
		}

		c_, err := ReadFromFile(q.FS, filepath.Join(p_, "config.yaml"))
		if err != nil {
			return "", err
		}

		c = c.Merge(&c_)
	}

	resolver, ok := c.Resolvers[v.Name]
	if !ok {
		return "", os.ErrNotExist
	}

	platform, ok := resolver.Resolve(v.Platform)
	if !ok {
		return "", os.ErrNotExist
	}

	v.Platform = platform
	target, err := resolver.Build(v)
	if err != nil {
		return "", err
	}

	return target, nil
}

func (q FsQuerier) readConfig(ctx context.Context, p string) (Config, error) {
	f, err := q.Open(p)
	if err != nil {
		return Config{}, fmt.Errorf("open config file %s: %w", p, err)
	}
	defer f.Close()

	c := NewConfig()
	if err := yaml.NewDecoder(f).Decode(&c); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}

	return c, nil
}
