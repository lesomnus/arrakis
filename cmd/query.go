package cmd

import (
	"context"
	"os"

	"github.com/lesomnus/arrakis/arks"
	"github.com/lesomnus/xli"
)

func NewCmdQuery() *xli.Command {
	return &xli.Command{
		Name: "query",

		// Args: arg.Args{
		// 	&arg.String{Name: "PATH"},
		// 	&arg.String{Name: "NAME"},
		// },

		Handler: xli.OnRun(func(ctx context.Context, cmd *xli.Command, next xli.Next) error {
			port := os.DirFS("./port")
			item := arks.Item{
				Path:     "github.com/protocolbuffers/protobuf/protoc",
				Version:  "33.4",
				Platform: arks.Platform("linux/arm64/"),
			}

			q := arks.FsQuerier{FS: port}
			target, err := q.Query(ctx, item)
			if err != nil {
				return err
			}

			cmd.Println(target)

			return next(ctx)
		}),
	}
}
