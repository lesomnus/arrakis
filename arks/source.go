package arks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"go.yaml.in/yaml/v4"
	"golang.org/x/mod/semver"
)

// SourceKind identifies how new versions are discovered for a port.
type SourceKind string

const (
	// SourceKindGitHub discovers versions from GitHub releases.
	SourceKindGitHub SourceKind = "github"
	// SourceKindHTTP discovers versions by extracting them from an HTTP response body.
	SourceKindHTTP SourceKind = "http"
)

// Source describes how to discover new versions for a port.
// It lives in a "source.yaml" file next to the "versions" file.
type Source struct {
	Kind SourceKind

	// Match is a regular expression applied to the raw candidates.
	// If it has a capture group, the first group is used as the version;
	// otherwise the whole match is used. All matches in each candidate are collected,
	// so a single HTTP body can yield many versions.
	// It defaults to `^v?(.+)$` which is suitable for GitHub tags.
	Match string

	// Repo is the "owner/name" of the GitHub repository. Used by SourceKindGitHub.
	Repo string

	// Url is the endpoint to fetch. Used by SourceKindHTTP.
	Url string

	// Prerelease keeps prerelease versions (e.g. "1.2.3-rc1") when true.
	Prerelease bool

	// Limit considers only the newest N discovered versions when looking for new
	// ones to add. Existing versions are never removed. Zero means consider all.
	Limit int

	// Alias controls how alias tags (series, latest) are generated.
	Alias *AliasPolicy
}

// AliasPolicy controls alias tag generation. Nil fields default to true.
type AliasPolicy struct {
	// Series emits the "series" alias (the version with its last dot-segment removed)
	// for the newest version of each series, e.g. "2.89" for "2.89.0".
	Series *bool
	// Latest emits the "latest" alias for the newest version overall.
	Latest *bool
}

func (p *AliasPolicy) series() bool {
	if p == nil || p.Series == nil {
		return true
	}
	return *p.Series
}

func (p *AliasPolicy) latest() bool {
	if p == nil || p.Latest == nil {
		return true
	}
	return *p.Latest
}

// ReadSourceFromFs reads "source.yaml" from the given directory.
// It returns (nil, nil) if the file does not exist.
func ReadSourceFromFs(fsys fs.FS, dir string) (*Source, error) {
	f, err := fsys.Open(filepath.Join(dir, "source.yaml"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()

	var s Source
	if err := yaml.NewDecoder(f).Decode(&s); err != nil {
		return nil, fmt.Errorf("decode source: %w", err)
	}
	if s.Kind == "" {
		return nil, errors.New("source kind is required")
	}

	return &s, nil
}

// Doer is the subset of *http.Client used to fetch candidates.
type Doer interface {
	Do(req *http.Request) (*http.Response, error)
}

// Discover fetches candidates from the source and returns cleaned, semver-sorted
// (ascending), deduplicated version values. Prerelease versions are dropped unless
// Prerelease is set. If d is nil, http.DefaultClient is used.
func (s Source) Discover(ctx context.Context, d Doer) ([]string, error) {
	if d == nil {
		d = http.DefaultClient
	}

	var (
		raws []string
		err  error
	)
	switch s.Kind {
	case SourceKindGitHub:
		raws, err = s.fetchGitHub(ctx, d)
	case SourceKindHTTP:
		raws, err = s.fetchHTTP(ctx, d)
	default:
		return nil, fmt.Errorf("unknown source kind: %q", s.Kind)
	}
	if err != nil {
		return nil, err
	}

	return s.refine(raws)
}

func (s Source) refine(raws []string) ([]string, error) {
	pat := s.Match
	if pat == "" {
		pat = `^v?(.+)$`
	}
	re, err := regexp.Compile(pat)
	if err != nil {
		return nil, fmt.Errorf("compile match %q: %w", pat, err)
	}

	seen := map[string]bool{}
	out := []string{}
	for _, raw := range raws {
		for _, m := range re.FindAllStringSubmatch(raw, -1) {
			v := m[0]
			if len(m) > 1 {
				v = m[1]
			}
			v = strings.TrimSpace(v)
			if v == "" || seen[v] {
				continue
			}

			key := semverKey(v)
			if !semver.IsValid(key) {
				continue
			}
			if !s.Prerelease && semver.Prerelease(key) != "" {
				continue
			}

			seen[v] = true
			out = append(out, v)
		}
	}

	slices.SortFunc(out, func(a, b string) int {
		return semver.Compare(semverKey(a), semverKey(b))
	})

	return out, nil
}

func (s Source) fetchGitHub(ctx context.Context, d Doer) ([]string, error) {
	if s.Repo == "" {
		return nil, errors.New("github source requires repo")
	}

	u := fmt.Sprintf("https://api.github.com/repos/%s/releases?per_page=100", s.Repo)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if t := os.Getenv("GITHUB_TOKEN"); t != "" {
		req.Header.Set("Authorization", "Bearer "+t)
	}

	res, err := d.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github: unexpected status %s", res.Status)
	}

	var rels []struct {
		TagName    string `json:"tag_name"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
	}
	if err := json.NewDecoder(res.Body).Decode(&rels); err != nil {
		return nil, fmt.Errorf("github: decode releases: %w", err)
	}

	out := make([]string, 0, len(rels))
	for _, r := range rels {
		if r.Draft {
			continue
		}
		if r.Prerelease && !s.Prerelease {
			continue
		}
		out = append(out, r.TagName)
	}
	return out, nil
}

func (s Source) fetchHTTP(ctx context.Context, d Doer) ([]string, error) {
	if s.Url == "" {
		return nil, errors.New("http source requires url")
	}
	if s.Match == "" {
		return nil, errors.New("http source requires match")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.Url, nil)
	if err != nil {
		return nil, err
	}

	res, err := d.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("http: unexpected status %s", res.Status)
	}

	body, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, fmt.Errorf("http: read body: %w", err)
	}

	return []string{string(body)}, nil
}

// semverKey normalizes a version string into a valid semver query string
// by ensuring a single leading "v".
func semverKey(s string) string {
	if s == "" {
		return ""
	}
	if s[0] == 'v' || s[0] == 'V' {
		return "v" + s[1:]
	}
	return "v" + s
}
