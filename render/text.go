package render

import (
	"fmt"
	"io"
	"maps"
	"slices"
	"strings"

	"github.com/lesomnus/arrakis/arrk"
)

type TextPrinter struct {
	io.Writer

	item_last arrk.Item
	// For each target.
	items map[string][]arrk.Item
}

func NewTextPrinter(w io.Writer) *TextPrinter {
	return &TextPrinter{
		Writer: w,
		items:  map[string][]arrk.Item{},
	}
}

func (p *TextPrinter) Render(c arrk.Config, v arrk.Item) error {
	if p.item_last.Version == v.Version {
		p.items[v.Target] = append(p.items[v.Target], v)
		return nil
	}
	if err := p.Flush(); err != nil {
		return err
	}

	p.item_last = v
	return nil
}

func (p *TextPrinter) Flush() error {
	items := p.items
	p.items = map[string][]arrk.Item{}
	if p.item_last.Name == "" {
		return nil
	}

	if _, err := fmt.Fprintf(p.Writer, "%s %s\n", p.item_last.Name, p.item_last.Version); err != nil {
		return err
	}

	targets := slices.Collect(maps.Keys(items))
	slices.Sort(targets)
	for _, target := range targets {
		vs := items[target]
		if len(vs) == 0 {
			continue
		}
		slices.SortFunc(vs, func(a, b arrk.Item) int {
			return strings.Compare(a.Origin, b.Origin)
		})

		if _, err := fmt.Fprintf(p.Writer, "\t%s\n", target); err != nil {
			return err
		}
		for _, item := range vs {
			if _, err := fmt.Fprintf(p.Writer, "\t\t%s\n", item.Origin); err != nil {
				return err
			}
		}
	}
	if _, err := fmt.Fprintf(p.Writer, "\n"); err != nil {
		return err
	}

	return nil
}
