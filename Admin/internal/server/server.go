package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	adminauth "github.com/erpc/admin/internal/auth"
	"github.com/erpc/admin/internal/erpc"
	"github.com/erpc/admin/internal/registry"
)

type Server struct {
	registry *registry.Registry
	accounts adminauth.AccountStore
	sessions *adminauth.Sessions
	managed  *ManagedDependencies
	maxBody  int64
}

const sessionCookieName = "erpc_admin_session"

func New(reg *registry.Registry, accounts adminauth.AccountStore, sessions *adminauth.Sessions) http.Handler {
	return &Server{registry: reg, accounts: accounts, sessions: sessions, maxBody: 2 << 20}
}

func NewManaged(reg *registry.Registry, accounts adminauth.AccountStore, sessions *adminauth.Sessions, managed ManagedDependencies) http.Handler {
	return &Server{registry: reg, accounts: accounts, sessions: sessions, managed: &managed, maxBody: 2 << 20}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		s.writeCORS(w)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if s.handleAuth(w, r) {
		return
	}
	if !s.authorized(r) {
		s.writeError(w, http.StatusUnauthorized, "请先登录")
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		s.writeError(w, http.StatusNotFound, "route not found")
		return
	}
	if s.managed != nil && s.handleManaged(w, r) {
		return
	}
	parts := splitPath(r.URL.EscapedPath())
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
	case len(parts) == 4 && parts[3] == "rpc-test" && r.Method == http.MethodPost:
		var request erpc.TestRequest
		if err := s.decodeBody(r, &request); err != nil {
			s.writeError(w, http.StatusBadRequest, "RPC 测试请求无效")
			return
		}
		result, err := target.Client.TestRPC(r.Context(), request)
		s.respondRPCTest(w, result, err)
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
	cookie, err := r.Cookie(sessionCookieName)
	return err == nil && s.sessions.Valid(cookie.Value)
}

func (s *Server) handleAuth(w http.ResponseWriter, r *http.Request) bool {
	if !strings.HasPrefix(r.URL.Path, "/api/auth/") {
		return false
	}
	switch {
	case r.URL.Path == "/api/auth/status" && r.Method == http.MethodGet:
		setupRequired, err := s.accounts.RequiresSetup(r.Context())
		if err != nil {
			s.writeError(w, http.StatusInternalServerError, "无法读取管理员状态")
			break
		}
		s.writeJSON(w, http.StatusOK, map[string]bool{"setupRequired": setupRequired, "authenticated": s.authorized(r)})
	case r.URL.Path == "/api/auth/setup" && r.Method == http.MethodPost:
		s.setup(w, r)
	case r.URL.Path == "/api/auth/login" && r.Method == http.MethodPost:
		s.login(w, r)
	case r.URL.Path == "/api/auth/logout" && r.Method == http.MethodPost:
		s.logout(w, r)
	default:
		s.writeError(w, http.StatusNotFound, "接口不存在")
	}
	return true
}

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) setup(w http.ResponseWriter, r *http.Request) {
	setupRequired, err := s.accounts.RequiresSetup(r.Context())
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法读取管理员状态")
		return
	}
	if !setupRequired {
		s.writeError(w, http.StatusConflict, "管理员账号已创建")
		return
	}
	var input credentials
	if err := s.decodeBody(r, &input); err != nil {
		s.writeError(w, http.StatusBadRequest, "请求内容无效")
		return
	}
	if err := s.accounts.Setup(r.Context(), input.Username, input.Password); err != nil {
		switch {
		case errors.Is(err, adminauth.ErrAlreadySetup):
			s.writeError(w, http.StatusConflict, "管理员账号已创建")
		case errors.Is(err, adminauth.ErrInvalidCredential):
			s.writeError(w, http.StatusBadRequest, "账号需为 3-64 个字符，密码需为 8-72 个字节")
		default:
			s.writeError(w, http.StatusInternalServerError, "无法保存管理员账号")
		}
		return
	}
	s.signIn(w, r, http.StatusCreated)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	setupRequired, err := s.accounts.RequiresSetup(r.Context())
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法读取管理员状态")
		return
	}
	if setupRequired {
		s.writeError(w, http.StatusConflict, "请先创建管理员账号")
		return
	}
	var input credentials
	if err := s.decodeBody(r, &input); err != nil {
		s.writeError(w, http.StatusBadRequest, "请求内容无效")
		return
	}
	authenticated, err := s.accounts.Authenticate(r.Context(), input.Username, input.Password)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法验证管理员账号")
		return
	}
	if !authenticated {
		s.writeError(w, http.StatusUnauthorized, "账号或密码错误")
		return
	}
	s.signIn(w, r, http.StatusOK)
}

func (s *Server) signIn(w http.ResponseWriter, r *http.Request, status int) {
	token, err := s.sessions.Create()
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "无法创建登录会话")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookieName, Value: token, Path: "/", MaxAge: int((24 * time.Hour).Seconds()), HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteStrictMode})
	s.writeJSON(w, status, map[string]bool{"authenticated": true})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookieName); err == nil {
		s.sessions.Delete(cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteStrictMode})
	s.writeCORS(w)
	w.WriteHeader(http.StatusNoContent)
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
		if (errors.As(err, &httpErr) && httpErr.Status == http.StatusUnauthorized) || erpc.IsAdminAuthNotConfigured(err) {
			status = http.StatusUnauthorized
		}
		s.writeError(w, status, publicError(err))
		return
	}
	s.writeJSON(w, http.StatusOK, value)
}

func (s *Server) respondRPCTest(w http.ResponseWriter, value erpc.TestResult, err error) {
	if err == nil {
		s.writeJSON(w, http.StatusOK, value)
		return
	}
	if errors.Is(err, erpc.ErrInvalidTestRequest) {
		s.writeError(w, http.StatusBadRequest, "RPC 测试参数无效")
		return
	}
	s.writeError(w, http.StatusBadGateway, "无法连接被测 RPC 服务")
}

func publicError(err error) string {
	var rpcErr *erpc.RPCError
	if errors.As(err, &rpcErr) {
		return fmt.Sprintf("eRPC 管理接口拒绝请求（错误码 %d）", rpcErr.Code)
	}
	var httpErr *erpc.HTTPError
	if errors.As(err, &httpErr) {
		return fmt.Sprintf("eRPC 管理接口返回 HTTP 状态 %d", httpErr.Status)
	}
	return "eRPC 管理接口请求失败"
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
	w.Header().Set("access-control-allow-headers", "content-type")
	w.Header().Set("access-control-allow-methods", "GET,POST,DELETE,OPTIONS")
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
