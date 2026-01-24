package arrk

import "iter"

func (p Platform) Expand() iter.Seq[Platform] {
	os, arch, variant := p.Normalized().Split()
	if os == "" || arch == "" {
		return func(yield func(Platform) bool) {}
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
