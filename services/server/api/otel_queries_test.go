package api

import (
	"math"
	"testing"
)

func TestParseJSONMapAndAttrHelpers(t *testing.T) {
	attrs := parseJSONMap([]byte(`{"str":"value","float":12.5,"int":7,"whole":9}`))

	if got := getStringAttr(attrs, "missing", "str"); got != "value" {
		t.Fatalf("expected string attr value, got %q", got)
	}
	if got := getIntAttr(attrs, "float"); got != 12 {
		t.Fatalf("expected float to int conversion, got %d", got)
	}
	if got := getFloatAttr(attrs, "int"); got != 7 {
		t.Fatalf("expected int to float conversion, got %v", got)
	}

	invalid := parseJSONMap([]byte("{bad json"))
	if len(invalid) != 0 {
		t.Fatalf("expected invalid json to return empty map, got %+v", invalid)
	}
}

func TestPercentile(t *testing.T) {
	values := []float64{10, 20, 30, 40}

	tests := []struct {
		name     string
		input    []float64
		p        float64
		expected float64
	}{
		{name: "empty", input: nil, p: 0.5, expected: 0},
		{name: "single", input: []float64{42}, p: 0.9, expected: 42},
		{name: "lower bound", input: values, p: 0, expected: 10},
		{name: "upper bound", input: values, p: 1, expected: 40},
		{name: "interpolated median", input: values, p: 0.5, expected: 25},
		{name: "interpolated quarter", input: values, p: 0.25, expected: 17.5},
	}

	for _, tc := range tests {
		got := percentile(tc.input, tc.p)
		if math.Abs(got-tc.expected) > 0.0001 {
			t.Fatalf("%s: expected %v, got %v", tc.name, tc.expected, got)
		}
	}
}
