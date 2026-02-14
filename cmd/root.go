package cmd

import (
	"context"

	"github.com/lesomnus/xli"
	"github.com/lesomnus/xli/flg"
)

func NewCmdRoot() *xli.Command {
	return &xli.Command{
		Name: "arrkis",

		Flags: flg.Flags{
			&flg.String{Name: "port"},
		},

		Commands: xli.Commands{
			NewCmdRender(),
			NewCmdQuery(),
			NewCmdCommit(),
			NewCmdDiff(),
		},
		Handler: xli.Chain(
			xli.RequireSubcommand(),
			xli.OnRunPass(func(ctx context.Context, cmd *xli.Command, next xli.Next) error {
				return next(ctx)
			}),
		),
	}
}
