package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	adminauth "github.com/erpc/admin/internal/auth"
	"github.com/erpc/admin/internal/config"
	"github.com/erpc/admin/internal/configdoc"
	admindatabase "github.com/erpc/admin/internal/database"
	"github.com/erpc/admin/internal/registry"
	"github.com/erpc/admin/internal/revisions"
	adminruntime "github.com/erpc/admin/internal/runtime"
	"github.com/erpc/admin/internal/server"
)

func main() {
	configPath := flag.String("config", "admin.yaml", "path to Admin YAML config")
	flag.Parse()
	cfg, err := config.LoadFile(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	runtime, err := cfg.Resolve(os.LookupEnv)
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var accounts adminauth.AccountStore
	var managed *server.ManagedDependencies
	var manager *adminruntime.Manager
	if runtime.Managed {
		db, err := admindatabase.Open(ctx, runtime.DatabaseURL)
		if err != nil {
			log.Fatal(err)
		}
		defer db.Close()
		if err := admindatabase.Migrate(ctx, db); err != nil {
			log.Fatal(err)
		}
		if err := adminauth.MigrateLegacyFile(ctx, db, runtime.LegacyAuthFile); err != nil {
			log.Fatal(err)
		}
		accounts = adminauth.NewDatabaseStore(db)
		revisionStore := revisions.NewStore(db)
		validator := configdoc.Validator{Binary: runtime.ERPCBinary, RuntimeDir: runtime.RuntimeDir}
		if _, _, err := ensureInitialRevision(ctx, revisionStore, validator); err != nil {
			log.Fatal(err)
		}
		manager = adminruntime.NewManager(db, revisionStore, validator, runtime.ERPCBinary, runtime.RuntimeDir, runtime.ShutdownTimeout)
		managed = &server.ManagedDependencies{Revisions: revisionStore, Validator: validator, Runtime: manager}
	} else {
		fileAccounts, err := adminauth.NewStore(runtime.AuthFile)
		if err != nil {
			log.Fatal(err)
		}
		accounts = fileAccounts
	}
	reg, err := registry.New(runtime)
	if err != nil {
		log.Fatal(err)
	}
	sessions := adminauth.NewSessions(24 * time.Hour)
	if manager != nil {
		manager.SetTargetUpdater(reg.SetTarget, reg.ClearTarget)
	}
	reg.Start(ctx)
	if manager != nil {
		if err := manager.SyncTarget(ctx); err != nil {
			log.Printf("sync managed eRPC target: %v", err)
		}
	}

	handler := server.New(reg, accounts, sessions)
	if managed != nil {
		handler = server.NewManaged(reg, accounts, sessions, *managed)
	}
	httpServer := &http.Server{Addr: runtime.Listen, Handler: handler}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), runtime.ShutdownTimeout+5*time.Second)
		defer cancel()
		if manager != nil {
			if _, err := manager.Stop(shutdownCtx); err != nil && !errors.Is(err, adminruntime.ErrNotRunning) {
				log.Printf("stop managed eRPC: %v", err)
			}
		}
		_ = httpServer.Shutdown(shutdownCtx)
	}()
	fmt.Printf("Admin listening on http://%s\n", runtime.Listen)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
