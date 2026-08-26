package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/erpc/admin/internal/configdoc"
	"github.com/erpc/admin/internal/revisions"
	adminruntime "github.com/erpc/admin/internal/runtime"
)

type revisionStore interface {
	Create(context.Context, configdoc.Document, string, int64) (revisions.Revision, error)
	Latest(context.Context) (revisions.Revision, error)
	Get(context.Context, int64) (revisions.Revision, error)
	List(context.Context, int) ([]revisions.Revision, error)
}

type configValidator interface {
	Validate(context.Context, configdoc.Document) (configdoc.ValidationResult, error)
	Dump(context.Context, configdoc.Document) (configdoc.Document, error)
}

type runtimeController interface {
	Status(context.Context) (adminruntime.Status, error)
	Start(context.Context) (adminruntime.Status, error)
	Stop(context.Context) (adminruntime.Status, error)
	Restart(context.Context) (adminruntime.Status, error)
}

type ManagedDependencies struct {
	Revisions revisionStore
	Validator configValidator
	Defaults  configdoc.Document
	Runtime   runtimeController
}

type configInput struct {
	YAML         string          `json:"yaml"`
	Payload      json.RawMessage `json:"payload"`
	BaseRevision int64           `json:"baseRevision"`
}

func (s *Server) handleManaged(w http.ResponseWriter, r *http.Request) bool {
	path := strings.TrimSuffix(r.URL.Path, "/")
	switch {
	case path == "/api/runtime" && r.Method == http.MethodGet:
		status, err := s.managed.Runtime.Status(r.Context())
		s.respondManaged(w, status, err)
		return true
	case strings.HasPrefix(path, "/api/runtime/") && r.Method == http.MethodPost:
		var status adminruntime.Status
		var err error
		switch strings.TrimPrefix(path, "/api/runtime/") {
		case "start":
			status, err = s.managed.Runtime.Start(r.Context())
		case "stop":
			status, err = s.managed.Runtime.Stop(r.Context())
		case "restart":
			status, err = s.managed.Runtime.Restart(r.Context())
		default:
			s.writeError(w, http.StatusNotFound, "接口不存在")
			return true
		}
		s.respondManaged(w, status, err)
		return true
	case path == "/api/config/validate" && r.Method == http.MethodPost:
		document, _, ok := s.decodeConfigInput(w, r)
		if !ok {
			return true
		}
		result, err := s.managed.Validator.Validate(r.Context(), document)
		if err != nil {
			s.writeError(w, http.StatusInternalServerError, "无法校验 eRPC 配置")
		} else {
			s.writeJSON(w, http.StatusOK, result)
		}
		return true
	case path == "/api/config/current" && r.Method == http.MethodGet:
		revision, err := s.managed.Revisions.Latest(r.Context())
		if errors.Is(err, sql.ErrNoRows) {
			s.writeJSON(w, http.StatusOK, map[string]int64{"revision": 0})
		} else if err != nil {
			s.writeError(w, http.StatusInternalServerError, "无法读取当前配置")
		} else {
			s.writeCurrentRevision(w, r, revision)
		}
		return true
	case path == "/api/config/revisions" && r.Method == http.MethodGet:
		items, err := s.managed.Revisions.List(r.Context(), 50)
		if err != nil {
			s.writeError(w, http.StatusInternalServerError, "无法读取配置版本")
		} else {
			s.writeJSON(w, http.StatusOK, items)
		}
		return true
	case path == "/api/config/revisions" && r.Method == http.MethodPost:
		document, input, ok := s.decodeConfigInput(w, r)
		if !ok {
			return true
		}
		s.createRevision(w, r, document, input.BaseRevision)
		return true
	case strings.HasPrefix(path, "/api/config/revisions/"):
		s.handleRevision(w, r, strings.TrimPrefix(path, "/api/config/revisions/"))
		return true
	case strings.HasPrefix(path, "/api/config/") || strings.HasPrefix(path, "/api/runtime"):
		s.writeError(w, http.StatusNotFound, "接口不存在")
		return true
	default:
		return false
	}
}

func (s *Server) decodeConfigInput(w http.ResponseWriter, r *http.Request) (configdoc.Document, configInput, bool) {
	var input configInput
	if err := s.decodeBody(r, &input); err != nil {
		s.writeError(w, http.StatusBadRequest, "配置请求无效")
		return configdoc.Document{}, input, false
	}
	var document configdoc.Document
	var err error
	if strings.TrimSpace(input.YAML) != "" {
		document, err = configdoc.ParseYAML([]byte(input.YAML))
	} else if len(input.Payload) > 0 && string(input.Payload) != "null" {
		document, err = configdoc.ParseJSON(input.Payload)
	} else {
		err = fmt.Errorf("yaml or payload is required")
	}
	if err != nil {
		s.writeError(w, http.StatusBadRequest, err.Error())
		return configdoc.Document{}, input, false
	}
	return document, input, true
}

func (s *Server) createRevision(w http.ResponseWriter, r *http.Request, document configdoc.Document, baseRevision int64) {
	validation, err := s.managed.Validator.Validate(r.Context(), document)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法校验 eRPC 配置")
		return
	}
	if !validation.Valid {
		s.writeJSON(w, http.StatusUnprocessableEntity, validation)
		return
	}
	revision, err := s.managed.Revisions.Create(r.Context(), document, "administrator", baseRevision)
	if errors.Is(err, revisions.ErrConflict) {
		s.writeError(w, http.StatusConflict, "配置已被更新，请刷新后重试")
	} else if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法保存配置版本")
	} else {
		s.writeJSON(w, http.StatusCreated, revision)
	}
}

func (s *Server) handleRevision(w http.ResponseWriter, r *http.Request, suffix string) {
	restore := strings.HasSuffix(suffix, "/restore")
	idText := strings.TrimSuffix(suffix, "/restore")
	id, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || id <= 0 {
		s.writeError(w, http.StatusBadRequest, "配置版本号无效")
		return
	}
	source, err := s.managed.Revisions.Get(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		s.writeError(w, http.StatusNotFound, "配置版本不存在")
		return
	}
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法读取配置版本")
		return
	}
	if !restore && r.Method == http.MethodGet {
		s.writeRevision(w, source)
		return
	}
	if restore && r.Method == http.MethodPost {
		latest, err := s.managed.Revisions.Latest(r.Context())
		if err != nil {
			s.writeError(w, http.StatusInternalServerError, "无法读取当前配置")
			return
		}
		document, err := configdoc.ParseJSON(source.Payload)
		if err != nil {
			s.writeError(w, http.StatusInternalServerError, "历史配置内容无效")
			return
		}
		s.createRevision(w, r, document, latest.Revision)
		return
	}
	s.writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
}

func (s *Server) writeRevision(w http.ResponseWriter, revision revisions.Revision) {
	document, err := configdoc.ParseJSON(revision.Payload)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "配置版本内容无效")
		return
	}
	s.writeJSON(w, http.StatusOK, struct {
		revisions.Revision
		YAML string `json:"yaml"`
	}{Revision: revision, YAML: string(document.YAML)})
}

func (s *Server) writeCurrentRevision(w http.ResponseWriter, r *http.Request, revision revisions.Revision) {
	document, err := configdoc.ParseJSON(revision.Payload)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "配置版本内容无效")
		return
	}
	effective, err := s.managed.Validator.Dump(r.Context(), document)
	if err != nil {
		// Keep dump failures opaque: the revision may contain credentials or endpoints.
		s.writeError(w, http.StatusInternalServerError, "无法读取当前配置的有效值")
		return
	}
	defaults := s.managed.Defaults.Payload
	if len(defaults) == 0 {
		// Unmanaged test/embedding callers may not provide startup defaults.
		defaults = effective.Payload
	}
	var response struct {
		revisions.Revision
		YAML             string          `json:"yaml"`
		EffectivePayload json.RawMessage `json:"effectivePayload"`
		DefaultPayload   json.RawMessage `json:"defaultPayload"`
	}
	response.Revision = revision
	response.YAML = string(document.YAML)
	response.EffectivePayload = append(json.RawMessage(nil), effective.Payload...)
	response.DefaultPayload = append(json.RawMessage(nil), defaults...)
	s.writeJSON(w, http.StatusOK, response)
}

func (s *Server) respondManaged(w http.ResponseWriter, status adminruntime.Status, err error) {
	switch {
	case err == nil:
		s.writeJSON(w, http.StatusOK, status)
	case errors.Is(err, adminruntime.ErrAlreadyRunning), errors.Is(err, adminruntime.ErrNotRunning), errors.Is(err, adminruntime.ErrNoConfiguration):
		s.writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, adminruntime.ErrInvalidConfiguration):
		s.writeError(w, http.StatusUnprocessableEntity, err.Error())
	default:
		s.writeError(w, http.StatusInternalServerError, "eRPC 运行操作失败")
	}
}
