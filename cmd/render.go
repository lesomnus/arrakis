package cmd

import (
	"context"
	"fmt"
	"io/fs"
	"os"

	"github.com/lesomnus/arrakis/arks"
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

			port := os.DirFS(port_path).(fs.ReadDirFS)
			walker := arks.FsWalker{Fs: port}

			c := arks.NewConfig()
			defer r.Flush()
			return walker.Walk(c, ".", func(c arks.Config, p string, app arks.App) error {
				build, err := c.Build(app)
				if err != nil {
					return fmt.Errorf("prepare build for app: %w", err)
				}
				for items, err := range build {
					if err != nil {
						return fmt.Errorf("build app: %w", err)
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
