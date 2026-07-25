package cmd

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"

	"github.com/lesomnus/arrakis/arks"
	"github.com/lesomnus/xli"
	"github.com/lesomnus/xli/flg"
)

func NewCmdBump() *xli.Command {
	default_port := _default_port
	return &xli.Command{
		Name:  "bump",
		Brief: "Discover new versions from sources and update versions files",

		Flags: flg.Flags{
			&flg.String{Name: "port", Value: &default_port, Brief: "Path to the port directory"},
			&flg.Switch{Name: "dry-run", Brief: "Print changes without writing files"},
		},

		Handler: xli.OnRun(func(ctx context.Context, cmd *xli.Command, next xli.Next) error {
			port_path := flg.MustGet[string](cmd, "port")
			dry_run := false
			flg.VisitP(cmd, "dry-run", &dry_run)

			port, err := os.OpenRoot(port_path)
			if err != nil {
				return fmt.Errorf("open port: %w", err)
			}
			defer port.Close()

			fsys := port.FS().(fs.ReadDirFS)

			// Collect port directories that have a source.yaml.
			dirs := []string{}
			err = fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
				if err != nil {
					return err
				}
				if !d.IsDir() && d.Name() == "source.yaml" {
					dirs = append(dirs, filepath.Dir(p))
				}
				return nil
			})
			if err != nil {
				return fmt.Errorf("walk port: %w", err)
			}
			slices.Sort(dirs)

			updated := 0
			for _, dir := range dirs {
				n, err := bumpDir(ctx, port, fsys, dir, dry_run, cmd)
				if err != nil {
					return fmt.Errorf("%s: %w", dir, err)
				}
				updated += n
			}

			if updated == 0 {
				cmd.Println("No new versions found.")
			}
			return next(ctx)
		}),
	}
}

func bumpDir(ctx context.Context, port *os.Root, fsys fs.FS, dir string, dry_run bool, cmd *xli.Command) (int, error) {
	src, err := arks.ReadSourceFromFs(fsys, dir)
	if err != nil {
		return 0, fmt.Errorf("read source: %w", err)
	}
	if src == nil {
		return 0, nil
	}

	versions_path := filepath.Join(dir, "versions")
	existing, err := arks.ReadVersionsFile(fsys, versions_path)
	if err != nil {
		return 0, fmt.Errorf("read versions: %w", err)
	}

	discovered, err := src.Discover(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("discover: %w", err)
	}
	// Consider only the newest N discovered versions (discovered is ascending).
	if src.Limit > 0 && len(discovered) > src.Limit {
		discovered = discovered[len(discovered)-src.Limit:]
	}

	// Union of existing values and discovered ones. Existing are never removed.
	have := map[string]bool{}
	values := []string{}
	for _, v := range existing {
		val := v.Value()
		if !have[val] {
			have[val] = true
			values = append(values, val)
		}
	}
	added := []string{}
	for _, v := range discovered {
		if !have[v] {
			have[v] = true
			values = append(values, v)
			added = append(added, v)
		}
	}

	if len(added) == 0 {
		return 0, nil
	}

	lines := arks.Aliasize(values, src.Alias)

	cmd.Printf("%s: +%d\n", dir, len(added))
	for _, v := range added {
		cmd.Printf("\t%s\n", v)
	}

	if dry_run {
		return len(added), nil
	}

	content := arks.FormatVersions(lines)
	if err := writeRootFile(port, versions_path, []byte(content)); err != nil {
		return 0, fmt.Errorf("write versions: %w", err)
	}

	return len(added), nil
}

func writeRootFile(port *os.Root, p string, content []byte) error {
	f, err := port.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(content)
	return err
}
