package server

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/erpc/admin/internal/alchemyaccounts"
	"github.com/erpc/admin/internal/configdoc"
	"github.com/erpc/admin/internal/revisions"
)

type alchemyImportInput struct {
	Text string `json:"text"`
}

type alchemyAccountUpdateInput struct {
	Email      string          `json:"email"`
	Name       string          `json:"name"`
	ProviderID string          `json:"providerId"`
	APIKey     string          `json:"apiKey"`
	Payload    json.RawMessage `json:"payload"`
}

func (s *Server) handleAlchemyAccounts(w http.ResponseWriter, r *http.Request, path string) {
	if s.managed == nil || s.managed.AlchemyAccounts == nil {
		s.writeError(w, http.StatusNotFound, "接口不存在")
		return
	}
	base := "/api/alchemy/accounts"
	switch {
	case path == base+"/import" && r.Method == http.MethodPost:
		s.importAlchemyAccounts(w, r)
	case path == base && r.Method == http.MethodGet:
		s.listAlchemyAccounts(w, r)
	case strings.HasSuffix(path, "/apply"):
		s.applyAlchemyAccount(w, r, base)
	case strings.HasPrefix(path, base+"/"):
		id, ok := parseAlchemyAccountID(strings.TrimPrefix(path, base+"/"))
		if !ok {
			s.writeError(w, http.StatusBadRequest, "账号标识无效")
			return
		}
		switch r.Method {
		case http.MethodGet:
			s.getAlchemyAccount(w, r, id)
		case http.MethodPatch:
			s.updateAlchemyAccount(w, r, id)
		case http.MethodDelete:
			s.deleteAlchemyAccount(w, r, id)
		default:
			s.writeError(w, http.StatusMethodNotAllowed, "不支持的请求方法")
		}
	default:
		s.writeError(w, http.StatusMethodNotAllowed, "不支持的请求方法")
	}
}

func (s *Server) applyAlchemyAccount(w http.ResponseWriter, r *http.Request, base string) {
	if r.Method != http.MethodPost {
		s.writeError(w, http.StatusMethodNotAllowed, "不支持的请求方法")
		return
	}
	suffix := strings.TrimPrefix(strings.TrimSuffix(r.URL.Path, "/"), base+"/")
	parts := strings.Split(suffix, "/")
	if len(parts) != 2 || parts[1] != "apply" {
		s.writeError(w, http.StatusBadRequest, "账号标识无效")
		return
	}
	id, ok := parseAlchemyAccountID(parts[0])
	if !ok {
		s.writeError(w, http.StatusBadRequest, "账号标识无效")
		return
	}
	var input struct {
		ProjectID   string   `json:"projectId"`
		NetworkMode string   `json:"networkMode"`
		Networks    []string `json:"networks"`
	}
	if err := s.decodeBody(r, &input); err != nil || strings.TrimSpace(input.ProjectID) == "" {
		s.writeError(w, http.StatusBadRequest, "项目和网络范围无效")
		return
	}
	if input.NetworkMode == "" {
		input.NetworkMode = "all"
	}
	if input.NetworkMode != "all" && input.NetworkMode != "only" && input.NetworkMode != "ignore" {
		s.writeError(w, http.StatusBadRequest, "网络范围模式无效")
		return
	}
	if input.NetworkMode != "all" && len(input.Networks) == 0 {
		s.writeError(w, http.StatusBadRequest, "请至少选择一个网络")
		return
	}
	if input.NetworkMode != "all" {
		networks := make([]string, 0, len(input.Networks))
		seen := make(map[string]struct{}, len(input.Networks))
		for _, network := range input.Networks {
			network = strings.TrimSpace(network)
			if network == "" {
				continue
			}
			if _, exists := seen[network]; !exists {
				seen[network] = struct{}{}
				networks = append(networks, network)
			}
		}
		if len(networks) == 0 {
			s.writeError(w, http.StatusBadRequest, "请至少选择一个网络")
			return
		}
		input.Networks = networks
	}
	account, err := s.managed.AlchemyAccounts.Get(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		s.writeError(w, http.StatusNotFound, "Alchemy 账号不存在")
		return
	}
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法读取 Alchemy 账号")
		return
	}
	latest, err := s.managed.Revisions.Latest(r.Context())
	if errors.Is(err, sql.ErrNoRows) {
		s.writeError(w, http.StatusConflict, "请先保存一份基础配置")
		return
	}
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法读取当前配置")
		return
	}
	var root map[string]any
	if err := json.Unmarshal(latest.Payload, &root); err != nil {
		s.writeError(w, http.StatusInternalServerError, "当前配置内容无效")
		return
	}
	projects, ok := root["projects"].([]any)
	if !ok {
		s.writeError(w, http.StatusNotFound, "项目不存在")
		return
	}
	projectIndex := -1
	for index, raw := range projects {
		project, _ := raw.(map[string]any)
		if project["id"] == input.ProjectID {
			if projectIndex >= 0 {
				s.writeError(w, http.StatusConflict, "项目标识重复，无法应用账号")
				return
			}
			projectIndex = index
		}
	}
	if projectIndex < 0 {
		s.writeError(w, http.StatusNotFound, "项目不存在")
		return
	}
	project := projects[projectIndex].(map[string]any)
	providers, _ := project["providers"].([]any)
	provider := map[string]any{"id": account.ProviderID, "vendor": "alchemy", "upstreamIdTemplate": "<PROVIDER>-<NETWORK>", "settings": map[string]any{"apiKey": account.APIKey}}
	if input.NetworkMode == "only" {
		provider["onlyNetworks"] = input.Networks
	} else if input.NetworkMode == "ignore" {
		provider["ignoreNetworks"] = input.Networks
	}
	updated := false
	for index, raw := range providers {
		item, _ := raw.(map[string]any)
		if item["id"] == account.ProviderID {
			preserved := make(map[string]any, len(item)+4)
			for key, value := range item {
				preserved[key] = value
			}
			preserved["id"] = account.ProviderID
			preserved["vendor"] = "alchemy"
			preserved["upstreamIdTemplate"] = "<PROVIDER>-<NETWORK>"
			settings := map[string]any{}
			if existing, ok := item["settings"].(map[string]any); ok {
				for key, value := range existing {
					settings[key] = value
				}
			}
			settings["apiKey"] = account.APIKey
			preserved["settings"] = settings
			delete(preserved, "onlyNetworks")
			delete(preserved, "ignoreNetworks")
			for key, value := range provider {
				if key != "settings" {
					preserved[key] = value
				}
			}
			providers[index] = preserved
			updated = true
			break
		}
	}
	if !updated {
		providers = append(providers, provider)
	}
	project["providers"] = providers
	projects[projectIndex] = project
	root["projects"] = projects
	payload, err := json.Marshal(root)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "生成配置失败")
		return
	}
	document, err := configdoc.ParseJSON(payload)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "生成配置失败")
		return
	}
	if bytes.Equal(document.Payload, latest.Payload) {
		s.writeJSON(w, http.StatusOK, latest)
		return
	}
	validation, err := s.managed.Validator.Validate(r.Context(), document)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法校验 eRPC 配置")
		return
	}
	if !validation.Valid {
		s.writeJSON(w, http.StatusUnprocessableEntity, validation)
		return
	}
	revision, err := s.managed.Revisions.Create(r.Context(), document, "administrator", latest.Revision)
	if errors.Is(err, revisions.ErrConflict) {
		s.writeError(w, http.StatusConflict, "配置已被更新，请刷新后重试")
	} else if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法保存配置版本")
	} else {
		s.writeJSON(w, http.StatusCreated, revision)
	}
}

func (s *Server) importAlchemyAccounts(w http.ResponseWriter, r *http.Request) {
	var input alchemyImportInput
	if err := s.decodeBody(r, &input); err != nil || strings.TrimSpace(input.Text) == "" {
		s.writeError(w, http.StatusBadRequest, "请输入要导入的 JSON 内容")
		return
	}
	parsed, err := alchemyaccounts.ParseImport(input.Text)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.managed.AlchemyAccounts.Import(r.Context(), parsed.Records)
	if err != nil {
		if errors.Is(err, alchemyaccounts.ErrConflict) {
			s.writeError(w, http.StatusConflict, "存在相同邮箱但内容不同的账号，未导入任何记录")
		} else {
			s.writeError(w, http.StatusInternalServerError, "无法保存 Alchemy 账号")
		}
		return
	}
	result.Skipped += parsed.Skipped
	s.writeJSON(w, http.StatusCreated, map[string]any{"created": result.Created, "skipped": result.Skipped, "accounts": result.Accounts})
}

func (s *Server) listAlchemyAccounts(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 20)
	offset := queryInt(r, "offset", 0)
	accounts, total, err := s.managed.AlchemyAccounts.List(r.Context(), limit, offset)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法读取 Alchemy 账号")
		return
	}
	items := make([]map[string]any, 0, len(accounts))
	for _, account := range accounts {
		items = append(items, map[string]any{"id": account.ID, "email": account.Email, "name": account.Name, "providerId": account.ProviderID, "apiKey": account.APIKey, "createdAt": account.CreatedAt, "updatedAt": account.UpdatedAt})
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "limit": limit, "offset": offset})
}

func (s *Server) getAlchemyAccount(w http.ResponseWriter, r *http.Request, id int64) {
	account, err := s.managed.AlchemyAccounts.Get(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		s.writeError(w, http.StatusNotFound, "Alchemy 账号不存在")
		return
	}
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法读取 Alchemy 账号")
		return
	}
	s.writeJSON(w, http.StatusOK, account)
}

func (s *Server) updateAlchemyAccount(w http.ResponseWriter, r *http.Request, id int64) {
	var input alchemyAccountUpdateInput
	if err := s.decodeBody(r, &input); err != nil {
		s.writeError(w, http.StatusBadRequest, "账号内容无效")
		return
	}
	if len(input.Payload) == 0 || string(input.Payload) == "null" {
		s.writeError(w, http.StatusBadRequest, "payload 必须是完整 JSON 对象")
		return
	}
	parsed, err := alchemyaccounts.ParseImport(string(input.Payload))
	if err != nil || len(parsed.Records) != 1 {
		s.writeError(w, http.StatusBadRequest, "payload 必须包含 email 和 api_key")
		return
	}
	record := parsed.Records[0]
	if strings.TrimSpace(input.Email) != "" {
		record.Email = strings.TrimSpace(input.Email)
	}
	if strings.TrimSpace(input.Name) != "" {
		record.Name = strings.TrimSpace(input.Name)
	}
	if strings.TrimSpace(input.ProviderID) != "" {
		record.ProviderID = strings.TrimSpace(input.ProviderID)
	}
	if strings.TrimSpace(input.APIKey) != "" {
		record.APIKey = strings.TrimSpace(input.APIKey)
	}
	var payloadObject map[string]any
	if err := json.Unmarshal(record.Payload, &payloadObject); err != nil {
		s.writeError(w, http.StatusBadRequest, "payload 必须是 JSON 对象")
		return
	}
	payloadObject["email"] = record.Email
	payloadObject["api_key"] = record.APIKey
	updatedPayload, err := json.Marshal(payloadObject)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "payload 内容无效")
		return
	}
	record.Payload = updatedPayload
	account, err := s.managed.AlchemyAccounts.Update(r.Context(), id, record)
	if errors.Is(err, sql.ErrNoRows) {
		s.writeError(w, http.StatusNotFound, "Alchemy 账号不存在")
		return
	}
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法更新 Alchemy 账号")
		return
	}
	s.writeJSON(w, http.StatusOK, account)
}

func (s *Server) deleteAlchemyAccount(w http.ResponseWriter, r *http.Request, id int64) {
	account, err := s.managed.AlchemyAccounts.Get(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		s.writeError(w, http.StatusNotFound, "Alchemy 账号不存在")
		return
	}
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法读取 Alchemy 账号")
		return
	}
	if s.managed.Revisions != nil {
		latest, latestErr := s.managed.Revisions.Latest(r.Context())
		if latestErr == nil && configReferencesAlchemyAccount(latest.Payload, account) {
			s.writeError(w, http.StatusConflict, "该账号仍被最新配置引用，不能删除")
			return
		}
		if latestErr != nil && !errors.Is(latestErr, sql.ErrNoRows) {
			s.writeError(w, http.StatusInternalServerError, "无法检查账号引用")
			return
		}
	}
	if err := s.managed.AlchemyAccounts.Delete(r.Context(), id); errors.Is(err, sql.ErrNoRows) {
		s.writeError(w, http.StatusNotFound, "Alchemy 账号不存在")
	} else if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法删除 Alchemy 账号")
	} else {
		s.writeCORS(w)
		w.WriteHeader(http.StatusNoContent)
	}
}

func parseAlchemyAccountID(value string) (int64, bool) {
	if value == "" || strings.Contains(value, "/") {
		return 0, false
	}
	id, err := strconv.ParseInt(value, 10, 64)
	return id, err == nil && id > 0
}

func queryInt(r *http.Request, key string, fallback int) int {
	value, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil || value < 0 {
		return fallback
	}
	if key == "limit" && value > 100 {
		return 100
	}
	return value
}

func configReferencesAlchemyAccount(payload json.RawMessage, account alchemyaccounts.Account) bool {
	var root struct {
		Projects []struct {
			Providers []struct {
				ID       string `json:"id"`
				Settings struct {
					APIKey string `json:"apiKey"`
				} `json:"settings"`
			} `json:"providers"`
		} `json:"projects"`
	}
	if json.Unmarshal(payload, &root) != nil {
		return false
	}
	for _, project := range root.Projects {
		for _, provider := range project.Providers {
			if provider.ID == account.ProviderID || provider.Settings.APIKey == account.APIKey {
				return true
			}
		}
	}
	return false
}
