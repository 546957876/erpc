package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/erpc/admin/internal/alchemyaccounts"
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
