package arks

import (
	"bufio"
	"errors"
	"fmt"
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
}

var templateFuncs = template.FuncMap{
	"prefix": func(p string, v string) string {
		if v == "" {
			return ""
		}

		return p + v
	},
}

func ReadAppFromFs(fs fs.FS, p string) (App, error) {
	f, err := fs.Open(filepath.Join(p, "app.yaml"))
	if err != nil {
		return App{}, err
	}
	defer f.Close()

	app := App{}
	if err := yaml.NewDecoder(f).Decode(&app); err != nil {
		return app, fmt.Errorf("decode app: %w", err)
	}
	if app.Name == "" {
		app.Name = filepath.Base(p)
	}

	f, err = fs.Open(filepath.Join(p, "versions"))
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return App{}, fmt.Errorf("open versions file: %w", err)
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

		app.Versions = vs
	}

	return app, nil
}

func (r App) Build(v Item) (string, error) {
	tmpl := template.New("")
	tmpl = tmpl.Funcs(templateFuncs)
	tmpl, err := tmpl.Parse(r.Path)
	if err != nil {
		return "", err
	}

	buff := &strings.Builder{}
	if err := tmpl.Execute(buff, v); err != nil {
		return "", err
	}

	return buff.String(), nil
}
