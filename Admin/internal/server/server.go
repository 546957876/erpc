package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/erpc/admin/internal/erpc"
	"github.com/erpc/admin/internal/registry"
)

type Server struct {
	registry *registry.Registry
	webToken string
	maxBody  int64
}

func New(reg *registry.Registry, webToken string) http.Handler {
	return &Server{registry: reg, webToken: webToken, maxBody: 64 << 10}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		s.writeCORS(w)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !s.authorized(r) {
		s.writeError(w, http.StatusUnauthorized, "admin web authentication required")
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		s.writeError(w, http.StatusNotFound, "route not found")
		return
	}
	parts := splitPath(r.URL.Path)
	if len(parts) == 2 && parts[0] == "api" && parts[1] == "targets" {
		if r.Method != http.MethodGet {
			s.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.writeJSON(w, http.StatusOK, s.registry.List())
		return
	}
	if len(parts) < 4 || parts[0] != "api" || parts[1] != "targets" {
		s.writeError(w, http.StatusNotFound, "route not found")
		return
	}
	targetID, err := url.PathUnescape(parts[2])
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid target id")
		return
	}
	target, ok := s.registry.Target(targetID)
	if !ok {
		s.writeError(w, http.StatusNotFound, "target not found")
		return
	}
	switch {
	case len(parts) == 4 && parts[3] == "taxonomy" && r.Method == http.MethodGet:
		result, err := target.Client.Taxonomy(r.Context())
		s.respondRPC(w, result, err)
	case len(parts) == 5 && parts[3] == "projects" && r.Method == http.MethodGet:
		projectID, err := url.PathUnescape(parts[4])
		if err != nil || projectID == "" {
			s.writeError(w, http.StatusBadRequest, "invalid project id")
			return
		}
		result, err := target.Client.Project(r.Context(), projectID)
		s.respondRPC(w, result, err)
	case len(parts) == 4 && parts[3] == "cordons" && r.Method == http.MethodGet:
		projectID := r.URL.Query().Get("projectId")
		if projectID == "" {
			s.writeError(w, http.StatusBadRequest, "projectId is required")
			return
		}
		result, err := target.Client.Cordons(r.Context(), projectID)
		s.respondRPC(w, result, err)
	case len(parts) == 4 && (parts[3] == "cordon" || parts[3] == "uncordon") && r.Method == http.MethodPost:
		var request erpc.CordonRequest
		if err := s.decodeBody(r, &request); err != nil {
			s.writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if request.ProjectID == "" || request.Upstream == "" {
			s.writeError(w, http.StatusBadRequest, "projectId and upstream are required")
			return
		}
		method := "erpc_uncordonUpstream"
		if parts[3] == "cordon" {
			method = "erpc_cordonUpstream"
		}
		result, err := target.Client.Cordon(r.Context(), method, request)
		s.respondRPC(w, result, err)
	default:
		s.writeError(w, http.StatusNotFound, "route not found")
	}
}

func (s *Server) authorized(r *http.Request) bool {
	if s.webToken == "" {
		return true
	}
	token := strings.TrimSpace(r.Header.Get("x-admin-token"))
	if token == "" {
		auth := strings.TrimSpace(r.Header.Get("authorization"))
		if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
			token = strings.TrimSpace(auth[7:])
		}
	}
	return token != "" && token == s.webToken
}

func (s *Server) decodeBody(r *http.Request, value any) error {
	defer r.Body.Close()
	data, err := io.ReadAll(io.LimitReader(r.Body, s.maxBody+1))
	if err != nil {
		return fmt.Errorf("read JSON body: %w", err)
	}
	if int64(len(data)) > s.maxBody {
		return fmt.Errorf("JSON body exceeds %d bytes", s.maxBody)
	}
	if err := json.Unmarshal(data, value); err != nil {
		return fmt.Errorf("invalid JSON body: %w", err)
	}
	return nil
}

func (s *Server) respondRPC(w http.ResponseWriter, value any, err error) {
	if err != nil {
		status := http.StatusBadGateway
		var httpErr *erpc.HTTPError
		if errors.As(err, &httpErr) && httpErr.Status == http.StatusUnauthorized {
			status = http.StatusUnauthorized
		}
		s.writeError(w, status, publicError(err))
		return
	}
	s.writeJSON(w, http.StatusOK, value)
}

func publicError(err error) string {
	var rpcErr *erpc.RPCError
	if errors.As(err, &rpcErr) {
		return fmt.Sprintf("eRPC admin rejected the request (code %d)", rpcErr.Code)
	}
	var httpErr *erpc.HTTPError
	if errors.As(err, &httpErr) {
		return fmt.Sprintf("eRPC admin returned HTTP status %d", httpErr.Status)
	}
	return "eRPC admin request failed"
}

func splitPath(path string) []string {
	trimmed := strings.Trim(path, "/")
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, "/")
}

func (s *Server) writeCORS(w http.ResponseWriter) {
	w.Header().Set("access-control-allow-origin", "*")
	w.Header().Set("access-control-allow-headers", "content-type,authorization,x-admin-token")
	w.Header().Set("access-control-allow-methods", "GET,POST,OPTIONS")
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, value any) {
	s.writeCORS(w)
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (s *Server) writeError(w http.ResponseWriter, status int, message string) {
	s.writeJSON(w, status, map[string]any{"error": map[string]string{"message": message}})
}
