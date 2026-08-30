package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/erpc/admin/internal/configdoc"
	"github.com/erpc/admin/internal/revisions"
)

type initialRevisionStore interface {
	Latest(context.Context) (revisions.Revision, error)
	Create(context.Context, configdoc.Document, string, int64) (revisions.Revision, error)
}

type initialValidator interface {
	Validate(context.Context, configdoc.Document) (configdoc.ValidationResult, error)
	Dump(context.Context, configdoc.Document) (configdoc.Document, error)
}

func ensureInitialRevision(ctx context.Context, store initialRevisionStore, validator initialValidator) (revisions.Revision, configdoc.Document, error) {
	// Keep the managed production path on compact diagnostics by default.
	// Full per-attempt traces can overflow a reverse proxy header buffer.
	empty, err := configdoc.ParseJSON([]byte(`{"server":{"executionHeaders":"summary"}}`))
	if err != nil {
		return revisions.Revision{}, configdoc.Document{}, fmt.Errorf("build initial configuration: %w", err)
	}
	revision, err := store.Latest(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		validation, validateErr := validator.Validate(ctx, empty)
		if validateErr != nil {
			return revisions.Revision{}, configdoc.Document{}, fmt.Errorf("validate initial configuration: %w", validateErr)
		}
		if !validation.Valid {
			return revisions.Revision{}, configdoc.Document{}, fmt.Errorf("validate initial configuration: eRPC reported an invalid configuration")
		}
		revision, err = store.Create(ctx, empty, "system-default", 0)
		if errors.Is(err, revisions.ErrConflict) {
			revision, err = store.Latest(ctx)
			if err != nil {
				return revisions.Revision{}, configdoc.Document{}, fmt.Errorf("read initial revision after conflict: %w", err)
			}
		} else if err != nil {
			return revisions.Revision{}, configdoc.Document{}, fmt.Errorf("create initial revision: %w", err)
		}
	} else if err != nil {
		return revisions.Revision{}, configdoc.Document{}, fmt.Errorf("read initial revision: %w", err)
	}
	defaults, err := validator.Dump(ctx, empty)
	if err != nil {
		return revisions.Revision{}, configdoc.Document{}, fmt.Errorf("dump initial defaults: %w", err)
	}
	return revision, defaults, nil
}
