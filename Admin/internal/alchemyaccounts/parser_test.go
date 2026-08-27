package alchemyaccounts

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseImportAcceptsObjectNDJSONAndArray(t *testing.T) {
	tests := []struct {
		name string
		text string
		want int
	}{
		{name: "object", text: `{"email":"one@example.com","api_key":"key-one"}`, want: 1},
		{name: "ndjson", text: "\n{\"email\":\"one@example.com\",\"api_key\":\"key-one\"}\n\n{\"email\":\"two@example.com\",\"api_key\":\"key-two\"}\n", want: 2},
		{name: "array", text: `[{"email":"one@example.com","api_key":"key-one"},{"email":"two@example.com","api_key":"key-two"}]`, want: 2},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result, err := ParseImport(test.text)
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Records) != test.want {
				t.Fatalf("records = %d, want %d", len(result.Records), test.want)
			}
		})
	}
}

func TestParseImportPreservesPayloadAndBuildsStableIdentity(t *testing.T) {
	text := `{"email":" User.Name+tag@Example.COM ","api_key":"key-one","future":{"nested":true},"checkpoint":{"stage":"completed","mailbox":{"client_id":"future-client"}}}`
	result, err := ParseImport(text)
	if err != nil {
		t.Fatal(err)
	}
	record := result.Records[0]
	if record.Email != "User.Name+tag@Example.COM" || record.NormalizedEmail != "user.name+tag@example.com" {
		t.Fatalf("email = %q, normalized = %q", record.Email, record.NormalizedEmail)
	}
	if record.Name != record.Email {
		t.Fatalf("name = %q, want email", record.Name)
	}
	if !strings.HasPrefix(record.ProviderID, "alchemy-user-name-tag-example-com-") {
		t.Fatalf("provider id = %q", record.ProviderID)
	}
	var payload map[string]any
	if err := json.Unmarshal(record.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	checkpoint := payload["checkpoint"].(map[string]any)
	mailbox := checkpoint["mailbox"].(map[string]any)
	if mailbox["client_id"] != "future-client" || payload["future"].(map[string]any)["nested"] != true {
		t.Fatalf("payload was not preserved: %#v", payload)
	}
}

func TestParseImportDeduplicatesIdenticalRecords(t *testing.T) {
	text := "{\"email\":\"one@example.com\",\"api_key\":\"key-one\",\"x\":1}\n{\"x\":1,\"api_key\":\"key-one\",\"email\":\"ONE@example.com\"}"
	result, err := ParseImport(text)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Records) != 1 || result.Skipped != 1 {
		t.Fatalf("result = %#v", result)
	}
}

func TestParseImportRejectsInvalidInputsWithoutLeakingSecrets(t *testing.T) {
	tests := []struct {
		name   string
		text   string
		secret string
	}{
		{name: "empty", text: "   "},
		{name: "non object", text: `"not-an-object"`},
		{name: "truncated", text: `{"email":"one@example.com","api_key":"hidden-key"`, secret: "hidden-key"},
		{name: "missing email", text: `{"api_key":"hidden-key"}`, secret: "hidden-key"},
		{name: "missing api key", text: `{"email":"one@example.com","mailbox_password":"hidden-password"}`, secret: "hidden-password"},
		{name: "conflicting duplicate", text: "{\"email\":\"one@example.com\",\"api_key\":\"first-secret\"}\n{\"email\":\"ONE@example.com\",\"api_key\":\"second-secret\"}", secret: "second-secret"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ParseImport(test.text)
			if err == nil {
				t.Fatal("expected error")
			}
			if test.secret != "" && strings.Contains(err.Error(), test.secret) {
				t.Fatalf("error leaked secret: %v", err)
			}
		})
	}
}
