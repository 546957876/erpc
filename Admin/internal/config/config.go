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
	Listen       string
	PollInterval time.Duration
	WebTokenEnv  string
	Targets      []Target
}

type fileConfig struct {
	Listen       string   `yaml:"listen"`
	PollInterval string   `yaml:"pollInterval"`
	WebTokenEnv  string   `yaml:"webTokenEnv"`
	Targets      []Target `yaml:"targets"`
}

type ResolvedTarget struct {
	ID      string
	BaseURL string
	Token   string
}

type RuntimeConfig struct {
	Listen       string
	PollInterval time.Duration
	WebToken     string
	Targets      []ResolvedTarget
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
	return Config{Listen: listen, PollInterval: interval, WebTokenEnv: strings.TrimSpace(raw.WebTokenEnv), Targets: raw.Targets}, nil
}

func LoadFile(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read admin config %q: %w", path, err)
	}
	return Load(data)
}

func (c Config) Resolve(lookup func(string) (string, bool)) (RuntimeConfig, error) {
	runtime := RuntimeConfig{Listen: c.Listen, PollInterval: c.PollInterval}
	if c.WebTokenEnv != "" {
		if token, ok := lookup(c.WebTokenEnv); ok {
			runtime.WebToken = token
		}
	}
	for _, target := range c.Targets {
		token, ok := lookup(target.AdminTokenEnv)
		if !ok || strings.TrimSpace(token) == "" {
			return RuntimeConfig{}, fmt.Errorf("target %q token environment %q is not set", target.ID, target.AdminTokenEnv)
		}
		runtime.Targets = append(runtime.Targets, ResolvedTarget{ID: target.ID, BaseURL: target.BaseURL, Token: token})
	}
	return runtime, nil
}
