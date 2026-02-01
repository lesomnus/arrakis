package arks

import (
	"maps"
	"path"
	"strings"
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

	p := c.Path
	if strings.HasPrefix(other.Path, "./") {
		p = path.Join(p, other.Path)
	}

	c_ := c.Clone()
	if other.Path != "" {
		c_.Path = other.Path
	}
	if other.Target.Path != "" {
		c_.Target.Path = other.Target.Path
	}
	if other.Target.Suffix != "" {
		c_.Target.Suffix = other.Target.Suffix
	}
	maps.Copy(c_.Resolvers, other.Resolvers)
	maps.Copy(c_.Platforms, other.Platforms)

	return c_
}

type TargetConfig struct {
	Path   string
	Suffix string
}
