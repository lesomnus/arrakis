package arks

import (
	"fmt"
	"io"
	"maps"
	"slices"
	"strings"
)

var Renders = map[string](func(io.Writer) Renderer){
	"kv":   renderCtorFunc(NewKvRenderer),
	"tree": renderCtorFunc(NewTreePrinter),
	"cfkv": renderCtorFunc(NewCloudFlareKvRenderer),
}

func renderCtorFunc[T Renderer](f func(io.Writer) T) func(io.Writer) Renderer {
	return func(w io.Writer) Renderer {
		return f(w)
	}
}

type Renderer interface {
	Render(c Config, v Item) error
	Flush() error
}

type CloudFlareKvRenderer struct {
	w io.Writer
	s string
}

type KvRenderer struct {
	w io.Writer
}

func NewKvRenderer(w io.Writer) *KvRenderer {
	return &KvRenderer{w}
}

func (p *KvRenderer) Render(c Config, v Item) error {
	_, err := fmt.Fprintf(p.w, "%s,%s}", v.Origin, v.Target)
	return err
}

func (p *KvRenderer) Flush() error {
	if f, ok := p.w.(interface{ Flush() error }); ok {
		return f.Flush()
	}
	return nil
}

func NewCloudFlareKvRenderer(w io.Writer) *CloudFlareKvRenderer {
	fmt.Fprintf(w, "[\n")
	return &CloudFlareKvRenderer{w, ""}
}

func (p *CloudFlareKvRenderer) Render(c Config, v Item) error {
	_, err := fmt.Fprintf(p.w, "%s{\"key\":%q,\"value\":%q}", p.s, v.Origin, v.Target)
	p.s = ",\n"
	return err
}

func (p *CloudFlareKvRenderer) Flush() error {
	fmt.Fprintf(p.w, "\n]\n")
	return nil
}

type TreePrinter struct {
	w io.Writer

	item_last Item
	// For each target.
	items map[string][]Item
}

func NewTreePrinter(w io.Writer) *TreePrinter {
	return &TreePrinter{
		w:     w,
		items: map[string][]Item{},
	}
}

func (p *TreePrinter) Render(c Config, v Item) error {
	if p.item_last.Name == "" {
		p.item_last = v
		p.items[v.Target] = append(p.items[v.Target], v)
		return nil
	}
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
	p.items = map[string][]Item{}
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
		slices.SortFunc(vs, func(a, b Item) int {
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
