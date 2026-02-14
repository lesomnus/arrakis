package cmd

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/lesomnus/arrakis/arks"
	"github.com/lesomnus/xli"
	"github.com/lesomnus/xli/flg"
)

func NewCmdRender() *xli.Command {
	default_port := _default_port
	default_renderer := "tree"
	return &xli.Command{
		Name: "render",

		Flags: flg.Flags{
			&flg.String{Name: "port", Value: &default_port, Brief: "Path to the port directory"},
			&flg.String{Name: "kind", Value: &default_renderer, Brief: "Output kind (tree, cfkv)"},
			&flg.Switch{Name: "diff", Brief: "Render only differences with the snapshot"},
		},

		Handler: xli.OnRun(func(ctx context.Context, cmd *xli.Command, next xli.Next) error {
			port_path := flg.MustGet[string](cmd, "port")
			renderer_kind := flg.MustGet[string](cmd, "kind")
			with_diff := flg.MustGet[bool](cmd, "diff")

			rc, ok := arks.Renders[renderer_kind]
			if !ok {
				return fmt.Errorf("unknown renderer kind: %q", renderer_kind)
			}

			r := rc(os.Stdout)
			if info, err := os.Stat(port_path); err != nil {
				return fmt.Errorf("access port path %q: %w", port_path, err)
			} else if !info.IsDir() {
				return fmt.Errorf("port path %q is not a directory", port_path)
			}

			port, err := os.OpenRoot(port_path)
			if err != nil {
				return fmt.Errorf("open port: %w", err)
			}

			c := arks.NewConfig()
			defer r.Flush()
			return arks.FsWalker{Fs: port.FS().(fs.ReadDirFS)}.Walk(c, ".", func(c arks.Config, p string, app arks.App) error {
				snapshot := Snapshot{}
				if with_diff {
					if f, err := port.Open(filepath.Join(p, "snapshot")); err != nil {
						if !os.IsNotExist(err) {
							return fmt.Errorf("open snapshot: %w", err)
						}
					} else {
						defer f.Close()
						v, err := ReadSnapshot(f)
						if err != nil {
							return fmt.Errorf("read snapshot: %w", err)
						}

						snapshot = v
					}
				}

				build, err := c.Build(app)
				if err != nil {
					return fmt.Errorf("prepare build for app: %w", err)
				}
				for items, err := range build {
					if err != nil {
						return fmt.Errorf("build app: %w", err)
					}
					if len(items) == 0 {
						continue
					}
					if _, ok := snapshot[items[0].Target]; ok {
						continue
					}

					for _, item := range items {
						r.Render(c, item)
					}
				}
				return nil
			})
		}),
	}
}
