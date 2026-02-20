package arks

import (
	"iter"
	"strings"
)

// Version represents a version of an app.
// It can contain multiple versions separated by spaces, where the first one is the actual version and the rest are aliases.
// It can have multiple spaces between versions and leading and trailing spaces are ignored.
//
// E.g.
//
//	"1.2.3"
//	"1.2.3 1.2 1 latest"
type Version string

func (v Version) String() string {
	return v.Value()
}

func (v Version) Value() string {
	s := strings.TrimSpace(string(v))
	i := strings.Index(s, " ")
	if i < 0 {
		return s
	}

	return s[:i]
}

func (v Version) Values() iter.Seq[string] {
	return strings.FieldsSeq(string(v))
}

func (v Version) Aliases() iter.Seq[string] {
	s := strings.TrimSpace(string(v))
	i := strings.Index(s, " ")
	if i < 0 {
		return func(yield func(string) bool) {}
	}

	return strings.FieldsSeq(s[i+1:])
}
