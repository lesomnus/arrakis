package arks

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

type FsWalker struct {
	Fs fs.ReadDirFS
}

type FsWalkFunc func(c Config, p string, app App) error

type walkErr struct {
	error
}

func (w FsWalker) Step(c Config, p string, f FsWalkFunc) (Config, error) {
	if f == nil {
		f = func(c Config, p string, app App) error { return nil }
	}

	c_, err := ReadConfigFile(w.Fs, filepath.Join(p, "config.yaml"))
	if err != nil {
		return Config{}, fmt.Errorf("read config: %w", err)
	}

	c = c.Merge(&c_)

	if app, err := ReadAppFromFs(w.Fs, p); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return Config{}, fmt.Errorf("read app: %w", err)
		}
	} else {
		c_ := c
		if app.Name == filepath.Base(p) {
			c_.Path = filepath.Dir(p)
		}

		if err := f(c_, p, app); err != nil {
			return Config{}, fmt.Errorf("visit app: %w", err)
		}
	}

	return c, nil
}

func (w FsWalker) Walk(c Config, p string, f FsWalkFunc) error {
	c, err := w.Step(c, p, f)
	if err != nil {
		return walkErr{fmt.Errorf("%s: %w", p, err)}
	}

	ds, err := w.Fs.ReadDir(p)
	if err != nil {
		return fmt.Errorf("read dir: %w", err)
	}

	for _, d := range ds {
		if !d.IsDir() {
			continue
		}

		if err := w.Walk(c, filepath.Join(p, d.Name()), f); err != nil {
			if _, ok := err.(walkErr); ok {
				return err
			}

			return walkErr{fmt.Errorf("%s: %w", p, err)}
		}
	}

	return nil
}
