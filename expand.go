package main

import (
	"iter"

	"github.com/lesomnus/arrakis/arrk"
)

func expandPlatform(p arrk.Platform) iter.Seq[arrk.Platform] {
	os, arch, variant := p.Normalized().Split()
	if os == "" || arch == "" {
		return func(yield func(arrk.Platform) bool) {}
	}

	return func(yield func(arrk.Platform) bool) {
		oses := []arrk.Os{}
		switch os {
		case "_":
			oses = []arrk.Os{
				arrk.OsLinux,
				arrk.OsWindows,
				arrk.OsDarwin,
			}
		default:
			oses = []arrk.Os{arrk.Os(os)}
		}

		archs := []arrk.Arch{}
		for _, os := range oses {
			switch os {
			case arrk.OsLinux:
				switch arch {
				case "_":
					archs = []arrk.Arch{
						"x86",
						"x86_64",
						"aarch32",
						"aarch64",
						"amd64",
						"arm64",
					}

				case "_32":
					archs = []arrk.Arch{
						"x86",
						"aarch32",
					}

				case "_64":
					archs = []arrk.Arch{
						"x86_64",
						"aarch64",
						"amd64",
						"arm64",
					}

				case "_amd64":
					archs = []arrk.Arch{
						"x86_64",
						"amd64",
					}

				case "_arm64":
					archs = []arrk.Arch{
						"aarch64",
						"arm64",
					}

				default:
					archs = []arrk.Arch{arrk.Arch(arch)}
				}

			case arrk.OsWindows:
				switch arch {
				case "_":
					archs = []arrk.Arch{
						"AMD64",
						"x86",
						"ARM64",
						"ARM",
					}

				case "_32":
					archs = []arrk.Arch{
						"x86",
						"ARM",
					}

				case "_64":
					archs = []arrk.Arch{
						"AMD64",
						"ARM64",
					}

				case "_amd64":
					archs = []arrk.Arch{
						"AMD64",
					}

				case "_arm64":
					archs = []arrk.Arch{
						"ARM64",
					}

				default:
					archs = []arrk.Arch{arrk.Arch(arch)}
				}

			case arrk.OsDarwin:
				switch arch {
				case "_":
					archs = []arrk.Arch{
						"x86_64",
						"arm64",
					}

				case "_64":
					archs = []arrk.Arch{
						"x86_64",
						"arm64",
					}

				case "_amd64":
					archs = []arrk.Arch{
						"x86_64",
					}

				case "_arm64":
					archs = []arrk.Arch{
						"arm64",
					}

				default:
					archs = []arrk.Arch{arrk.Arch(arch)}
				}
			}
		}

		for _, arch := range archs {
			if !yield(arrk.Platform(string(os) + "/" + string(arch) + "/" + string(variant))) {
				return
			}
		}
	}
}
