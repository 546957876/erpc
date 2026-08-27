package alchemyaccounts

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
)

var nonAlphaNumeric = regexp.MustCompile(`[^a-z0-9]+`)

func ParseImport(text string) (ImportResult, error) {
	decoder := json.NewDecoder(strings.NewReader(text))
	result := ImportResult{Records: make([]Record, 0)}
	seen := make(map[string][]byte)
	decoded := 0
	for {
		var raw json.RawMessage
		err := decoder.Decode(&raw)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return ImportResult{}, fmt.Errorf("第 %d 条 JSON 无效", decoded+1)
		}
		if len(bytes.TrimSpace(raw)) == 0 {
			continue
		}
		items, err := objectItems(raw)
		if err != nil {
			return ImportResult{}, fmt.Errorf("第 %d 条记录必须是 JSON 对象", decoded+1)
		}
		for _, item := range items {
			decoded++
			record, canonical, err := parseRecord(item, decoded)
			if err != nil {
				return ImportResult{}, err
			}
			if previous, ok := seen[record.NormalizedEmail]; ok {
				if bytes.Equal(previous, canonical) {
					result.Skipped++
					continue
				}
				return ImportResult{}, fmt.Errorf("第 %d 条记录与已有邮箱资料冲突", decoded)
			}
			seen[record.NormalizedEmail] = canonical
			result.Records = append(result.Records, record)
		}
	}
	if decoded == 0 {
		return ImportResult{}, errors.New("没有找到可导入的 JSON 记录")
	}
	return result, nil
}

func objectItems(raw json.RawMessage) ([]json.RawMessage, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, errors.New("空 JSON")
	}
	if trimmed[0] != '[' {
		if trimmed[0] != '{' {
			return nil, errors.New("记录不是对象")
		}
		return []json.RawMessage{append(json.RawMessage(nil), trimmed...)}, nil
	}
	var items []json.RawMessage
	if err := json.Unmarshal(trimmed, &items); err != nil {
		return nil, errors.New("JSON 数组无效")
	}
	return items, nil
}

func parseRecord(raw json.RawMessage, index int) (Record, []byte, error) {
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return Record{}, nil, fmt.Errorf("第 %d 条记录必须是 JSON 对象", index)
	}
	email, ok := object["email"].(string)
	if !ok || strings.TrimSpace(email) == "" {
		return Record{}, nil, fmt.Errorf("第 %d 条记录缺少 email", index)
	}
	apiKey, ok := object["api_key"].(string)
	if !ok || strings.TrimSpace(apiKey) == "" {
		return Record{}, nil, fmt.Errorf("第 %d 条记录缺少 api_key", index)
	}
	email = strings.TrimSpace(email)
	normalizedEmail := strings.ToLower(email)
	canonical, err := json.Marshal(object)
	if err != nil {
		return Record{}, nil, fmt.Errorf("第 %d 条记录无法保存", index)
	}
	comparison := make(map[string]any, len(object))
	for key, value := range object {
		comparison[key] = value
	}
	comparison["email"] = normalizedEmail
	comparable, err := json.Marshal(comparison)
	if err != nil {
		return Record{}, nil, fmt.Errorf("第 %d 条记录无法比较", index)
	}
	return Record{
		Email:           email,
		NormalizedEmail: normalizedEmail,
		Name:            email,
		ProviderID:      stableProviderID(normalizedEmail),
		APIKey:          apiKey,
		Payload:         append(json.RawMessage(nil), canonical...),
	}, comparable, nil
}

func stableProviderID(normalizedEmail string) string {
	slug := nonAlphaNumeric.ReplaceAllString(normalizedEmail, "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		slug = "account"
	}
	hash := sha256.Sum256([]byte(normalizedEmail))
	return "alchemy-" + slug + "-" + hex.EncodeToString(hash[:])[:8]
}
