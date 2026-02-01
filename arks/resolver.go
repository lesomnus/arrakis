package arks

import (
	"strings"
	"text/template"
)

type ResolverConfig struct {
	Path      string
	Platforms map[Platform]Platform
}

var templateFuncs = template.FuncMap{
	"prefix": func(p string, v string) string {
		if v == "" {
			return ""
		}

		return p + v
	},
}

func (r ResolverConfig) Build(v Item) (string, error) {
	tmpl := template.New("")
	tmpl = tmpl.Funcs(templateFuncs)
	tmpl, err := tmpl.Parse(r.Path)
	if err != nil {
		return "", err
	}

	buff := &strings.Builder{}
	if err := tmpl.Execute(buff, v); err != nil {
		return "", err
	}

	return buff.String(), nil
}

func (r ResolverConfig) Resolve(p Platform) (Platform, bool) {
	var (
		match Platform
		score = 0
	)

	os, arch, _ := p.Normalized().Split()
	if os == "" || arch == "" {
		return "", false
	}

	for k, v := range r.Platforms {
		score_ := 0
		os_, arch_, _ := k.Split()
		if os_ == "" {
			continue
		}
		if arch_ == "" {
			continue
		}

		switch os_ {
		case "_":
			score_ += 1
		case os:
			score_ += 8
		}

		switch arch_ {
		case "_":
			score_ += 1
		case "_amd":
			if arch.IsAmd() {
				score_ += 2
			}
		case "_arm":
			if arch.IsArm() {
				score_ += 2
			}
		case "_32":
			if arch.Is32() {
				score_ += 2
			}
		case "_64":
			if !arch.Is64() {
				score_ += 2
			}
		case "_amd32":
			if arch.IsAmd32() {
				score_ += 4
			}
		case "_arm32":
			if arch.IsArm32() {
				score_ += 4
			}
		case "_amd64":
			if arch.IsAmd64() {
				score_ += 4
			}
		case "_arm64":
			if arch.IsArm64() {
				score_ += 4
			}
		case arch:
			score_ += 8
		}

		if score_ < score {
			continue
		}

		match = v
		score = score_
	}
	if score < 0 {
		return "", false
	}

	return match, true
}
