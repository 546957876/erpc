package runtime

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/erpc/admin/internal/configdoc"
	"github.com/erpc/admin/internal/revisions"
)

func TestWriteRuntimeConfig(t *testing.T) {
	document, err := configdoc.ParseJSON([]byte(`{"server":{"httpPort":4000}}`))
	if err != nil {
		t.Fatal(err)
	}
	path, err := writeRuntimeConfig(t.TempDir(), document.YAML)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != "erpc.yaml" || len(data) == 0 {
		t.Fatalf("runtime config path=%q data=%q", path, data)
	}
}

func TestWriteRuntimeConfigReturnsAbsolutePathForRelativeDirectory(t *testing.T) {
	workingDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	absoluteDir, err := os.MkdirTemp(workingDir, ".runtime-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(absoluteDir)
	runtimeDir, err := filepath.Rel(workingDir, absoluteDir)
	if err != nil {
		t.Fatal(err)
	}
	path, err := writeRuntimeConfig(runtimeDir, []byte("{}\n"))
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(path) {
		t.Fatalf("runtime config path must be absolute, got %q", path)
	}
}

func TestStatusComparesRunningAndLatestRevision(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	started := time.Now().UTC()
	created := started.Add(-time.Minute)
	mock.ExpectQuery("SELECT pid, process_started_at").WillReturnRows(sqlmock.NewRows([]string{"pid", "process_started_at", "running_revision", "binary_version", "binary_commit", "last_error"}).AddRow(4242, started, 1, "dev", "", ""))
	mock.ExpectQuery("SELECT revision, payload").WillReturnRows(sqlmock.NewRows([]string{"revision", "payload", "content_hash", "created_by", "created_at"}).AddRow(2, []byte(`{"projects":[]}`), "hash", "admin", created))
	original := processIsOwned
	processIsOwned = func(int, time.Time) bool { return true }
	defer func() { processIsOwned = original }()
	manager := NewManager(db, revisions.NewStore(db), configdoc.Validator{}, "erpc.exe", t.TempDir(), time.Second)
	status, err := manager.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if status.State != StateRunning || status.PID != 4242 || status.RunningRevision != 1 || status.LatestRevision != 2 || !status.OutOfDate {
		t.Fatalf("unexpected status: %#v", status)
	}
}

func TestManagedTargetReadsServerAndAdminSecret(t *testing.T) {
	document, err := configdoc.ParseJSON([]byte(`{"server":{"httpHostV4":"0.0.0.0","httpPortV4":4100},"admin":{"auth":{"strategies":[{"type":"secret","secret":{"value":"plain-secret"}}]}}}`))
	if err != nil {
		t.Fatal(err)
	}
	baseURL, token, ok := managedTarget(document)
	if !ok || baseURL != "http://127.0.0.1:4100" || token != "plain-secret" {
		t.Fatalf("baseURL=%q token=%q ok=%v", baseURL, token, ok)
	}
}

func TestManagedTargetDefaultsWhenAdminIsOmitted(t *testing.T) {
	document, err := configdoc.ParseJSON([]byte(`{"projects":[{"id":"main"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	baseURL, token, ok := managedTarget(document)
	if !ok || baseURL != "http://127.0.0.1:4000" || token != "" {
		t.Fatalf("baseURL=%q token=%q ok=%v", baseURL, token, ok)
	}
}

func TestUpdateManagedTargetRegistersWhenAdminIsOmitted(t *testing.T) {
	document, err := configdoc.ParseJSON([]byte(`{"projects":[{"id":"main"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	var targetID, baseURL, token string
	manager := &Manager{}
	manager.SetTargetUpdater(func(id, url, secret string) error {
		targetID, baseURL, token = id, url, secret
		return nil
	}, nil)
	if err := manager.updateManagedTarget(document); err != nil {
		t.Fatal(err)
	}
	if targetID != "local-erpc" || baseURL != "http://127.0.0.1:4000" || token != "" {
		t.Fatalf("targetID=%q baseURL=%q token=%q", targetID, baseURL, token)
	}
}
