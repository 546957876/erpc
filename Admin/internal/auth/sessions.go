package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"sync"
	"time"
)

type Sessions struct {
	mu     sync.Mutex
	ttl    time.Duration
	expiry map[string]time.Time
}

func NewSessions(ttl time.Duration) *Sessions {
	return &Sessions{ttl: ttl, expiry: make(map[string]time.Time)}
}

func (s *Sessions) Create() (string, error) {
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("create session token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(random)
	s.mu.Lock()
	s.expiry[token] = time.Now().Add(s.ttl)
	s.mu.Unlock()
	return token, nil
}

func (s *Sessions) Valid(token string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	expiresAt, ok := s.expiry[token]
	if !ok {
		return false
	}
	if time.Now().After(expiresAt) {
		delete(s.expiry, token)
		return false
	}
	return true
}

func (s *Sessions) Delete(token string) {
	s.mu.Lock()
	delete(s.expiry, token)
	s.mu.Unlock()
}
