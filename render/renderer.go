package render

import "github.com/lesomnus/arrakis/arrk"

type Renderer interface {
	Render(c arrk.Config, v arrk.Item) error
	Flush() error
}
