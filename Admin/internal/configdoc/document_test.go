package configdoc

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestParseJSONAcceptsEmptyObject(t *testing.T) {
	document, err := ParseJSON([]byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if string(document.Payload) != `{}` {
		t.Fatalf("payload = %s", document.Payload)
	}
}

func TestParseJSONPreservesDecimalNumberPrecision(t *testing.T) {
	document, err := ParseJSON([]byte(`{"value":12345678901234567890.12345678901234567890}`))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(document.Payload, []byte(`12345678901234567890.12345678901234567890`)) || !bytes.Contains(document.YAML, []byte(`value: 12345678901234567890.12345678901234567890`)) {
		t.Fatalf("number changed: %s / %s", document.Payload, document.YAML)
	}
}

func TestOverlayRecursivelyMergesAndReplacesArrays(t *testing.T) {
	effective, err := ParseJSON([]byte(`{"server":{"httpPortV4":4000},"admin":{"token":"REDACTED","nested":{"keep":true,"replace":"default"}},"items":[1,2]}`))
	if err != nil {
		t.Fatal(err)
	}
	overrides, err := ParseJSON([]byte(`{"admin":{"token":"plain","nested":{"replace":"custom"}},"items":[3],"explicitNull":null}`))
	if err != nil {
		t.Fatal(err)
	}
	merged, err := Overlay(effective, overrides)
	if err != nil {
		t.Fatal(err)
	}
	var got, want any
	if err := json.Unmarshal(merged.Payload, &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(`{"server":{"httpPortV4":4000},"admin":{"token":"plain","nested":{"keep":true,"replace":"custom"}},"items":[3],"explicitNull":null}`), &want); err != nil {
		t.Fatal(err)
	}
	if !jsonValuesEqual(got, want) {
		t.Fatalf("merged = %s", merged.Payload)
	}
}

func TestOverlayPreservesJSONNumberPrecision(t *testing.T) {
	effective, err := ParseJSON([]byte(`{"value":1}`))
	if err != nil {
		t.Fatal(err)
	}
	overrides, err := ParseJSON([]byte(`{"value":12345678901234567890.12345678901234567890}`))
	if err != nil {
		t.Fatal(err)
	}
	merged, err := Overlay(effective, overrides)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(merged.Payload, []byte(`12345678901234567890.12345678901234567890`)) || !bytes.Contains(merged.YAML, []byte(`value: 12345678901234567890.12345678901234567890`)) {
		t.Fatalf("number changed: %s / %s", merged.Payload, merged.YAML)
	}
}

func jsonValuesEqual(left, right any) bool {
	leftJSON, err := json.Marshal(left)
	if err != nil {
		return false
	}
	rightJSON, err := json.Marshal(right)
	return err == nil && bytes.Equal(leftJSON, rightJSON)
}

func TestParseYAMLPreservesUnknownConfiguration(t *testing.T) {
	document, err := ParseYAML([]byte(`server:
  httpHostV4: 127.0.0.1
  httpPort: 4000
projects:
  - id: main
    upstreams:
      - id: primary
        endpoint: https://rpc.example/v2/plaintext-key
        failsafe:
          timeout:
            duration: 12s
futureField:
  nested: 9007199254740993
`))
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	decoder := json.NewDecoder(bytes.NewReader(document.Payload))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload["futureField"] == nil || !bytes.Contains(document.YAML, []byte("plaintext-key")) || document.Hash == "" {
		t.Fatalf("configuration was not preserved: %#v", document)
	}
}

func TestParseJSONPreservesLargeInteger(t *testing.T) {
	document, err := ParseJSON([]byte(`{"futureField":9007199254740993,"duration":"12s"}`))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(document.Payload, []byte("9007199254740993")) || !bytes.Contains(document.YAML, []byte("12s")) {
		t.Fatalf("number or duration changed: %s / %s", document.Payload, document.YAML)
	}
}
