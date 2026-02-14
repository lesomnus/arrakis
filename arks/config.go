package arks

import (
	"errors"
	"fmt"
	"io/fs"
	"iter"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"text/template"

	"go.yaml.in/yaml/v4"
)

type Config struct {
	Path   string
	Target TargetConfig
}

func NewConfig() Config {
	return Config{}
}

func ReadConfigFile(fs fs.FS, p string) (Config, error) {
	var c Config

	f, err := fs.Open(p)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return c, err
		}
	} else {
		defer f.Close()
		if err := yaml.NewDecoder(f).Decode(&c); err != nil {
			return c, fmt.Errorf("decode config: %w", err)
		}
	}

	d := filepath.Base(filepath.Dir(p))
	if c.Path == "" {
		c.Path = "./" + d
	}
	if c.Target.Path == "" {
		c.Target.Path = "./" + d
	}

	return c, nil
}

func (c Config) Merge(other *Config) Config {
	if other == nil {
		return c
	}

	c.Path = c.mergePath(c.Path, other.Path)
	c.Target.Path = c.mergePath(c.Target.Path, other.Target.Path)
	if other.Target.Suffix != "" {
		c.Target.Suffix = other.Target.Suffix
	}

	return c
}

func (Config) mergePath(a, b string) string {
	if strings.HasPrefix(b, ".") {
		a = filepath.Join(a, b)
		if a == ".." {
			a = ""
		}

		return a
	}
	return b
}

func (c Config) Build(app App) (iter.Seq2[[]Item, error], error) {
	tmpl := template.New("")
	tmpl = tmpl.Funcs(templateFuncs)
	tmpl, err := tmpl.Parse(app.Path)
	if err != nil {
		return nil, fmt.Errorf("parse app path template: %w", err)
	}

	return func(yield func([]Item, error) bool) {
		if len(app.Versions) == 0 {
			return
		}

		v := Item{
			Path: c.Path,
			Name: app.Name,
		}
		for _, version := range app.Versions {
			v.Version = version
			ps := app.Platforms.Expand()
			if len(ps) == 0 {
				return
			}

			targets := slices.Sorted(maps.Keys(ps))
			buff := &strings.Builder{}
			for _, target := range targets {
				requests := ps[target]
				buff.Reset()

				v.Platform = target
				if err := tmpl.Execute(buff, v); err != nil {
					if !yield(nil, fmt.Errorf("execute app path template: %w", err)) {
						return
					}
				}
				v.Target = c.Target.Path + c.Target.Suffix + buff.String()

				vs := make([]Item, 0, len(requests))
				for _, request := range requests {
					v.Origin = c.Path + "/" + app.Name + "@" + version + "/" + string(request.Os()) + "/" + string(request.Arch())
					vs = append(vs, v)
				}

				if !yield(vs, nil) {
					return
				}
			}
		}
	}, nil
}

type TargetConfig struct {
	Path   string
	Suffix string
}
