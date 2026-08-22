package arks

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"text/template"

	"go.yaml.in/yaml/v4"
)

type App struct {
	Name string
	Path string

	Platforms PlatformMap
	Versions  []Version

	// Dir is the app's directory, relative to the port root.
	Dir string
	// Source is the discovery config from "source.yaml", nil when there is none.
	Source *Source
}

var templateFuncs = template.FuncMap{
	"prefix": func(p string, v string) string {
		if v == "" {
			return ""
		}

		return p + v
	},
}

func ReadAppFromFs(fs fs.FS, p string) ([]App, error) {
	f, err := fs.Open(filepath.Join(p, "app.yaml"))
	if err != nil {
		return nil, err
	}
	defer f.Close()

	loader, err := yaml.NewLoader(f)
	if err != nil {
		return nil, fmt.Errorf("create yaml loader: %w", err)
	}

	apps := []App{}
	for {
		var app App
		if err := loader.Load(&app); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, fmt.Errorf("decode app: %w", err)
		}
		if app.Name == "" {
			app.Name = filepath.Base(p)
		}
		app.Dir = p

		apps = append(apps, app)
	}

	source, err := ReadSourceFromFs(fs, p)
	if err != nil {
		return nil, fmt.Errorf("read source: %w", err)
	}
	for i := range apps {
		apps[i].Source = source
	}

	f, err = fs.Open(filepath.Join(p, "versions"))
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("open versions file: %w", err)
		}
	} else {
		defer f.Close()
		vs := []Version{}

		s := bufio.NewScanner(f)
		for s.Scan() {
			l := strings.TrimSpace(s.Text())
			if l == "" {
				continue
			}
			if l[0] == '#' {
				continue
			}

			vs = append(vs, Version(l))
		}

		for i := range apps {
			apps[i].Versions = vs
		}
	}

	return apps, nil
}
