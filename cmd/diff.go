package cmd

import (
	"context"

	"github.com/lesomnus/xli"
	"github.com/lesomnus/xli/flg"
)

func NewCmdDiff() *xli.Command {
	default_port := _default_port
	default_renderer := "tree"
	return &xli.Command{
		Name:  "diff",
		Brief: "Render differences with the snapshot",

		Flags: flg.Flags{
			&flg.String{Name: "port", Value: &default_port, Brief: "Path to the port directory"},
			&flg.String{Name: "kind", Value: &default_renderer, Brief: "Output kind (tree, cfkv)"},
		},

		Handler: xli.OnRun(func(ctx context.Context, cmd *xli.Command, next xli.Next) error {
			t := true
			cmd.Flags = append(cmd.Flags, &flg.Switch{Name: "diff", Value: &t})
			return NewCmdRender().Handler.Handle(ctx, cmd, next)
		}),
	}
}
