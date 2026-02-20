package arks_test

import (
	"slices"
	"testing"

	"github.com/lesomnus/arrakis/arks"
	"github.com/stretchr/testify/require"
)

func TestVersion(t *testing.T) {
	for _, tc := range [][]string{
		{"1.2.3", "1.2.3"},
		{" 1.2.3 ", "1.2.3"},
		{"  1.2.3  ", "1.2.3"},
		{"1.2.3 1.2 1 latest", "1.2.3", "1.2", "1", "latest"},
		{"  1.2.3 1.2  1   latest  ", "1.2.3", "1.2", "1", "latest"},
	} {
		version := arks.Version(tc[0])
		require.Equal(t, tc[1], version.Value())

		aliases := slices.Collect(version.Aliases())
		if aliases == nil {
			aliases = []string{}
		}
		require.Equal(t, tc[2:], aliases)

		values := slices.Collect(version.Values())
		require.Equal(t, tc[1:], values)
	}
}
