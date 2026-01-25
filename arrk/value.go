package arrk

type Value struct {
	Version string

	Os   string
	Arch string
}

type Item struct {
	Origin string
	Target string

	Name     string
	Version  string
	Platform Platform
}
