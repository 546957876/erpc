package auth

import (
	"testing"
	"time"
)

func TestSessionsCreateValidateAndDelete(t *testing.T) {
	sessions := NewSessions(time.Hour)
	token, err := sessions.Create()
	if err != nil {
		t.Fatal(err)
	}
	if token == "" || !sessions.Valid(token) {
		t.Fatal("created session is not valid")
	}
	sessions.Delete(token)
	if sessions.Valid(token) {
		t.Fatal("deleted session is still valid")
	}
}

func TestSessionsExpire(t *testing.T) {
	sessions := NewSessions(time.Millisecond)
	token, err := sessions.Create()
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(5 * time.Millisecond)
	if sessions.Valid(token) {
		t.Fatal("expired session is still valid")
	}
}
