package arks

import "strings"

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

func (p Platform) String() string {
	return string(p)
}

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
