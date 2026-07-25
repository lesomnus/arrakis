package arks

import (
	"bufio"
	"errors"
	"io/fs"
	"os"
	"slices"
	"strings"

	"golang.org/x/mod/semver"
)

// ReadVersionsFile reads a "versions" file into a list of [Version].
// It returns an empty slice if the file does not exist.
// Blank lines and lines starting with '#' are ignored.
func ReadVersionsFile(fsys fs.FS, p string) ([]Version, error) {
	f, err := fsys.Open(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []Version{}, nil
		}
		return nil, err
	}
	defer f.Close()

	vs := []Version{}
	s := bufio.NewScanner(f)
	for s.Scan() {
		l := strings.TrimSpace(s.Text())
		if l == "" || l[0] == '#' {
			continue
		}
		vs = append(vs, Version(l))
	}
	return vs, s.Err()
}

// series returns the alias for a version value with its last dot-segment removed,
// e.g. "2.89.0" -> "2.89", "33.5" -> "33". It returns "" if there is no dot.
func series(value string) string {
	i := strings.LastIndex(value, ".")
	if i < 0 {
		return ""
	}
	return value[:i]
}

// Aliasize builds "versions" file lines from a set of version values.
// Values are deduplicated and sorted ascending by semver. For each series, the
// newest value gets the series alias; the newest value overall gets "latest".
// Alias generation is controlled by policy (nil defaults to both enabled).
func Aliasize(values []string, policy *AliasPolicy) []Version {
	uniq := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		uniq = append(uniq, v)
	}

	slices.SortFunc(uniq, func(a, b string) int {
		return semver.Compare(semverKey(a), semverKey(b))
	})
	if len(uniq) == 0 {
		return []Version{}
	}

	// The newest value of each series (last one wins since uniq is ascending).
	seriesMax := map[string]string{}
	for _, v := range uniq {
		if s := series(v); s != "" {
			seriesMax[s] = v
		}
	}
	globalMax := uniq[len(uniq)-1]

	out := make([]Version, 0, len(uniq))
	for _, v := range uniq {
		parts := []string{v}
		if policy.series() {
			if s := series(v); s != "" && seriesMax[s] == v {
				parts = append(parts, s)
			}
		}
		if policy.latest() && v == globalMax {
			parts = append(parts, "latest")
		}
		out = append(out, Version(strings.Join(parts, " ")))
	}
	return out
}

// FormatVersions serializes version lines into "versions" file content
// with a trailing newline.
func FormatVersions(vs []Version) string {
	b := &strings.Builder{}
	for _, v := range vs {
		b.WriteString(string(v))
		b.WriteByte('\n')
	}
	return b.String()
}
