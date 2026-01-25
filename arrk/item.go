package arrk

type Item struct {
	Path    string
	Name    string
	Version string
	Platform

	Origin string
	Target string
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
