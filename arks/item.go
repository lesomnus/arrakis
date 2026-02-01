package arks

import (
	"errors"
	"strings"
)

type Item struct {
	Path    string
	Name    string
	Version string
	Platform

	Origin string
	Target string
}

func ParseItem(s string) (Item, error) {
	// Expected format:
	// /github.com/lesomnus/arrakis/arrk@v0.0.1/linux/arm/v6
	i := strings.LastIndex(s, "@")
	if i < 0 {
		return Item{}, errors.New("missing '@' separator")
	}

	p := s[:i]   // /github.com/lesomnus/arrakis/arrk
	v := s[i+1:] // v0.0.1/linux/arm/v6

	i = strings.LastIndex(p, "/")
	if i < 1 {
		return Item{}, errors.New("no name found")
	}

	path := p[:i]   // /github.com/lesomnus/arrakis
	name := p[i+1:] // arrk

	version, platform_, ok := strings.Cut(v, "/")
	if !ok {
		return Item{}, errors.New("no platform found")
	}

	platform := Platform(platform_)
	if os, arch, _ := platform.Split(); os == "" || arch == "" {
		return Item{}, errors.New("invalid platform")
	}

	return Item{
		Path:     path,
		Name:     name,
		Version:  version,
		Platform: platform,
	}, nil
}

func (i Item) Os() string {
	return string(i.Platform.Os())
}

func (i Item) Arch() string {
	return string(i.Platform.Arch())
}

func (i Item) Variant() string {
	return string(i.Platform.Variant())
}
