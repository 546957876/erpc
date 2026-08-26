package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/erpc/erpc/common"
)

type schema struct {
	Root        node                  `json:"root"`
	Definitions map[string]definition `json:"definitions"`
}

type definition struct {
	Fields []field `json:"fields"`
}

type field struct {
	Key        string `json:"key"`
	Node       node   `json:"node"`
	Owner      string `json:"owner"`
	GoName     string `json:"goName"`
	GoType     string `json:"goType"`
	Comment    string `json:"comment,omitempty"`
	Deprecated bool   `json:"deprecated,omitempty"`
}

type node struct {
	Kind  string `json:"kind"`
	Ref   string `json:"ref,omitempty"`
	Item  *node  `json:"item,omitempty"`
	Value *node  `json:"value,omitempty"`
}

type sourceInfo struct {
	Comment    string
	Deprecated bool
}

type generator struct {
	definitions map[string]definition
	sources     map[string]sourceInfo
}

func main() {
	out := flag.String("out", "web/src/config/schema.generated.json", "output file")
	flag.Parse()

	root, err := repositoryRoot()
	if err != nil {
		fatal(err)
	}
	g := &generator{definitions: map[string]definition{}, sources: loadSources(filepath.Join(root, "common"))}
	result := schema{Root: g.node(reflect.TypeOf(common.Config{})), Definitions: g.definitions}
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		fatal(err)
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		fatal(err)
	}
	if err := os.WriteFile(*out, data, 0o644); err != nil {
		fatal(err)
	}
}

func (g *generator) node(t reflect.Type) node {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if isStringValue(t) {
		return node{Kind: "string"}
	}
	switch t.Kind() {
	case reflect.Bool:
		return node{Kind: "boolean"}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Float32, reflect.Float64:
		return node{Kind: "number"}
	case reflect.String:
		return node{Kind: "string"}
	case reflect.Slice, reflect.Array:
		item := g.node(t.Elem())
		return node{Kind: "array", Item: &item}
	case reflect.Map:
		value := g.node(t.Elem())
		return node{Kind: "map", Value: &value}
	case reflect.Struct:
		name := t.Name()
		g.definition(t, name)
		return node{Kind: "object", Ref: name}
	default:
		return node{Kind: "any"}
	}
}

func (g *generator) definition(t reflect.Type, name string) {
	if _, exists := g.definitions[name]; exists {
		return
	}
	// Mark before walking fields to break recursive type cycles.
	g.definitions[name] = definition{}
	fields := g.fields(t, name)
	g.definitions[name] = definition{Fields: fields}
}

func (g *generator) fields(t reflect.Type, owner string) []field {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	fields := make([]field, 0, t.NumField())
	for i := 0; i < t.NumField(); i++ {
		structField := t.Field(i)
		if !structField.IsExported() {
			continue
		}
		tag := structField.Tag.Get("yaml")
		parts := strings.Split(tag, ",")
		if len(parts) > 1 && contains(parts[1:], "inline") {
			inlineType := structField.Type
			for inlineType.Kind() == reflect.Pointer {
				inlineType = inlineType.Elem()
			}
			if inlineType.Kind() == reflect.Struct {
				fields = append(fields, g.fields(inlineType, inlineType.Name())...)
				continue
			}
		}
		key := parts[0]
		if key == "-" {
			continue
		}
		if key == "" {
			key = lowerFirst(structField.Name)
		}
		info := g.sources[owner+"."+structField.Name]
		fields = append(fields, field{Key: key, Node: g.node(structField.Type), Owner: owner, GoName: structField.Name, GoType: structField.Type.String(), Comment: info.Comment, Deprecated: info.Deprecated})
	}
	return fields
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func loadSources(dir string) map[string]sourceInfo {
	result := map[string]sourceInfo{}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return result
	}
	fset := token.NewFileSet()
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, filepath.Join(dir, entry.Name()), nil, parser.ParseComments)
		if err != nil {
			continue
		}
		for _, declaration := range file.Decls {
			gen, ok := declaration.(*ast.GenDecl)
			if !ok || gen.Tok.String() != "type" {
				continue
			}
			for _, spec := range gen.Specs {
				typeSpec, ok := spec.(*ast.TypeSpec)
				if !ok {
					continue
				}
				structure, ok := typeSpec.Type.(*ast.StructType)
				if !ok {
					continue
				}
				for _, field := range structure.Fields.List {
					comment := strings.TrimSpace(strings.TrimSpace(groupText(field.Doc)) + "\n" + strings.TrimSpace(groupText(field.Comment)))
					comment = strings.TrimSpace(comment)
					deprecated := strings.Contains(strings.ToLower(comment), "deprecated:") || strings.Contains(strings.ToLower(comment), "@deprecated")
					for _, name := range field.Names {
						result[typeSpec.Name.Name+"."+name.Name] = sourceInfo{Comment: comment, Deprecated: deprecated}
					}
				}
			}
		}
	}
	return result
}

func groupText(group *ast.CommentGroup) string {
	if group == nil {
		return ""
	}
	return group.Text()
}

func repositoryRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("repository root with go.mod was not found")
}

func isStringValue(t reflect.Type) bool {
	return t == reflect.TypeOf(time.Duration(0)) || t == reflect.TypeOf(time.Time{}) || strings.Contains(strings.ToLower(t.Name()), "duration") || strings.Contains(strings.ToLower(t.Name()), "bytesize")
}

func lowerFirst(value string) string {
	if value == "" {
		return value
	}
	return strings.ToLower(value[:1]) + value[1:]
}
func fatal(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }

// Keep generated definitions stable for tests and review diffs.
