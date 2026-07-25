package arks_test

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/lesomnus/arrakis/arks"
	"github.com/stretchr/testify/require"
)

type fakeDoer func(*http.Request) (*http.Response, error)

func (f fakeDoer) Do(r *http.Request) (*http.Response, error) { return f(r) }

func respond(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     http.StatusText(status),
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     http.Header{},
	}
}

func TestDiscoverGitHub(t *testing.T) {
	body := `[
		{"tag_name": "v2.89.0", "draft": false, "prerelease": false},
		{"tag_name": "v2.88.1", "draft": false, "prerelease": false},
		{"tag_name": "v2.90.0-rc1", "draft": false, "prerelease": true},
		{"tag_name": "v2.99.0", "draft": true, "prerelease": false},
		{"tag_name": "v2.87.3", "draft": false, "prerelease": false}
	]`

	var gotURL string
	d := fakeDoer(func(r *http.Request) (*http.Response, error) {
		gotURL = r.URL.String()
		require.Equal(t, "application/vnd.github+json", r.Header.Get("Accept"))
		return respond(http.StatusOK, body), nil
	})

	s := arks.Source{Kind: arks.SourceKindGitHub, Repo: "cli/cli"}
	got, err := s.Discover(context.Background(), d)
	require.NoError(t, err)

	// v-prefix stripped, sorted ascending, draft and prerelease dropped.
	require.Equal(t, []string{"2.87.3", "2.88.1", "2.89.0"}, got)
	require.Contains(t, gotURL, "repos/cli/cli/releases")
}

func TestDiscoverGitHubKeepsPrerelease(t *testing.T) {
	body := `[
		{"tag_name": "v2.89.0", "prerelease": false},
		{"tag_name": "v2.90.0-rc1", "prerelease": true}
	]`
	d := fakeDoer(func(r *http.Request) (*http.Response, error) {
		return respond(http.StatusOK, body), nil
	})

	s := arks.Source{Kind: arks.SourceKindGitHub, Repo: "cli/cli", Prerelease: true}
	got, err := s.Discover(context.Background(), d)
	require.NoError(t, err)
	require.Equal(t, []string{"2.89.0", "2.90.0-rc1"}, got)
}

func TestDiscoverHTTP(t *testing.T) {
	// A JSON-ish body; extraction is by regex over the whole body.
	body := `[{"version":"go1.26.3"},{"version":"go1.26.1"},{"version":"go1.25.5"}]`
	d := fakeDoer(func(r *http.Request) (*http.Response, error) {
		require.Equal(t, "https://example.test/dl", r.URL.String())
		return respond(http.StatusOK, body), nil
	})

	s := arks.Source{
		Kind:  arks.SourceKindHTTP,
		Url:   "https://example.test/dl",
		Match: `go(\d+\.\d+(?:\.\d+)?)`,
	}
	got, err := s.Discover(context.Background(), d)
	require.NoError(t, err)
	require.Equal(t, []string{"1.25.5", "1.26.1", "1.26.3"}, got)
}

func TestDiscoverHTTPRequiresMatch(t *testing.T) {
	s := arks.Source{Kind: arks.SourceKindHTTP, Url: "https://example.test/dl"}
	_, err := s.Discover(context.Background(), fakeDoer(func(r *http.Request) (*http.Response, error) {
		return respond(http.StatusOK, ""), nil
	}))
	require.Error(t, err)
}

func TestDiscoverBadStatus(t *testing.T) {
	d := fakeDoer(func(r *http.Request) (*http.Response, error) {
		return respond(http.StatusForbidden, "rate limited"), nil
	})
	s := arks.Source{Kind: arks.SourceKindGitHub, Repo: "cli/cli"}
	_, err := s.Discover(context.Background(), d)
	require.Error(t, err)
}
