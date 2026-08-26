package main

import (
	"reflect"
	"strings"
	"testing"

	"github.com/erpc/erpc/common"
)

func TestGeneratorExpandsInlineFieldsAndMarksDeprecatedFields(t *testing.T) {
	g := &generator{definitions: map[string]definition{}, sources: loadSources("../../common")}
	g.node(reflect.TypeOf(common.Config{}))
	server := g.definitions["ServerConfig"]
	var deprecated bool
	for _, item := range server.Fields {
		if item.Key == "httpPort" {
			deprecated = item.Deprecated
		}
	}
	if !deprecated {
		t.Fatal("ServerConfig.httpPort should be marked deprecated")
	}
	integrity := g.definitions["IntegrityConfig"]
	keys := make(map[string]bool)
	for _, item := range integrity.Fields {
		keys[item.Key] = true
		if item.Key == "integritySettings" {
			t.Fatal("inline IntegritySettings must not become a fake field")
		}
	}
	for _, key := range []string{"level", "checks", "budget"} {
		if !keys[key] {
			t.Fatalf("inline field %q missing from IntegrityConfig", key)
		}
	}
}

func TestGeneratorCarriesSourceComments(t *testing.T) {
	sources := loadSources("../../common")
	info, ok := sources["ServerConfig.HttpPort"]
	if !ok || !strings.Contains(strings.ToLower(info.Comment), "deprecated") || !info.Deprecated {
		t.Fatalf("source info = %#v", info)
	}
}
