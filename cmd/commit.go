package cmd

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/lesomnus/arrakis/arks"
	"github.com/lesomnus/xli"
	"github.com/lesomnus/xli/flg"
)

func NewCmdCommit() *xli.Command {
	default_port := _default_port
	return &xli.Command{
		Name: "commit",

		Flags: flg.Flags{
			&flg.String{Name: "port", Value: &default_port, Brief: "Path to the port directory"},
		},

		Handler: xli.OnRun(func(ctx context.Context, cmd *xli.Command, next xli.Next) error {
			port_path := flg.MustGet[string](cmd, "port")

			c := arks.NewConfig()
			port, err := os.OpenRoot(port_path)
			if err != nil {
				return fmt.Errorf("open port: %w", err)
			}

			return arks.FsWalker{Fs: port.FS().(fs.ReadDirFS)}.Walk(c, ".", func(c arks.Config, p string, app arks.App) error {
				build, err := c.Build(app)
				if err != nil {
					return fmt.Errorf("prepare build for app: %w", err)
				}

				f, err := port.OpenFile(filepath.Join(p, "snapshot"), os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
				if err != nil {
					return fmt.Errorf("open snapshot file for write: %w", err)
				}
				defer f.Close()

				version := ""
				for items, err := range build {
					if err != nil {
						return fmt.Errorf("build app: %w", err)
					}
					if len(items) == 0 {
						continue
					}
					if version != items[0].Version {
						fmt.Fprintf(f, "\n")
						version = items[0].Version
					}

					slices.SortFunc(items, func(a, b arks.Item) int {
						return strings.Compare(a.Origin, b.Origin)
					})

					fmt.Fprintf(f, "%s\n", items[0].Target)
					for _, item := range items {
						fmt.Fprintf(f, "%s\n", item.Origin)
					}
					fmt.Fprintf(f, "\n")
				}

				fmt.Println(p)
				return nil
			})
		}),
	}
}
