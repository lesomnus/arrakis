package render

import (
	"fmt"
	"io"

	"github.com/lesomnus/arrakis/arks"
)

type CloudFlareKvRenderer struct {
	w io.Writer
	s string
}

func NewCloudFlareKvRenderer(w io.Writer) *CloudFlareKvRenderer {
	fmt.Fprintf(w, "[\n")
	return &CloudFlareKvRenderer{w, ""}
}

func (p *CloudFlareKvRenderer) Render(c arks.Config, v arks.Item) error {
	_, err := fmt.Fprintf(p.w, "%s{\"key\":%q,\"value\":%q}", p.s, v.Origin, v.Target)
	p.s = ",\n"
	return err
}

func (p *CloudFlareKvRenderer) Flush() error {
	fmt.Fprintf(p.w, "\n]\n")
	return nil
}
