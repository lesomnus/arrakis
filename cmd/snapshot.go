package cmd

import (
	"bufio"
	"io"
	"strings"
)

// Target <- []Origin
type Snapshot map[string][]string

// ReadSnapshot reads a snapshot from the given reader.
// The snapshot format is repeatedly like this:
//
//	{newline}
//	Target
//	Origin1
//	Origin1
//	Origin...
//
// Newline can be used multiple times.
func ReadSnapshot(f io.Reader) (Snapshot, error) {
	vs := Snapshot{}

	var (
		target  string
		origins []string
	)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		line = strings.TrimSpace(line)
		if line == "" {
			if len(origins) == 0 {
				continue
			}

			vs[target] = origins
			target = ""
			origins = nil
			continue
		}
		if origins == nil {
			target = line
			origins = []string{}
		} else {
			origins = append(origins, line)
		}
	}

	return vs, scanner.Err()
}
