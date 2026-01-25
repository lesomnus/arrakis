package arrk

import (
	"errors"
	"net/http"
	"os"
	"strings"
)

type ServerConfig struct {
	Querier
}

func (c *ServerConfig) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Request URL look like:
	// /github.com/lesomnus/arrakis/arrk@v0.0.1/linux/arm/v6
	i := strings.LastIndex(r.URL.Path, "@")
	if i < 0 {
		http.NotFound(w, r)
		return
	}

	p := r.URL.Path[:i]   // /github.com/lesomnus/arrakis/arrk
	v := r.URL.Path[i+1:] // v0.0.1/linux/arm/v6

	i = strings.LastIndex(p, "/")
	if i < 0 {
		http.NotFound(w, r)
		return
	}

	path := p[:i]   // /github.com/lesomnus/arrakis
	name := p[i+1:] // arrk

	version, platform_, ok := strings.Cut(v, "/")
	if !ok {
		http.NotFound(w, r)
		return
	}

	platform := Platform(platform_)
	if os, arch, _ := platform.Split(); os == "" || arch == "" {
		http.NotFound(w, r)
		return
	}

	item := Item{
		Path:     path,
		Name:     name,
		Version:  version,
		Platform: platform,
	}

	target, err := c.Query(r.Context(), item)
	if err == nil {
		http.Redirect(w, r, target, http.StatusPermanentRedirect)
		return
	}
	if errors.Is(err, os.ErrNotExist) {
		http.NotFound(w, r)
		return
	}

	http.Error(w, "internal server error", http.StatusInternalServerError)
}
