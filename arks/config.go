package arks

import (
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"path"
	"path/filepath"
	"strings"

	"go.yaml.in/yaml/v4"
)

type Config struct {
	Path      string
	Target    TargetConfig
	Resolvers map[string]ResolverConfig
	Platforms map[Platform]Platform
}

func NewConfig() Config {
	return Config{
		Resolvers: make(map[string]ResolverConfig),
		Platforms: make(map[Platform]Platform),
	}
}

func ReadFromFile(fs fs.FS, p string) (Config, error) {
	var c Config

	f, err := fs.Open(p)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return c, err
		}
	} else {
		defer f.Close()
		if err := yaml.NewDecoder(f).Decode(&c); err != nil {
			return c, fmt.Errorf("decode config: %w", err)
		}
	}

	d := filepath.Base(filepath.Dir(p))
	if c.Path == "" {
		c.Path = "./" + d
	}
	if c.Target.Path == "" {
		c.Target.Path = "./" + d
	}

	return c, nil
}

func (c Config) Clone() Config {
	c_ := Config{
		Path:      c.Path,
		Target:    c.Target,
		Resolvers: maps.Clone(c.Resolvers),
		Platforms: maps.Clone(c.Platforms),
	}
	if c_.Resolvers == nil {
		c_.Resolvers = make(map[string]ResolverConfig)
	}
	if c_.Platforms == nil {
		c_.Platforms = make(map[Platform]Platform)
	}

	return c_
}

func (c Config) Merge(other *Config) Config {
	if other == nil {
		return c
	}

	c = c.Clone()
	if strings.HasPrefix(other.Path, ".") {
		c.Path = path.Join(c.Path, other.Path)
	} else {
		c.Path = other.Path
	}
	if strings.HasPrefix(other.Target.Path, ".") {
		c.Target.Path = path.Join(c.Target.Path, other.Target.Path)
	} else {
		c.Target.Path = other.Target.Path
	}
	if other.Target.Suffix != "" {
		c.Target.Suffix = other.Target.Suffix
	}
	maps.Copy(c.Resolvers, other.Resolvers)
	maps.Copy(c.Platforms, other.Platforms)

	return c
}

type TargetConfig struct {
	Path   string
	Suffix string
}
