package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type Target struct {
	ID            string `yaml:"id"`
	BaseURL       string `yaml:"baseUrl"`
	AdminTokenEnv string `yaml:"adminTokenEnv"`
}

type Config struct {
	Listen          string
	PollInterval    time.Duration
	DatabaseURL     string
	DatabaseURLEnv  string
	ERPCBinary      string
	RuntimeDir      string
	ShutdownTimeout time.Duration
	AuthFile        string
	Targets         []Target
	managed         bool
}

type fileConfig struct {
	Listen          string   `yaml:"listen"`
	PollInterval    string   `yaml:"pollInterval"`
	DatabaseURL     string   `yaml:"databaseUrl"`
	DatabaseURLEnv  string   `yaml:"databaseUrlEnv"`
	ERPCBinary      string   `yaml:"erpcBinary"`
	RuntimeDir      string   `yaml:"runtimeDir"`
	ShutdownTimeout string   `yaml:"shutdownTimeout"`
	AuthFile        string   `yaml:"authFile"`
	Targets         []Target `yaml:"targets"`
}

type ResolvedTarget struct {
	ID      string
	BaseURL string
	Token   string
}

type RuntimeConfig struct {
	Listen          string
	PollInterval    time.Duration
	DatabaseURL     string
	ERPCBinary      string
	RuntimeDir      string
	ShutdownTimeout time.Duration
	AuthFile        string
	LegacyAuthFile  string
	Targets         []ResolvedTarget
	Managed         bool
}

func Load(data []byte) (Config, error) {
	var raw fileConfig
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return Config{}, fmt.Errorf("parse admin config: %w", err)
	}
	listen := strings.TrimSpace(raw.Listen)
	if listen == "" {
		listen = "127.0.0.1:8090"
	}
	interval := 10 * time.Second
	if strings.TrimSpace(raw.PollInterval) != "" {
		parsed, err := time.ParseDuration(strings.TrimSpace(raw.PollInterval))
		if err != nil || parsed <= 0 {
			return Config{}, fmt.Errorf("pollInterval must be a positive duration")
		}
		interval = parsed
	}
	managed := strings.TrimSpace(raw.DatabaseURL) != "" || strings.TrimSpace(raw.DatabaseURLEnv) != "" || strings.TrimSpace(raw.ERPCBinary) != "" || strings.TrimSpace(raw.RuntimeDir) != "" || strings.TrimSpace(raw.ShutdownTimeout) != ""
	if managed {
		databaseEnv := strings.TrimSpace(raw.DatabaseURLEnv)
		if databaseEnv == "" {
			databaseEnv = "ERPC_ADMIN_DATABASE_URL"
		}
		binary := strings.TrimSpace(raw.ERPCBinary)
		if binary == "" {
			return Config{}, fmt.Errorf("erpcBinary is required for managed runtime")
		}
		runtimeDir := strings.TrimSpace(raw.RuntimeDir)
		if runtimeDir == "" {
			runtimeDir = "data/runtime"
		}
		shutdownTimeout := 15 * time.Second
		if strings.TrimSpace(raw.ShutdownTimeout) != "" {
			parsed, err := time.ParseDuration(strings.TrimSpace(raw.ShutdownTimeout))
			if err != nil || parsed <= 0 {
				return Config{}, fmt.Errorf("shutdownTimeout must be a positive duration")
			}
			shutdownTimeout = parsed
		}
		return Config{Listen: listen, PollInterval: interval, DatabaseURL: strings.TrimSpace(raw.DatabaseURL), DatabaseURLEnv: databaseEnv, ERPCBinary: binary, RuntimeDir: runtimeDir, ShutdownTimeout: shutdownTimeout, AuthFile: strings.TrimSpace(raw.AuthFile), managed: true}, nil
	}
	if len(raw.Targets) == 0 {
		return Config{}, fmt.Errorf("at least one target is required")
	}
	seen := make(map[string]struct{}, len(raw.Targets))
	for i := range raw.Targets {
		t := &raw.Targets[i]
		t.ID = strings.TrimSpace(t.ID)
		t.BaseURL = strings.TrimRight(strings.TrimSpace(t.BaseURL), "/")
		t.AdminTokenEnv = strings.TrimSpace(t.AdminTokenEnv)
		if t.ID == "" || t.BaseURL == "" || t.AdminTokenEnv == "" {
			return Config{}, fmt.Errorf("target %d requires id, baseUrl, and adminTokenEnv", i)
		}
		if _, ok := seen[t.ID]; ok {
			return Config{}, fmt.Errorf("duplicate target id %q", t.ID)
		}
		seen[t.ID] = struct{}{}
		u, err := url.Parse(t.BaseURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.RawQuery != "" || u.Fragment != "" {
			return Config{}, fmt.Errorf("target %q baseUrl must be an absolute http(s) URL without query or fragment", t.ID)
		}
	}
	authFile := strings.TrimSpace(raw.AuthFile)
	if authFile == "" {
		authFile = "data/admin-auth.json"
	}
	return Config{Listen: listen, PollInterval: interval, AuthFile: authFile, Targets: raw.Targets}, nil
}

func LoadFile(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read admin config %q: %w", path, err)
	}
	return Load(data)
}

func (c Config) Resolve(lookup func(string) (string, bool)) (RuntimeConfig, error) {
	if c.managed {
		databaseURL := c.DatabaseURL
		if value, ok := lookup(c.DatabaseURLEnv); ok && strings.TrimSpace(value) != "" {
			databaseURL = strings.TrimSpace(value)
		}
		if databaseURL == "" {
			return RuntimeConfig{}, fmt.Errorf("database URL is not configured; set databaseUrl or environment %q", c.DatabaseURLEnv)
		}
		if _, err := os.Stat(c.ERPCBinary); err != nil {
			return RuntimeConfig{}, fmt.Errorf("eRPC binary %q is not available: %w", c.ERPCBinary, err)
		}
		return RuntimeConfig{Listen: c.Listen, PollInterval: c.PollInterval, DatabaseURL: databaseURL, ERPCBinary: c.ERPCBinary, RuntimeDir: c.RuntimeDir, ShutdownTimeout: c.ShutdownTimeout, AuthFile: c.AuthFile, LegacyAuthFile: c.AuthFile, Managed: true}, nil
	}
	runtime := RuntimeConfig{Listen: c.Listen, PollInterval: c.PollInterval, AuthFile: c.AuthFile, LegacyAuthFile: c.AuthFile}
	for _, target := range c.Targets {
		token, ok := lookup(target.AdminTokenEnv)
		if !ok || strings.TrimSpace(token) == "" {
			return RuntimeConfig{}, fmt.Errorf("target %q token environment %q is not set", target.ID, target.AdminTokenEnv)
		}
		runtime.Targets = append(runtime.Targets, ResolvedTarget{ID: target.ID, BaseURL: target.BaseURL, Token: token})
	}
	return runtime, nil
}
