package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"sort"
	"testing"
	"time"

	adminauth "github.com/erpc/admin/internal/auth"
	"github.com/erpc/admin/internal/config"
	"github.com/erpc/admin/internal/configdoc"
	"github.com/erpc/admin/internal/registry"
	"github.com/erpc/admin/internal/revisions"
)

// Match the production PostgreSQL store: list returns newest revisions first.
type orderedRevisionStore struct {
	*fakeRevisionStore
}

func (s *orderedRevisionStore) List(ctx context.Context, limit int) ([]revisions.Revision, error) {
	items, err := s.fakeRevisionStore.List(ctx, limit)
	if err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Revision > items[j].Revision })
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

type duplicateCheckingValidator struct {
	defaults configdoc.Document
}

func (v duplicateCheckingValidator) Validate(_ context.Context, document configdoc.Document) (configdoc.ValidationResult, error) {
	var root map[string]any
	if err := json.Unmarshal(document.Payload, &root); err != nil {
		return configdoc.ValidationResult{}, err
	}
	projects, _ := root["projects"].([]any)
	for projectIndex, rawProject := range projects {
		project, _ := rawProject.(map[string]any)
		upstreams, _ := project["upstreams"].([]any)
		seen := make(map[string]struct{}, len(upstreams))
		for upstreamIndex, rawUpstream := range upstreams {
			upstream, _ := rawUpstream.(map[string]any)
			id, _ := upstream["id"].(string)
			if id == "" {
				continue
			}
			if _, exists := seen[id]; exists {
				return configdoc.ValidationResult{Valid: false, Errors: []string{fmt.Sprintf("项目 %d 的上游 ID %q 重复（第 %d 项）", projectIndex+1, id, upstreamIndex+1)}}, nil
			}
			seen[id] = struct{}{}
		}
	}
	return configdoc.ValidationResult{Valid: true}, nil
}

func (v duplicateCheckingValidator) Dump(_ context.Context, document configdoc.Document) (configdoc.Document, error) {
	if len(v.defaults.Payload) == 0 {
		return document, nil
	}
	return configdoc.Overlay(v.defaults, document)
}

func TestManagedConfigCRUDManyUpstreamsAndRestore(t *testing.T) {
	defaults := mustDocument(t, "{\"server\":{\"httpPortV4\":4000},\"defaultOnly\":true}")
	store := &orderedRevisionStore{fakeRevisionStore: &fakeRevisionStore{}}
	handler, cookie := newCRUDManagedHandler(t, store, duplicateCheckingValidator{defaults: defaults})

	initial := map[string]any{
		"futureRoot": map[string]any{"keep": true},
		"projects": []any{map[string]any{
			"id":            "main",
			"futureProject": "preserve-me",
			"upstreams": []any{
				map[string]any{"id": "alpha", "endpoint": "https://alpha.example", "type": "evm", "futureUpstream": map[string]any{"weight": 10}},
				map[string]any{"id": "beta", "endpoint": "https://beta.example", "type": "evm"},
			},
		}},
	}

	rev1 := createManagedRevision(t, handler, cookie, initial, 0)
	if rev1.Revision != 1 || len(store.items) != 1 {
		t.Fatalf("initial revision = %#v, stored=%d", rev1, len(store.items))
	}
	current := getManagedPayload(t, handler, cookie, "/api/config/current")
	assertJSONEqual(t, current, mustJSON(t, initial))

	duplicate := map[string]any{
		"projects": []any{map[string]any{"id": "main", "upstreams": []any{
			map[string]any{"id": "same", "endpoint": "https://one.example"},
			map[string]any{"id": "same", "endpoint": "https://two.example"},
		}}},
	}
	duplicateResponse := request(t, handler, http.MethodPost, "/api/config/revisions", map[string]any{"payload": duplicate, "baseRevision": rev1.Revision}, cookie)
	assertStatus(t, duplicateResponse, http.StatusUnprocessableEntity)
	if len(store.items) != 1 {
		t.Fatalf("duplicate upstream consumed a revision: %d", len(store.items))
	}

	many := make([]any, 0, 129)
	many = append(many, map[string]any{"id": "alpha", "endpoint": "https://alpha-edited.example", "type": "evm", "futureUpstream": map[string]any{"weight": 10}})
	for index := 0; index < 128; index++ {
		many = append(many, map[string]any{"id": fmt.Sprintf("node-%03d", index), "endpoint": fmt.Sprintf("https://node-%03d.example", index), "type": "evm"})
	}
	edited := map[string]any{
		"futureRoot": map[string]any{"keep": true},
		"projects":   []any{map[string]any{"id": "main", "futureProject": "preserve-me", "upstreams": many}},
	}
	rev2 := createManagedRevision(t, handler, cookie, edited, rev1.Revision)
	if rev2.Revision != 2 || len(store.items) != 2 {
		t.Fatalf("edited revision = %#v, stored=%d", rev2, len(store.items))
	}
	if got := upstreamCount(getManagedPayload(t, handler, cookie, "/api/config/revisions/2")); got != 129 {
		t.Fatalf("edited upstream count = %d, want 129", got)
	}

	deleted := map[string]any{
		"futureRoot": map[string]any{"keep": true},
		"projects":   []any{map[string]any{"id": "main", "futureProject": "preserve-me", "upstreams": many[:len(many)-1]}},
	}
	rev3 := createManagedRevision(t, handler, cookie, deleted, rev2.Revision)
	if rev3.Revision != 3 {
		t.Fatalf("delete revision = %#v", rev3)
	}
	if got := upstreamCount(getManagedPayload(t, handler, cookie, "/api/config/current")); got != 128 {
		t.Fatalf("deleted upstream count = %d, want 128", got)
	}

	restoredResponse := request(t, handler, http.MethodPost, "/api/config/revisions/1/restore", nil, cookie)
	assertStatus(t, restoredResponse, http.StatusCreated)
	var restored revisions.Revision
	if err := json.NewDecoder(restoredResponse.Body).Decode(&restored); err != nil {
		t.Fatal(err)
	}
	if restored.Revision != 4 || len(store.items) != 4 {
		t.Fatalf("restore revision = %#v, stored=%d", restored, len(store.items))
	}
	assertJSONEqual(t, getManagedPayload(t, handler, cookie, "/api/config/current"), mustJSON(t, initial))

	listResponse := request(t, handler, http.MethodGet, "/api/config/revisions", nil, cookie)
	assertStatus(t, listResponse, http.StatusOK)
	var list []revisions.Revision
	if err := json.NewDecoder(listResponse.Body).Decode(&list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 4 || list[0].Revision != 4 || list[1].Revision != 3 || list[2].Revision != 2 || list[3].Revision != 1 {
		t.Fatalf("revision list order = %#v", list)
	}
	detailPayload := getManagedPayload(t, handler, cookie, "/api/config/revisions/1")
	assertJSONEqual(t, detailPayload, mustJSON(t, initial))

	stale := request(t, handler, http.MethodPost, "/api/config/revisions", map[string]any{"payload": initial, "baseRevision": 1}, cookie)
	assertStatus(t, stale, http.StatusConflict)
	if len(store.items) != 4 {
		t.Fatalf("stale write consumed a revision: %d", len(store.items))
	}
}

func newCRUDManagedHandler(t *testing.T, store revisionStore, validator configValidator) (http.Handler, *http.Cookie) {
	t.Helper()
	reg, err := registry.New(config.RuntimeConfig{PollInterval: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	accounts, err := adminauth.NewStore(filepath.Join(t.TempDir(), "administrator.json"))
	if err != nil {
		t.Fatal(err)
	}
	handler := NewManaged(reg, accounts, adminauth.NewSessions(time.Hour), ManagedDependencies{Revisions: store, Validator: validator, Runtime: fakeRuntime{}})
	setup := request(t, handler, http.MethodPost, "/api/auth/setup", map[string]string{"username": "admin", "password": "correct-horse"}, nil)
	assertStatus(t, setup, http.StatusCreated)
	return handler, setup.Result().Cookies()[0]
}

func createManagedRevision(t *testing.T, handler http.Handler, cookie *http.Cookie, payload map[string]any, baseRevision int64) revisions.Revision {
	t.Helper()
	response := request(t, handler, http.MethodPost, "/api/config/revisions", map[string]any{"payload": payload, "baseRevision": baseRevision}, cookie)
	assertStatus(t, response, http.StatusCreated)
	var revision revisions.Revision
	if err := json.NewDecoder(response.Body).Decode(&revision); err != nil {
		t.Fatal(err)
	}
	return revision
}

func getManagedPayload(t *testing.T, handler http.Handler, cookie *http.Cookie, path string) json.RawMessage {
	t.Helper()
	response := request(t, handler, http.MethodGet, path, nil, cookie)
	assertStatus(t, response, http.StatusOK)
	var body map[string]json.RawMessage
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body["payload"]
}

func upstreamCount(payload json.RawMessage) int {
	var root map[string]any
	if err := json.Unmarshal(payload, &root); err != nil {
		return -1
	}
	projects, _ := root["projects"].([]any)
	count := 0
	for _, rawProject := range projects {
		project, _ := rawProject.(map[string]any)
		upstreams, _ := project["upstreams"].([]any)
		count += len(upstreams)
	}
	return count
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
