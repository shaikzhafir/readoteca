package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	api "readoteca/api/generated"
	"readoteca/config"
	"readoteca/db"
	"readoteca/handlers"
	"readoteca/pkg/googlebooks"

	_ "github.com/mattn/go-sqlite3"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	conn, err := sql.Open("sqlite3", cfg.DatabasePath)
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()

	if cfg.AutoMigrate {
		if err := runSchema(conn, cfg.SchemaPath); err != nil {
			log.Fatal(err)
		}
	}

	store := db.New(conn)
	catalog, err := googlebooks.New(cfg.GoogleBooksAPIKey)
	if err != nil {
		log.Fatal(err)
	}
	server, err := handlers.NewServer(cfg, store, catalog)
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	strict := api.NewStrictHandler(server, []api.StrictMiddlewareFunc{handlers.RequestContextMiddleware})
	api.HandlerFromMuxWithBaseURL(strict, mux, "/api")
	mux.HandleFunc("/", spaHandler(cfg.DistPath))

	fmt.Printf("Server running at %s\n", cfg.Address)
	log.Fatal(http.ListenAndServe(cfg.Address, handlers.WithCORS(mux, cfg)))
}

func runSchema(conn *sql.DB, schemaPath string) error {
	schema, err := os.ReadFile(schemaPath)
	if err != nil {
		return fmt.Errorf("read schema: %w", err)
	}
	if _, err := conn.Exec(string(schema)); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	return nil
}

func spaHandler(distPath string) http.HandlerFunc {
	fileServer := http.FileServer(http.Dir(distPath))

	return func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		if strings.HasPrefix(path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000")
		}

		if _, err := os.Stat(filepath.Join(distPath, path)); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}

		if strings.HasPrefix(path, "/assets/") {
			http.NotFound(w, r)
			return
		}

		http.ServeFile(w, r, filepath.Join(distPath, "index.html"))
	}
}
