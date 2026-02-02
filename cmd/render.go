package cmd

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"iter"
	"maps"
	"os"
	"path/filepath"
	"strings"

	"github.com/lesomnus/arrakis/arks"
	"github.com/lesomnus/arrakis/render"
	"github.com/lesomnus/xli"
	"github.com/lesomnus/xli/flg"
)

func NewCmdRender() *xli.Command {
	default_port := "./port"
	default_renderer := "tree"
	return &xli.Command{
		Name: "render",

		Flags: flg.Flags{
			&flg.String{Name: "port", Value: &default_port, Brief: "Path to the port directory"},
			&flg.String{Name: "kind", Value: &default_renderer, Brief: "Output kind (tree, cfkv)"},
		},

		Handler: xli.OnRun(func(ctx context.Context, cmd *xli.Command, next xli.Next) error {
			port_path := flg.MustGet[string](cmd, "port")
			renderer_kind := flg.MustGet[string](cmd, "kind")

			var r render.Renderer
			switch renderer_kind {
			case "tree":
				r = render.NewTreePrinter(os.Stdout)
			case "cfkv":
				r = render.NewCloudFlareKvRenderer(os.Stdout)
			default:
				return fmt.Errorf("unknown renderer kind: %q", renderer_kind)
			}

			if info, err := os.Stat(port_path); err != nil {
				return fmt.Errorf("access port path %q: %w", port_path, err)
			} else if !info.IsDir() {
				return fmt.Errorf("port path %q is not a directory", port_path)
			}

			port := os.DirFS(port_path).(fs.ReadDirFS)
			walker := fsWalker{fs: port}

			c := arks.NewConfig()
			defer r.Flush()
			return walker.Walk(c, ".", r)
		}),
	}
}

type fsWalker struct {
	fs fs.ReadDirFS
}

func (w fsWalker) Walk(c arks.Config, p string, r render.Renderer) error {
	c_, err := arks.ReadFromFile(w.fs, filepath.Join(p, "config.yaml"))
	if err != nil {
		return err
	}

	c = c.Merge(&c_)
	if err := w.visit(c, p, r); err != nil {
		return err
	}

	ds, err := w.fs.ReadDir(p)
	if err != nil {
		return err
	}

	for _, d := range ds {
		if !d.IsDir() {
			continue
		}

		if len(c.Resolvers) == 0 {
			if err := w.Walk(c, filepath.Join(p, d.Name()), r); err != nil {
				fmt.Printf("err: %v\n", err)
			}
			continue
		}
	}

	return nil
}

func (w fsWalker) visit(c arks.Config, p string, r render.Renderer) error {
	if len(c.Resolvers) == 0 {
		return nil
	}

	versions, err := w.readVersions(filepath.Join(p, "versions"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	for name, resolver := range c.Resolvers {
		platforms := maps.Clone(c.Platforms)
		if platforms == nil {
			platforms = make(map[arks.Platform]arks.Platform)
		}
		maps.Copy(platforms, resolver.Platforms)

		expanded := map[arks.Platform]arks.Platform{}
		for source, target := range platforms {
			for p := range w.expandPlatform(source) {
				expanded[p] = target
			}
		}

		for _, version := range versions {
			for source, target := range expanded {
				item := arks.Item{
					Path:     c.Path,
					Name:     name,
					Version:  version,
					Platform: target,
				}

				target, err := resolver.Build(item)
				if err != nil {
					return err
				}

				item.Origin = c.Path + "/" + name + "@" + version + "/" + string(source.Os()) + "/" + string(source.Arch())
				item.Target = c.Target.Path + c.Target.Suffix + target

				if err := r.Render(c, item); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

func (w fsWalker) readVersions(p string) ([]string, error) {
	vf, err := w.fs.Open(p)
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

func (w fsWalker) expandPlatform(p arks.Platform) iter.Seq[arks.Platform] {
	os, arch, variant := p.Normalized().Split()
	if os == "" || arch == "" {
		return func(yield func(arks.Platform) bool) {}
	}

	return func(yield func(arks.Platform) bool) {
		oses := []arks.Os{}
		switch os {
		case "_":
			oses = []arks.Os{
				arks.OsLinux,
				arks.OsWindows,
				arks.OsDarwin,
			}
		default:
			oses = []arks.Os{arks.Os(os)}
		}

		archs := []arks.Arch{}
		for _, os := range oses {
			switch os {
			case arks.OsLinux:
				switch arch {
				case "_":
					archs = []arks.Arch{
						"x86",
						"x86_64",
						"aarch32",
						"aarch64",
						"amd64",
						"arm64",
					}

				case "_32":
					archs = []arks.Arch{
						"x86",
						"aarch32",
					}

				case "_64":
					archs = []arks.Arch{
						"x86_64",
						"aarch64",
						"amd64",
						"arm64",
					}

				case "_amd64":
					archs = []arks.Arch{
						"x86_64",
						"amd64",
					}

				case "_arm64":
					archs = []arks.Arch{
						"aarch64",
						"arm64",
					}

				default:
					archs = []arks.Arch{arks.Arch(arch)}
				}

			case arks.OsWindows:
				switch arch {
				case "_":
					archs = []arks.Arch{
						"AMD64",
						"x86",
						"ARM64",
						"ARM",
					}

				case "_32":
					archs = []arks.Arch{
						"x86",
						"ARM",
					}

				case "_64":
					archs = []arks.Arch{
						"AMD64",
						"ARM64",
					}

				case "_amd64":
					archs = []arks.Arch{
						"AMD64",
					}

				case "_arm64":
					archs = []arks.Arch{
						"ARM64",
					}

				default:
					archs = []arks.Arch{arks.Arch(arch)}
				}

			case arks.OsDarwin:
				switch arch {
				case "_":
					archs = []arks.Arch{
						"x86_64",
						"arm64",
					}

				case "_64":
					archs = []arks.Arch{
						"x86_64",
						"arm64",
					}

				case "_amd64":
					archs = []arks.Arch{
						"x86_64",
					}

				case "_arm64":
					archs = []arks.Arch{
						"arm64",
					}

				default:
					archs = []arks.Arch{arks.Arch(arch)}
				}
			}
		}

		for _, arch := range archs {
			if !yield(arks.Platform(string(os) + "/" + string(arch) + "/" + string(variant))) {
				return
			}
		}
	}
}
