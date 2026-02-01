package render

import "github.com/lesomnus/arrakis/arks"

type Renderer interface {
	Render(c arks.Config, v arks.Item) error
	Flush() error
}
