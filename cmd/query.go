package cmd

import (
	"context"
	"os"

	"github.com/lesomnus/arrakis/arrk"
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
			item := arrk.Item{
				Path:     "github.com/protocolbuffers/protobuf",
				Name:     "protoc",
				Version:  "1.0.0",
				Platform: arrk.Platform("linux/arm64/"),
			}

			q := arrk.FsQuerier{FS: port}
			target, err := q.Query(ctx, item)
			if err != nil {
				return err
			}

			cmd.Println(target)

			return next(ctx)
		}),
	}
}
