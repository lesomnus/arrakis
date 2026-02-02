package render

import (
	"fmt"
	"io"
	"maps"
	"slices"
	"strings"

	"github.com/lesomnus/arrakis/arks"
)

type TreePrinter struct {
	w io.Writer

	item_last arks.Item
	// For each target.
	items map[string][]arks.Item
}

func NewTreePrinter(w io.Writer) *TreePrinter {
	return &TreePrinter{
		w:     w,
		items: map[string][]arks.Item{},
	}
}

func (p *TreePrinter) Render(c arks.Config, v arks.Item) error {
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

func (p *TreePrinter) Flush() error {
	items := p.items
	p.items = map[string][]arks.Item{}
	if p.item_last.Name == "" {
		return nil
	}

	if _, err := fmt.Fprintf(p.w, "%s %s\n", p.item_last.Name, p.item_last.Version); err != nil {
		return err
	}

	targets := slices.Collect(maps.Keys(items))
	slices.Sort(targets)
	for _, target := range targets {
		vs := items[target]
		if len(vs) == 0 {
			continue
		}
		slices.SortFunc(vs, func(a, b arks.Item) int {
			return strings.Compare(a.Origin, b.Origin)
		})

		if _, err := fmt.Fprintf(p.w, "\t%s\n", target); err != nil {
			return err
		}
		for _, item := range vs {
			if _, err := fmt.Fprintf(p.w, "\t\t%s\n", item.Origin); err != nil {
				return err
			}
		}
	}
	if _, err := fmt.Fprintf(p.w, "\n"); err != nil {
		return err
	}

	return nil
}
