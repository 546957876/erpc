package configdoc

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type Document struct {
	Payload json.RawMessage
	YAML    []byte
	Hash    string
}

type preciseNumber string

func (n preciseNumber) MarshalJSON() ([]byte, error) {
	return []byte(n), nil
}

func (n preciseNumber) MarshalYAML() (any, error) {
	tag := "!!int"
	if strings.ContainsAny(string(n), ".eE") {
		tag = "!!float"
	}
	return &yaml.Node{Kind: yaml.ScalarNode, Tag: tag, Value: string(n)}, nil
}

func ParseYAML(data []byte) (Document, error) {
	var document yaml.Node
	decoder := yaml.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(&document); err != nil {
		return Document{}, fmt.Errorf("parse eRPC YAML: %w", err)
	}
	value, err := yamlValue(&document)
	if err != nil {
		return Document{}, err
	}
	normalized, err := normalize(value)
	if err != nil {
		return Document{}, err
	}
	return build(normalized)
}

var jsonNumberPattern = regexp.MustCompile(`^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$`)

func yamlValue(node *yaml.Node) (any, error) {
	if node == nil {
		return nil, nil
	}
	switch node.Kind {
	case yaml.DocumentNode:
		if len(node.Content) == 0 {
			return nil, nil
		}
		return yamlValue(node.Content[0])
	case yaml.AliasNode:
		return yamlValue(node.Alias)
	case yaml.MappingNode:
		result := make(map[string]any, len(node.Content)/2)
		for index := 0; index+1 < len(node.Content); index += 2 {
			keyValue, err := yamlValue(node.Content[index])
			if err != nil {
				return nil, err
			}
			key, ok := keyValue.(string)
			if !ok {
				return nil, fmt.Errorf("eRPC configuration key %v is not a string", keyValue)
			}
			item, err := yamlValue(node.Content[index+1])
			if err != nil {
				return nil, err
			}
			result[key] = item
		}
		return result, nil
	case yaml.SequenceNode:
		result := make([]any, len(node.Content))
		for index, child := range node.Content {
			item, err := yamlValue(child)
			if err != nil {
				return nil, err
			}
			result[index] = item
		}
		return result, nil
	case yaml.ScalarNode:
		switch node.Tag {
		case "!!null":
			return nil, nil
		case "!!int", "!!float":
			if number, ok := yamlJSONNumber(node.Value); ok {
				return preciseNumber(number), nil
			}
		}
		var value any
		if err := node.Decode(&value); err != nil {
			return nil, fmt.Errorf("decode eRPC YAML scalar: %w", err)
		}
		return value, nil
	default:
		return nil, fmt.Errorf("unsupported eRPC YAML node kind %d", node.Kind)
	}
}

func yamlJSONNumber(raw string) (string, bool) {
	value := strings.TrimSpace(raw)
	if strings.HasPrefix(value, "+") {
		value = value[1:]
	}
	if strings.HasPrefix(value, ".") {
		value = "0" + value
	} else if strings.HasPrefix(value, "-.") {
		value = "-0" + value[1:]
	}
	if !jsonNumberPattern.MatchString(value) {
		return "", false
	}
	if _, err := strconv.ParseFloat(value, 64); err != nil && !strings.ContainsAny(value, ".eE") {
		// Keep arbitrarily large integers as precise JSON numbers.
		return value, true
	}
	return value, true
}

func ParseJSON(data []byte) (Document, error) {
	value, err := decodeJSON(data)
	if err != nil {
		return Document{}, err
	}
	normalized, err := normalize(value)
	if err != nil {
		return Document{}, err
	}
	return build(normalized)
}

func Overlay(effective Document, overrides Document) (Document, error) {
	base, err := decodeJSON(effective.Payload)
	if err != nil {
		return Document{}, fmt.Errorf("decode effective eRPC configuration: %w", err)
	}
	override, err := decodeJSON(overrides.Payload)
	if err != nil {
		return Document{}, fmt.Errorf("decode eRPC configuration overrides: %w", err)
	}
	merged, err := normalize(merge(base, override))
	if err != nil {
		return Document{}, err
	}
	return build(merged)
}

func decodeJSON(data []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("parse eRPC JSON: %w", err)
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("parse eRPC JSON: multiple values are not allowed")
	}
	return value, nil
}

func merge(effective, overrides any) any {
	effectiveObject, effectiveOK := effective.(map[string]any)
	overrideObject, overrideOK := overrides.(map[string]any)
	if !effectiveOK || !overrideOK {
		return overrides
	}
	merged := make(map[string]any, len(effectiveObject)+len(overrideObject))
	for key, value := range effectiveObject {
		merged[key] = value
	}
	for key, value := range overrideObject {
		if current, ok := merged[key]; ok {
			merged[key] = merge(current, value)
		} else {
			merged[key] = value
		}
	}
	return merged
}

func build(value any) (Document, error) {
	if value == nil {
		return Document{}, fmt.Errorf("eRPC configuration must not be empty")
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return Document{}, fmt.Errorf("encode eRPC JSON: %w", err)
	}
	yamlData, err := yaml.Marshal(value)
	if err != nil {
		return Document{}, fmt.Errorf("encode eRPC YAML: %w", err)
	}
	hash := sha256.Sum256(payload)
	return Document{Payload: payload, YAML: yamlData, Hash: hex.EncodeToString(hash[:])}, nil
}

func normalize(value any) (any, error) {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			normalized, err := normalize(item)
			if err != nil {
				return nil, err
			}
			result[key] = normalized
		}
		return result, nil
	case map[any]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			text, ok := key.(string)
			if !ok {
				return nil, fmt.Errorf("eRPC configuration key %v is not a string", key)
			}
			normalized, err := normalize(item)
			if err != nil {
				return nil, err
			}
			result[text] = normalized
		}
		return result, nil
	case []any:
		result := make([]any, len(typed))
		for index, item := range typed {
			normalized, err := normalize(item)
			if err != nil {
				return nil, err
			}
			result[index] = normalized
		}
		return result, nil
	case json.Number:
		return preciseNumber(typed), nil
	case preciseNumber:
		return typed, nil
	default:
		return value, nil
	}
}
