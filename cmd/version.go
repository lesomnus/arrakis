package cmd

import (
	"context"
	"fmt"
	"strings"

	"github.com/lesomnus/xli"
)

func NewCmdVersion() *xli.Command {
	return &xli.Command{
		Name:  "version",
		Brief: "print the program information",

		Handler: xli.Chain(
			xli.OnRun(func(ctx context.Context, cmd *xli.Command, next xli.Next) error {
				info := Get()

				b := strings.Builder{}
				b.WriteString(fmt.Sprintf("ARKS_VERSION=%s\n", info.Version))
				b.WriteString(fmt.Sprintf("ARKS_BUILD_ID=%s\n", info.BuildId))
				b.WriteString(fmt.Sprintf("ARKS_GIT_REV=%s", info.GitRev))
				if info.GitDirty {
					b.WriteString("-dirty")
				}
				b.WriteString("\n")

				cmd.Print(b.String())
				return nil
			}),
		),
	}
}

type buildInfo struct {
	Version  string
	BuildId  string
	GitRev   string
	GitDirty bool
}

//go:generate bash -c "../../../scripts/gen-version-file.sh > /dev/null"
var _buildInfo = buildInfo{
	Version:  "v0.0.0",
	BuildId:  "local",
	GitRev:   "0000000000000000000000000000000000000000",
	GitDirty: false,
}

func Get() buildInfo {
	return _buildInfo
}
