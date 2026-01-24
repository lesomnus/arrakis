package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"maps"
	"os"
	"path"
	"path/filepath"
	"strings"
	"text/template"

	"github.com/lesomnus/arrakis/arrk"
	"go.yaml.in/yaml/v4"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: arrakis <directory-path>")
		os.Exit(1)
	}

	root := os.Args[1]

	info, err := os.Stat(root)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}
	if !info.IsDir() {
		fmt.Printf("Error: %s is not a directory\n", root)
		os.Exit(1)
	}

	ctx := context.Background()
	conf := arrk.NewConfig()

	walk(ctx, conf, root, func(c arrk.Config, v arrk.Item) error {
		fmt.Printf("Origin: %s -> Target: %s\n", v.Origin, v.Target)
		return nil
	})
}

type handlerFunc func(c arrk.Config, v arrk.Item) error

func walk(ctx context.Context, c arrk.Config, p string, h handlerFunc) error {
	c, err := readConfig(ctx, c, filepath.Join(p, "config.yaml"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := visit(ctx, c, p, h); err != nil {
		return err
	}

	ds, err := os.ReadDir(p)
	if err != nil {
		return err
	}

	for _, d := range ds {
		if !d.IsDir() {
			continue
		}

		c_ := c.Clone()
		c_.Path = path.Join(c_.Path, d.Name())
		c_.Target.Path = path.Join(c.Target.Path, d.Name())

		p_next := filepath.Join(p, d.Name())
		if len(c.Resolvers) == 0 {
			if err := walk(ctx, c_, p_next, h); err != nil {
				fmt.Printf("err: %v\n", err)
			}
			continue
		}
	}

	return nil
}

var teplateFuncs = template.FuncMap{
	"prefix": func(p string, v string) string {
		if v == "" {
			return ""
		}

		return p + v
	},
}

func visit(ctx context.Context, c arrk.Config, p string, h handlerFunc) error {
	if len(c.Resolvers) == 0 {
		return nil
	}

	versions, err := readVersions(ctx, c, filepath.Join(p, "versions"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	for _, resolver := range c.Resolvers {
		tmpl := template.New("")
		tmpl = tmpl.Funcs(teplateFuncs)
		tmpl, err := tmpl.Parse(resolver.Path)
		if err != nil {
			return err
		}

		platforms := maps.Clone(c.Platforms)
		maps.Copy(platforms, resolver.Platforms)

		expanded := map[arrk.Platform]arrk.Platform{}
		for source, target := range platforms {
			for p := range expandPlatform(source) {
				expanded[p] = target
			}
		}

		buff := &strings.Builder{}
		for _, version := range versions {
			for source, target := range expanded {
				value := arrk.Value{
					Version: version,
					Os:      target.Os(),
					Arch:    target.Arch(),
				}
				if err := tmpl.Execute(buff, value); err != nil {
					return err
				}

				target := c.Target.Path
				if c.Target.Suffix != "" {
					target = path.Join(target, c.Target.Suffix)
				}
				target = path.Join(target, buff.String())
				buff.Reset()

				if err := h(c, arrk.Item{
					Origin: c.Path + "/" + version + "/" + source.Os() + "/" + source.Arch(),
					Target: target,
				}); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

func readConfig(ctx context.Context, c arrk.Config, p string) (arrk.Config, error) {
	c_ := c.Clone()
	f, err := os.Open(p)
	if err != nil {
		return c, fmt.Errorf("open config file %s: %w", p, err)
	}
	defer f.Close()

	if err := yaml.NewDecoder(f).Decode(&c); err != nil {
		return c, fmt.Errorf("decode config: %w", err)
	}

	return c_.Merge(&c), nil
}

func readVersions(ctx context.Context, c arrk.Config, p string) ([]string, error) {
	vf, err := os.Open(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []string{}, nil
		} else {
			return nil, err
		}
	}
	defer vf.Close()

	vs := []string{}
	scanner := bufio.NewScanner(vf)
	for scanner.Scan() {
		v := scanner.Text()
		v = strings.TrimSpace(v)
		vs = append(vs, v)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read versions file: %w", err)
	}

	return vs, nil
}
