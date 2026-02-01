package arks

import (
	"errors"
	"net/http"
	"os"
)

type ServerConfig struct {
	Querier
}

func (c *ServerConfig) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	item, err := ParseItem(r.URL.Path)
	if err != nil {
		http.NotFound(w, r)
		return
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
