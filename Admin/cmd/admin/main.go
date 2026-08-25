package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/erpc/admin/internal/config"
	"github.com/erpc/admin/internal/registry"
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
	reg, err := registry.New(runtime)
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	reg.Start(ctx)

	httpServer := &http.Server{Addr: runtime.Listen, Handler: server.New(reg, runtime.WebToken)}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()
	fmt.Printf("Admin listening on http://%s\n", runtime.Listen)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
