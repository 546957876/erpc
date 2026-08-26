package configdoc

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

type ValidationResult struct {
	Valid    bool            `json:"valid"`
	Errors   []string        `json:"errors"`
	Warnings []string        `json:"warnings"`
	Notices  []string        `json:"notices"`
	Report   json.RawMessage `json:"report"`
}

type Validator struct {
	Binary     string
	RuntimeDir string
	run        func(context.Context, string) ([]byte, error)
	dump       func(context.Context, string) ([]byte, error)
}

func (v Validator) Validate(ctx context.Context, document Document) (ValidationResult, error) {
	run := v.run
	if run == nil {
		if strings.TrimSpace(v.Binary) == "" {
			return ValidationResult{}, fmt.Errorf("eRPC binary is required for validation")
		}
		run = func(ctx context.Context, path string) ([]byte, error) {
			return exec.CommandContext(ctx, v.Binary, "--config", path, "validate", "--format", "json").CombinedOutput()
		}
	}
	output, commandErr, err := v.runDocument(ctx, document, "validate", run)
	if err != nil {
		return ValidationResult{}, err
	}
	var report struct {
		Errors   []string `json:"errors"`
		Warnings []string `json:"warnings"`
		Notices  []string `json:"notices"`
	}
	if err := json.Unmarshal(output, &report); err != nil {
		if commandErr != nil {
			return ValidationResult{}, fmt.Errorf("run eRPC validation: %w", commandErr)
		}
		return ValidationResult{}, fmt.Errorf("decode eRPC validation report: %w", err)
	}
	// Keep collection fields as JSON arrays even when eRPC omits them. The
	// Admin Web renders these lists after every validation/save; null would
	// otherwise turn a valid response into a client-side render failure.
	errors := append([]string{}, report.Errors...)
	warnings := append([]string{}, report.Warnings...)
	notices := append([]string{}, report.Notices...)
	result := ValidationResult{Valid: len(errors) == 0, Errors: errors, Warnings: warnings, Notices: notices, Report: append(json.RawMessage(nil), output...)}
	if commandErr != nil && result.Valid {
		return ValidationResult{}, fmt.Errorf("run eRPC validation: %w", commandErr)
	}
	return result, nil
}

func (v Validator) Dump(ctx context.Context, document Document) (Document, error) {
	run := v.dump
	if run == nil {
		if strings.TrimSpace(v.Binary) == "" {
			return Document{}, fmt.Errorf("eRPC binary is required for dump")
		}
		run = func(ctx context.Context, path string) ([]byte, error) {
			return exec.CommandContext(ctx, v.Binary, "--config", path, "dump", "--format", "json").CombinedOutput()
		}
	}
	output, commandErr, err := v.runDocument(ctx, document, "dump", run)
	if err != nil {
		return Document{}, err
	}
	if commandErr != nil {
		return Document{}, fmt.Errorf("run eRPC dump: %w", commandErr)
	}
	dumped, err := ParseJSON(output)
	if err != nil {
		return Document{}, fmt.Errorf("decode eRPC dump: %w", err)
	}
	dumped, err = stripGeneratedProviderSettingsRedactions(dumped)
	if err != nil {
		return Document{}, fmt.Errorf("sanitize eRPC dump: %w", err)
	}
	effective, err := Overlay(dumped, document)
	if err != nil {
		return Document{}, fmt.Errorf("overlay eRPC dump: %w", err)
	}
	return effective, nil
}

func stripGeneratedProviderSettingsRedactions(document Document) (Document, error) {
	value, err := decodeJSON(document.Payload)
	if err != nil {
		return Document{}, err
	}
	root, ok := value.(map[string]any)
	if !ok {
		return document, nil
	}
	projects, ok := root["projects"].([]any)
	if !ok {
		return document, nil
	}
	changed := false
	for _, projectValue := range projects {
		project, ok := projectValue.(map[string]any)
		if !ok {
			continue
		}
		providers, ok := project["providers"].([]any)
		if !ok {
			continue
		}
		for _, providerValue := range providers {
			provider, ok := providerValue.(map[string]any)
			if !ok {
				continue
			}
			settings, ok := provider["settings"].(string)
			if ok && settings == "REDACTED" {
				delete(provider, "settings")
				changed = true
			}
		}
	}
	if !changed {
		return document, nil
	}
	normalized, err := normalize(root)
	if err != nil {
		return Document{}, err
	}
	return build(normalized)
}

func (v Validator) runDocument(ctx context.Context, document Document, operation string, run func(context.Context, string) ([]byte, error)) ([]byte, error, error) {
	if err := os.MkdirAll(v.RuntimeDir, 0o700); err != nil {
		return nil, nil, fmt.Errorf("create eRPC runtime directory: %w", err)
	}
	file, err := os.CreateTemp(v.RuntimeDir, operation+"-*.yaml")
	if err != nil {
		return nil, nil, fmt.Errorf("create eRPC %s file: %w", operation, err)
	}
	path := file.Name()
	defer os.Remove(path)
	if _, err := file.Write(document.YAML); err != nil {
		_ = file.Close()
		return nil, nil, fmt.Errorf("write eRPC %s file: %w", operation, err)
	}
	if err := file.Close(); err != nil {
		return nil, nil, fmt.Errorf("close eRPC %s file: %w", operation, err)
	}
	output, commandErr := run(ctx, path)
	return output, commandErr, nil
}
