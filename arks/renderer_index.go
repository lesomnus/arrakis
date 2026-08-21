package arks

import (
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"strings"
)

// IndexSchema is the version of the index document format.
// Bump it on any breaking change to the shape emitted by [IndexRenderer].
const IndexSchema = 1

// IndexDoc is the root of the generated index document.
type IndexDoc struct {
	Schema int         `json:"schema"`
	Ports  []IndexPort `json:"ports"`
}

// IndexPort is a single registered port, aggregated over every item it expands to.
type IndexPort struct {
	// Id is "<path>/<name>", the stable identity of the port.
	Id   string `json:"id"`
	Path string `json:"path"`
	Name string `json:"name"`
	// Target is the prefix every download URL of this port is built from.
	// It is included because the upstream repository is often not derivable
	// from Id, e.g. "protoc" lives in "protocolbuffers/protobuf".
	Target string `json:"target"`
	// Latest is the version value that the "latest" alias resolves to, if any.
	Latest    string          `json:"latest,omitempty"`
	Versions  []IndexVersion  `json:"versions"`
	Platforms []IndexPlatform `json:"platforms"`
	// Haystack is a pre-lowercased, pre-joined search string.
	// Clients match against this instead of rebuilding it per keystroke.
	Haystack string `json:"haystack"`
}

type IndexVersion struct {
	V       string   `json:"v"`
	Aliases []string `json:"aliases,omitempty"`
}

// IndexPlatform groups every spelling that resolves to one canonical platform.
type IndexPlatform struct {
	Os   string `json:"os"`
	Arch string `json:"arch"`
	// Accepts lists the exact arch spellings that resolve, in URL form.
	// This is ground truth: a spelling absent here does not resolve.
	Accepts []string `json:"accepts"`
}

type indexPortBuilder struct {
	port IndexPort

	versionOrder []string
	versions     map[string]*IndexVersion
	// canonical "os/arch" -> accepted arch spellings, in first-seen order.
	platformOrder []string
	platforms     map[string][]string
}

type IndexRenderer struct {
	w io.Writer

	order []string
	ports map[string]*indexPortBuilder
}

func NewIndexRenderer(w io.Writer) *IndexRenderer {
	return &IndexRenderer{w: w, ports: map[string]*indexPortBuilder{}}
}

func (p *IndexRenderer) Render(c Config, v Item) error {
	id := strings.TrimPrefix(v.Path+"/"+v.Name, "/")

	b, ok := p.ports[id]
	if !ok {
		b = &indexPortBuilder{
			port: IndexPort{
				Id:     id,
				Path:   v.Path,
				Name:   v.Name,
				Target: c.Target.Path + c.Target.Suffix,
			},
			versions:  map[string]*IndexVersion{},
			platforms: map[string][]string{},
		}
		p.ports[id] = b
		p.order = append(p.order, id)
	}

	value := v.Version.Value()
	if _, ok := b.versions[value]; !ok {
		b.versions[value] = &IndexVersion{V: value, Aliases: slices.Collect(v.Version.Aliases())}
		b.versionOrder = append(b.versionOrder, value)
		if slices.Contains(b.versions[value].Aliases, "latest") {
			b.port.Latest = value
		}
	}

	os, arch, ok := splitOriginPlatform(v.Origin)
	if !ok {
		return fmt.Errorf("origin %q has no platform", v.Origin)
	}

	key := string(Platform(strings.ToLower(os) + "/" + strings.ToLower(arch)).Normalized())
	accepts, ok := b.platforms[key]
	if !ok {
		b.platformOrder = append(b.platformOrder, key)
	}
	if !slices.Contains(accepts, arch) {
		b.platforms[key] = append(accepts, arch)
	}

	return nil
}

// splitOriginPlatform pulls "<os>" and "<arch>" out of an origin such as
// "github.com/gh@2.97.0/linux/amd64". It reads from the last "@" so that a
// path or name containing "/" does not confuse it.
func splitOriginPlatform(origin string) (os string, arch string, ok bool) {
	i := strings.LastIndex(origin, "@")
	if i < 0 {
		return "", "", false
	}

	rest := origin[i+1:] // 2.97.0/linux/amd64
	_, platform, ok := strings.Cut(rest, "/")
	if !ok {
		return "", "", false
	}

	os, arch, ok = strings.Cut(platform, "/")
	if !ok || os == "" || arch == "" {
		return "", "", false
	}

	return os, arch, true
}

func (p *IndexRenderer) Flush() error {
	doc := IndexDoc{Schema: IndexSchema, Ports: make([]IndexPort, 0, len(p.order))}

	ids := slices.Clone(p.order)
	slices.Sort(ids)
	for _, id := range ids {
		b := p.ports[id]
		port := b.port

		// Newest first; the versions file is authored oldest first.
		port.Versions = make([]IndexVersion, 0, len(b.versionOrder))
		for i := len(b.versionOrder) - 1; i >= 0; i-- {
			port.Versions = append(port.Versions, *b.versions[b.versionOrder[i]])
		}

		port.Platforms = make([]IndexPlatform, 0, len(b.platformOrder))
		keys := slices.Clone(b.platformOrder)
		slices.Sort(keys)
		for _, key := range keys {
			os, arch, _ := strings.Cut(key, "/")
			accepts := slices.Clone(b.platforms[key])
			slices.Sort(accepts)
			port.Platforms = append(port.Platforms, IndexPlatform{Os: os, Arch: arch, Accepts: accepts})
		}

		port.Haystack = buildHaystack(port)
		doc.Ports = append(doc.Ports, port)
	}

	e := json.NewEncoder(p.w)
	e.SetIndent("", "  ")
	return e.Encode(doc)
}

// buildHaystack denormalizes everything a user might type into one lowercase
// string. Splitting on "/" and "-" lets a query match any single segment.
func buildHaystack(port IndexPort) string {
	seen := map[string]bool{}
	out := []string{}

	add := func(s string) {
		s = strings.ToLower(strings.Trim(s, "/"))
		if s == "" || seen[s] {
			return
		}
		seen[s] = true
		out = append(out, s)
	}

	add(port.Id)
	add(port.Name)
	add(strings.Trim(port.Target, "/"))
	for _, s := range strings.FieldsFunc(port.Id+"/"+port.Target, func(r rune) bool {
		return r == '/' || r == '-'
	}) {
		add(s)
	}

	return strings.Join(out, " ")
}
