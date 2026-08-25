package config

import "testing"

func TestLoadAndResolve(t *testing.T) {
	cfg, err := Load([]byte(`listen: 127.0.0.1:9000
pollInterval: 2s
webTokenEnv: ADMIN_WEB_TOKEN
targets:
  - id: local
    baseUrl: http://127.0.0.1:4000/
    adminTokenEnv: ERPC_TOKEN
`))
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := cfg.Resolve(func(key string) (string, bool) {
		values := map[string]string{"ERPC_TOKEN": "secret", "ADMIN_WEB_TOKEN": "web"}
		value, ok := values[key]
		return value, ok
	})
	if err != nil || runtime.PollInterval.String() != "2s" || runtime.Targets[0].BaseURL != "http://127.0.0.1:4000" {
		t.Fatalf("unexpected runtime config: %#v, err=%v", runtime, err)
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
