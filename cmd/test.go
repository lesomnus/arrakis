package cmd

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io/fs"
	"os"

	"github.com/lesomnus/arrakis/arks"
	"github.com/lesomnus/xli"
	"github.com/lesomnus/xli/flg"
)

func NewCmdTest() *xli.Command {
	default_port := _default_port
	return &xli.Command{
		Name:  "test",
		Brief: "Test if there are conflicts",

		Flags: flg.Flags{
			&flg.String{Name: "port", Value: &default_port, Brief: "Path to the port directory"},
		},

		Handler: xli.OnRun(func(ctx context.Context, cmd *xli.Command, next xli.Next) error {
			port_path := flg.MustGet[string](cmd, "port")

			port, err := os.OpenRoot(port_path)
			if err != nil {
				return fmt.Errorf("open port: %w", err)
			}

			vs := map[[sha256.Size]byte]string{}
			cnt := 0

			c := arks.NewConfig()
			err = arks.FsWalker{Fs: port.FS().(fs.ReadDirFS)}.Walk(c, ".", func(c arks.Config, p string, app arks.App) error {
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

					for _, item := range items {
						v := sha256.Sum256([]byte(item.Origin))
						if first, ok := vs[v]; ok {
							cmd.Println(item.Origin)
							cmd.Printf("\t%s\n\t%s\n", p, first)
							cnt++
							continue
						}

						vs[v] = p
					}
				}

				return nil
			})
			if err != nil {
				return fmt.Errorf("walk port: %w", err)
			}
			if cnt > 0 {
				return fmt.Errorf("%d conflicts found", cnt)
			}
			return next(ctx)
		}),
	}
}
