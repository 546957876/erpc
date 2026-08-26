package configdoc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestValidatorUsesGeneratedYAML(t *testing.T) {
	document, err := ParseJSON([]byte(`{"endpoint":"https://rpc.example"}`))
	if err != nil {
		t.Fatal(err)
	}
	validator := Validator{RuntimeDir: t.TempDir()}
	validator.run = func(_ context.Context, path string) ([]byte, error) {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		if !bytes.Contains(data, []byte("rpc.example")) {
			t.Fatalf("generated YAML = %s", data)
		}
		return []byte(`{"errors":[],"warnings":[]}`), nil
	}
	result, err := validator.Validate(context.Background(), document)
	if err != nil || !result.Valid {
		t.Fatalf("valid = %v, err=%v", result.Valid, err)
	}
}

func TestValidatorReturnsConfigurationErrors(t *testing.T) {
	document, err := ParseJSON([]byte(`{"invalid":true}`))
	if err != nil {
		t.Fatal(err)
	}
	validator := Validator{RuntimeDir: t.TempDir()}
	validator.run = func(context.Context, string) ([]byte, error) {
		return []byte(`{"errors":["projects are required"]}`), errors.New("exit status 1")
	}
	result, err := validator.Validate(context.Background(), document)
	if err != nil || result.Valid || len(result.Errors) != 1 {
		t.Fatalf("result = %#v, err=%v", result, err)
	}
}

func TestValidatorDumpOverlaysOriginalOverrides(t *testing.T) {
	document, err := ParseJSON([]byte(`{"secret":"plain","settings":{"enabled":true}}`))
	if err != nil {
		t.Fatal(err)
	}
	validator := Validator{RuntimeDir: t.TempDir()}
	validator.dump = func(_ context.Context, path string) ([]byte, error) {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("temporary config missing: %v", err)
		}
		return []byte(`{"server":{"httpPortV4":4000},"secret":"REDACTED","settings":{"enabled":false}}`), nil
	}
	effective, err := validator.Dump(context.Background(), document)
	if err != nil {
		t.Fatal(err)
	}
	var got, want any
	if err := json.Unmarshal(effective.Payload, &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(`{"server":{"httpPortV4":4000},"secret":"plain","settings":{"enabled":true}}`), &want); err != nil {
		t.Fatal(err)
	}
	if !jsonValuesEqual(got, want) {
		t.Fatalf("effective = %s", effective.Payload)
	}
}

func TestValidatorDumpFailureDoesNotExposeConfiguration(t *testing.T) {
	document, err := ParseJSON([]byte(`{"secret":"do-not-leak"}`))
	if err != nil {
		t.Fatal(err)
	}
	validator := Validator{RuntimeDir: t.TempDir()}
	validator.dump = func(context.Context, string) ([]byte, error) {
		return []byte(`{"secret":"do-not-leak"}`), errors.New("exit status 1")
	}
	_, err = validator.Dump(context.Background(), document)
	if err == nil || !strings.Contains(err.Error(), "eRPC dump") || strings.Contains(err.Error(), "do-not-leak") {
		t.Fatalf("error = %v", err)
	}
}

func TestValidatorDumpInvalidJSONHasOperationContext(t *testing.T) {
	document, err := ParseJSON([]byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	validator := Validator{RuntimeDir: t.TempDir()}
	validator.dump = func(context.Context, string) ([]byte, error) {
		return []byte(`not-json`), nil
	}
	_, err = validator.Dump(context.Background(), document)
	if err == nil || !strings.Contains(err.Error(), "decode eRPC dump") || strings.Contains(err.Error(), "not-json") {
		t.Fatalf("error = %v", err)
	}
}
