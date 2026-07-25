package arks_test

import (
	"testing"

	"github.com/lesomnus/arrakis/arks"
	"github.com/stretchr/testify/require"
)

func ptr[T any](v T) *T { return &v }

func TestAliasize(t *testing.T) {
	lines := func(vs []arks.Version) []string {
		out := make([]string, len(vs))
		for i, v := range vs {
			out[i] = string(v)
		}
		return out
	}

	t.Run("reproduces gh versions (major.minor.patch)", func(t *testing.T) {
		vs := arks.Aliasize([]string{"2.87.3", "2.88.0", "2.88.1", "2.89.0"}, nil)
		require.Equal(t, []string{
			"2.87.3 2.87",
			"2.88.0",
			"2.88.1 2.88",
			"2.89.0 2.89 latest",
		}, lines(vs))
	})

	t.Run("reproduces protoc versions (major.minor)", func(t *testing.T) {
		vs := arks.Aliasize([]string{"33.2", "33.3", "33.4", "33.5"}, nil)
		require.Equal(t, []string{
			"33.2",
			"33.3",
			"33.4",
			"33.5 33 latest",
		}, lines(vs))
	})

	t.Run("sorts and deduplicates", func(t *testing.T) {
		vs := arks.Aliasize([]string{"1.26.3", "1.26.0", "1.26.3", "1.26.1", "1.26.2"}, nil)
		require.Equal(t, []string{
			"1.26.0",
			"1.26.1",
			"1.26.2",
			"1.26.3 1.26 latest",
		}, lines(vs))
	})

	t.Run("series disabled keeps only latest", func(t *testing.T) {
		vs := arks.Aliasize([]string{"0.0.1", "0.0.2", "0.0.4", "0.0.3"}, &arks.AliasPolicy{Series: ptr(false)})
		require.Equal(t, []string{
			"0.0.1",
			"0.0.2",
			"0.0.3",
			"0.0.4 latest",
		}, lines(vs))
	})

	t.Run("latest disabled keeps only series", func(t *testing.T) {
		vs := arks.Aliasize([]string{"33.4", "33.5"}, &arks.AliasPolicy{Latest: ptr(false)})
		require.Equal(t, []string{
			"33.4",
			"33.5 33",
		}, lines(vs))
	})

	t.Run("empty", func(t *testing.T) {
		require.Empty(t, arks.Aliasize(nil, nil))
	})
}

func TestFormatVersions(t *testing.T) {
	got := arks.FormatVersions([]arks.Version{"1.0.0", "1.1.0 1.1 latest"})
	require.Equal(t, "1.0.0\n1.1.0 1.1 latest\n", got)
}
