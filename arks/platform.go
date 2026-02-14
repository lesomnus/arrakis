package arks

import (
	"iter"
	"slices"
	"strings"
)

type Os string
type Arch string
type Variant string

// Canonical? OS and Arch names.
// See:
// - https://go.dev/doc/install/source#environment
// - https://github.com/opencontainers/image-spec/blob/main/image-index.md#platform-variants
const (
	OsLinux   Os = "linux"
	OsWindows Os = "windows"
	OsDarwin  Os = "darwin"

	ArchArm   Arch = "arm"
	ArchArm64 Arch = "arm64"
	ArchAmd64 Arch = "amd64"

	ArchX86     Arch = "x86"
	ArchX86_64  Arch = "x86_64"
	ArchAArch32 Arch = "aarch32"
	ArchAArch64 Arch = "aarch64"

	VariantArmV6 Variant = "v6"
	VariantArmV7 Variant = "v7"
	VariantArmV8 Variant = "v8"
)

type Platform string

func (p Platform) Split() (os Os, arch Arch, variant Variant) {
	es := strings.SplitN(string(p), "/", 3)
	os = Os(es[0])
	if len(es) > 1 {
		arch = Arch(es[1])
	}
	if len(es) > 2 {
		variant = Variant(es[2])
	}
	return
}

func (p Platform) Os() Os {
	os, _, _ := p.Split()
	return os
}

func (p Platform) Arch() Arch {
	_, arch, _ := p.Split()
	return arch
}

func (p Platform) Variant() Variant {
	_, _, variant := p.Split()
	return variant
}

func (p Platform) Normalized() Platform {
	os, arch, variant := p.Split()
	if os == "" {
		return ""
	}
	if arch == "" {
		return Platform(os)
	}

	arch_ := Arch(arch)
	switch Arch(arch) {
	case ArchX86_64:
		arch_ = ArchAmd64
	case ArchAArch32:
		arch_ = ArchArm
	case ArchAArch64:
		arch_ = ArchArm64
	}

	p_ := string(p)
	if arch_ != Arch(arch) {
		p_ = strings.Join([]string{string(os), string(arch_), string(variant)}, "/")
	}

	var ok bool
	for {
		if p_, ok = strings.CutSuffix(p_, "/"); !ok {
			break
		}
	}

	return Platform(p_)
}

func (p Platform) Expand() iter.Seq[Platform] {
	os, arch, variant := p.Normalized().Split()
	if os == "" || arch == "" {
		return func(yield func(Platform) bool) {}
	}
	if !strings.HasPrefix(string(p), "_") && !strings.Contains(string(p), "/_") {
		// Seems that there is no wildcard. No need to expand.
		return func(yield func(Platform) bool) {
			yield(p)
		}
	}

	return func(yield func(Platform) bool) {
		oses := []Os{}
		switch os {
		case "_":
			oses = []Os{
				OsLinux,
				OsWindows,
				OsDarwin,
			}
		default:
			oses = []Os{Os(os)}
		}

		archs := []Arch{}
		for _, os := range oses {
			switch os {
			case OsLinux:
				switch arch {
				case "_":
					archs = []Arch{
						"x86",
						"x86_64",
						"aarch32",
						"aarch64",
						"amd64",
						"arm64",
					}

				case "_32":
					archs = []Arch{
						"x86",
						"aarch32",
					}

				case "_64":
					archs = []Arch{
						"x86_64",
						"aarch64",
						"amd64",
						"arm64",
					}

				case "_arm64":
					archs = []Arch{
						"aarch64",
						"arm64",
					}

				case "_amd64":
					archs = []Arch{
						"x86_64",
						"amd64",
					}
				}

			case OsWindows:
				switch arch {
				case "_":
					archs = []Arch{
						"AMD64",
						"x86",
						"ARM64",
						"ARM",
					}

				case "_32":
					archs = []Arch{
						"x86",
						"ARM",
					}

				case "_64":
					archs = []Arch{
						"AMD64",
						"ARM64",
					}

				case "_arm64":
					archs = []Arch{
						"ARM64",
					}

				case "_amd64":
					archs = []Arch{
						"AMD64",
					}
				}

			case OsDarwin:
				switch arch {
				case "_":
					archs = []Arch{
						"x86_64",
						"arm64",
					}
				}
			}
		}

		for _, arch := range archs {
			if !yield(Platform(string(os) + "/" + string(arch) + "/" + string(variant))) {
				return
			}
		}
	}
}

type PlatformMap map[Platform]Platform

func (m PlatformMap) Expand() map[Platform][]Platform {
	m_ := make(map[Platform][]Platform)
	for pattern, v := range m {
		m_[v] = slices.Collect(pattern.Expand())
	}

	return m_
}

func (m PlatformMap) Resolve(p Platform) (Platform, bool) {
	var (
		match Platform
		score = 0
	)

	os, arch, _ := p.Normalized().Split()
	if os == "" || arch == "" {
		return "", false
	}

	for k, v := range m {
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

func (a Arch) Is32() bool {
	switch a {
	case ArchArm, ArchX86:
		return true
	default:
		return false
	}
}

func (a Arch) Is64() bool {
	switch a {
	case ArchArm64, ArchAmd64:
		return true
	default:
		return false
	}
}

func (a Arch) IsAmd() bool {
	switch a {
	case ArchX86, ArchX86_64, ArchAmd64:
		return true
	default:
		return false
	}
}

func (a Arch) IsArm() bool {
	switch a {
	case ArchArm, ArchArm64:
		return true
	default:
		return false
	}
}

func (a Arch) IsAmd32() bool {
	switch a {
	case ArchX86:
		return true
	default:
		return false
	}
}

func (a Arch) IsAmd64() bool {
	switch a {
	case ArchAmd64, ArchX86_64:
		return true
	default:
		return false
	}
}

func (a Arch) IsArm32() bool {
	switch a {
	case ArchArm:
		return true
	default:
		return false
	}
}

func (a Arch) IsArm64() bool {
	switch a {
	case ArchArm64:
		return true
	default:
		return false
	}
}
