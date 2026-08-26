package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadManagedRuntimeConfig(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "erpc.exe")
	if err := os.WriteFile(binary, []byte("test binary"), 0o600); err != nil {
		t.Fatal(err)
	}
	data := "listen: 127.0.0.1:8090\ndatabaseUrlEnv: ERPC_ADMIN_DATABASE_URL\nerpcBinary: " + filepath.ToSlash(binary) + "\nruntimeDir: data/runtime\npollInterval: 10s\nshutdownTimeout: 15s\n"
	cfg, err := Load([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := cfg.Resolve(func(key string) (string, bool) {
		return "postgres://admin:admin@127.0.0.1:5432/erpc_admin?sslmode=disable", key == "ERPC_ADMIN_DATABASE_URL"
	})
	if err != nil {
		t.Fatal(err)
	}
	if !runtime.Managed || runtime.DatabaseURL == "" || runtime.ShutdownTimeout.String() != "15s" {
		t.Fatalf("unexpected managed runtime: %#v", runtime)
	}
}

func TestLoadManagedRuntimeConfigUsesDirectDatabaseURL(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "erpc.exe")
	if err := os.WriteFile(binary, []byte("test binary"), 0o600); err != nil {
		t.Fatal(err)
	}
	data := "databaseUrl: postgres://file@127.0.0.1/erpc_admin\nerpcBinary: " + filepath.ToSlash(binary) + "\n"
	cfg, err := Load([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := cfg.Resolve(func(string) (string, bool) { return "", false })
	if err != nil {
		t.Fatal(err)
	}
	if runtime.DatabaseURL != "postgres://file@127.0.0.1/erpc_admin" {
		t.Fatalf("database URL = %q", runtime.DatabaseURL)
	}
	runtime, err = cfg.Resolve(func(key string) (string, bool) {
		return "postgres://environment@127.0.0.1/erpc_admin", key == "ERPC_ADMIN_DATABASE_URL"
	})
	if err != nil {
		t.Fatal(err)
	}
	if runtime.DatabaseURL != "postgres://environment@127.0.0.1/erpc_admin" {
		t.Fatalf("environment override = %q", runtime.DatabaseURL)
	}
}

func TestLoadAndResolve(t *testing.T) {
	cfg, err := Load([]byte(`listen: 127.0.0.1:9000
pollInterval: 2s
authFile: var/admin-auth.json
targets:
  - id: local
    baseUrl: http://127.0.0.1:4000/
    adminTokenEnv: ERPC_TOKEN
`))
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := cfg.Resolve(func(key string) (string, bool) {
		values := map[string]string{"ERPC_TOKEN": "secret"}
		value, ok := values[key]
		return value, ok
	})
	if err != nil || runtime.PollInterval.String() != "2s" || runtime.AuthFile != "var/admin-auth.json" || runtime.Targets[0].BaseURL != "http://127.0.0.1:4000" {
		t.Fatalf("unexpected runtime config: %#v, err=%v", runtime, err)
	}
}

func TestLoadDefaultsAuthFile(t *testing.T) {
	cfg, err := Load([]byte(`targets:
  - id: local
    baseUrl: http://127.0.0.1:4000
    adminTokenEnv: ERPC_TOKEN
`))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AuthFile != "data/admin-auth.json" {
		t.Fatalf("auth file = %q", cfg.AuthFile)
	}
}

func TestLoadRejectsDuplicateTarget(t *testing.T) {
	_, err := Load([]byte(`targets:
  - id: same
    baseUrl: http://one.example
    adminTokenEnv: TOKEN
  - id: same
    baseUrl: http://two.example
    adminTokenEnv: TOKEN
`))
	if err == nil {
		t.Fatal("expected duplicate target error")
	}
}
