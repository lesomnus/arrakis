package arks_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/lesomnus/arrakis/arks"
	"github.com/stretchr/testify/require"
)

func renderIndex(t *testing.T, c arks.Config, items ...arks.Item) arks.IndexDoc {
	t.Helper()

	w := &strings.Builder{}
	r := arks.NewIndexRenderer(w)
	for _, item := range items {
		require.NoError(t, r.Render(c, item))
	}
	require.NoError(t, r.Flush())

	var doc arks.IndexDoc
	require.NoError(t, json.Unmarshal([]byte(w.String()), &doc))
	return doc
}

func item(path, name string, version arks.Version, origin string) arks.Item {
	return arks.Item{Path: path, Name: name, Version: version, Origin: origin}
}

func TestIndexRendererAggregatesByPort(t *testing.T) {
	c := arks.Config{Target: arks.TargetConfig{Path: "github.com/cli/cli", Suffix: "/releases/download/"}}
	doc := renderIndex(t, c,
		item("github.com", "gh", "2.96.0 2.96", "github.com/gh@2.96.0/linux/amd64"),
		item("github.com", "gh", "2.96.0 2.96", "github.com/gh@2.96/linux/x86_64"),
		item("github.com", "gh", "2.97.0 2.97 latest", "github.com/gh@2.97.0/linux/amd64"),
		item("github.com", "gh", "2.97.0 2.97 latest", "github.com/gh@latest/windows/AMD64"),
	)

	require.Equal(t, arks.IndexSchema, doc.Schema)
	require.Len(t, doc.Ports, 1)

	p := doc.Ports[0]
	require.Equal(t, "github.com/gh", p.Id)
	require.Equal(t, "gh", p.Name)
	require.Equal(t, "github.com/cli/cli/releases/download/", p.Target)

	// "latest" is resolved to the version value it points at.
	require.Equal(t, "2.97.0", p.Latest)

	// Newest first, regardless of the order items arrive in.
	require.Equal(t, []arks.IndexVersion{
		{V: "2.97.0", Aliases: []string{"2.97", "latest"}},
		{V: "2.96.0", Aliases: []string{"2.96"}},
	}, p.Versions)

	// Every spelling that resolves is grouped under its canonical platform.
	require.Equal(t, []arks.IndexPlatform{
		{Os: "linux", Arch: "amd64", Accepts: []string{"amd64", "x86_64"}},
		{Os: "windows", Arch: "amd64", Accepts: []string{"AMD64"}},
	}, p.Platforms)
}

func TestIndexRendererHaystackCarriesUpstream(t *testing.T) {
	// "protoc" lives in "protocolbuffers/protobuf", which the id does not
	// mention. Searching for "protobuf" must still find it.
	c := arks.Config{Target: arks.TargetConfig{Path: "github.com/protocolbuffers/protobuf", Suffix: "/releases/download/"}}
	doc := renderIndex(t, c,
		item("protocolbuffers/protobuf", "protoc", "35.1 latest", "protocolbuffers/protobuf/protoc@35.1/linux/amd64"),
	)

	require.Len(t, doc.Ports, 1)
	require.Contains(t, doc.Ports[0].Haystack, "protobuf")
	require.Equal(t, strings.ToLower(doc.Ports[0].Haystack), doc.Ports[0].Haystack)
}

func TestIndexRendererSortsPortsById(t *testing.T) {
	c := arks.Config{Target: arks.TargetConfig{Path: "example.com"}}
	doc := renderIndex(t, c,
		item("z.dev", "zed", "1.0", "z.dev/zed@1.0/linux/amd64"),
		item("a.dev", "ash", "1.0", "a.dev/ash@1.0/linux/amd64"),
	)

	require.Equal(t, []string{"a.dev/ash", "z.dev/zed"}, []string{doc.Ports[0].Id, doc.Ports[1].Id})
}

func TestIndexRendererRejectsOriginWithoutPlatform(t *testing.T) {
	r := arks.NewIndexRenderer(&strings.Builder{})
	err := r.Render(arks.Config{}, item("a.dev", "ash", "1.0", "a.dev/ash@1.0"))
	require.ErrorContains(t, err, "no platform")
}
