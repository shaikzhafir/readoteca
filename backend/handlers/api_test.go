package handlers_test

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	api "readoteca/api/generated"
	"readoteca/config"
	"readoteca/db"
	"readoteca/handlers"

	_ "github.com/mattn/go-sqlite3"
)

type fakeCatalog struct {
	book api.CatalogBook
}

func (f fakeCatalog) Search(ctx context.Context, query string) ([]api.CatalogBook, error) {
	return []api.CatalogBook{f.book}, nil
}

func (f fakeCatalog) Get(ctx context.Context, sourceID string) (api.CatalogBook, error) {
	return f.book, nil
}

type testApp struct {
	handler http.Handler
	store   *db.Queries
	cfg     config.Config
}

func TestGoogleLoginStoresSafeNextInStateCookie(t *testing.T) {
	app := newTestApp(t)

	req := httptest.NewRequest(http.MethodGet, "/google/login?next=/library", nil)
	res := httptest.NewRecorder()

	app.handler.ServeHTTP(res, req)

	if res.Code != http.StatusFound {
		t.Fatalf("expected 302, got %d: %s", res.Code, res.Body.String())
	}
	if location := res.Header().Get("Location"); !strings.Contains(location, "accounts.google.com") {
		t.Fatalf("expected Google redirect location, got %q", location)
	}

	cookie := findCookie(res.Result().Cookies(), "oauth_state")
	if cookie == nil {
		t.Fatal("expected oauth_state cookie")
	}
	if next := stateNext(t, cookie.Value); next != "/library" {
		t.Fatalf("expected /library next, got %q", next)
	}
}

func TestGoogleLoginRejectsUnsafeNext(t *testing.T) {
	app := newTestApp(t)

	req := httptest.NewRequest(http.MethodGet, "/google/login?next=https://evil.example/books", nil)
	res := httptest.NewRecorder()

	app.handler.ServeHTTP(res, req)

	if res.Code != http.StatusFound {
		t.Fatalf("expected 302, got %d: %s", res.Code, res.Body.String())
	}
	cookie := findCookie(res.Result().Cookies(), "oauth_state")
	if cookie == nil {
		t.Fatal("expected oauth_state cookie")
	}
	if next := stateNext(t, cookie.Value); next != "/library" {
		t.Fatalf("expected unsafe next to fall back to /library, got %q", next)
	}
}

func TestMeRequiresSession(t *testing.T) {
	app := newTestApp(t)

	req := httptest.NewRequest(http.MethodGet, "/me", nil)
	res := httptest.NewRecorder()

	app.handler.ServeHTTP(res, req)

	if res.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", res.Code)
	}
}

func TestMeReturnsCurrentUser(t *testing.T) {
	app := newTestApp(t)
	_, sessionID := seedUserSession(t, app.store)

	req := httptest.NewRequest(http.MethodGet, "/me", nil)
	req.AddCookie(&http.Cookie{Name: app.cfg.SessionCookieName, Value: sessionID})
	res := httptest.NewRecorder()

	app.handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}
	var user api.User
	if err := json.NewDecoder(res.Body).Decode(&user); err != nil {
		t.Fatal(err)
	}
	if user.Email != "reader@example.com" {
		t.Fatalf("expected reader@example.com, got %s", user.Email)
	}
}

func TestLibraryAddListPatchAndDelete(t *testing.T) {
	app := newTestApp(t)
	_, sessionID := seedUserSession(t, app.store)

	addReq := httptest.NewRequest(http.MethodPost, "/library", strings.NewReader(`{"source":"google_books","sourceId":"volume-1"}`))
	addReq.Header.Set("Content-Type", "application/json")
	addReq.AddCookie(&http.Cookie{Name: app.cfg.SessionCookieName, Value: sessionID})
	addRes := httptest.NewRecorder()
	app.handler.ServeHTTP(addRes, addReq)

	if addRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", addRes.Code, addRes.Body.String())
	}
	var created api.LibraryItem
	if err := json.NewDecoder(addRes.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.Status != api.WantToRead || created.Progress != 0 {
		t.Fatalf("unexpected created state: %#v", created)
	}

	patchReq := httptest.NewRequest(http.MethodPatch, "/library/1", strings.NewReader(`{"progress":100}`))
	patchReq.Header.Set("Content-Type", "application/json")
	patchReq.AddCookie(&http.Cookie{Name: app.cfg.SessionCookieName, Value: sessionID})
	patchRes := httptest.NewRecorder()
	app.handler.ServeHTTP(patchRes, patchReq)

	if patchRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", patchRes.Code, patchRes.Body.String())
	}
	var patched api.LibraryItem
	if err := json.NewDecoder(patchRes.Body).Decode(&patched); err != nil {
		t.Fatal(err)
	}
	if patched.Status != api.Finished || patched.Progress != 100 || patched.FinishedAt == nil {
		t.Fatalf("expected finished with timestamp, got %#v", patched)
	}

	statusReq := httptest.NewRequest(http.MethodPatch, "/library/1", strings.NewReader(`{"status":"want_to_read"}`))
	statusReq.Header.Set("Content-Type", "application/json")
	statusReq.AddCookie(&http.Cookie{Name: app.cfg.SessionCookieName, Value: sessionID})
	statusRes := httptest.NewRecorder()
	app.handler.ServeHTTP(statusRes, statusReq)

	if statusRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", statusRes.Code, statusRes.Body.String())
	}
	var reset api.LibraryItem
	if err := json.NewDecoder(statusRes.Body).Decode(&reset); err != nil {
		t.Fatal(err)
	}
	if reset.Status != api.WantToRead || reset.Progress != 0 {
		t.Fatalf("expected want_to_read with zero progress, got %#v", reset)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/library", nil)
	listReq.AddCookie(&http.Cookie{Name: app.cfg.SessionCookieName, Value: sessionID})
	listRes := httptest.NewRecorder()
	app.handler.ServeHTTP(listRes, listReq)

	if listRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", listRes.Code, listRes.Body.String())
	}
	var items []api.LibraryItem
	if err := json.NewDecoder(listRes.Body).Decode(&items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 library item, got %d", len(items))
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/library/1", nil)
	deleteReq.AddCookie(&http.Cookie{Name: app.cfg.SessionCookieName, Value: sessionID})
	deleteRes := httptest.NewRecorder()
	app.handler.ServeHTTP(deleteRes, deleteReq)

	if deleteRes.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", deleteRes.Code, deleteRes.Body.String())
	}
}

func newTestApp(t *testing.T) testApp {
	t.Helper()
	conn, err := sql.Open("sqlite3", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	schemaPath := filepath.Join("..", "schema.sql")
	schema, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(string(schema)); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{
		FrontendURL:           "http://localhost:3000",
		GoogleClientID:        "test-client",
		GoogleClientSecret:    "test-secret",
		GoogleRedirectURL:     "http://localhost:8080/google/callback",
		SessionCookieName:     "session_id",
		SessionCookieSameSite: http.SameSiteLaxMode,
		SessionDuration:       24 * time.Hour,
	}
	store := db.New(conn)
	server, err := handlers.NewServer(cfg, store, fakeCatalog{
		book: api.CatalogBook{
			Source:   "google_books",
			SourceId: "volume-1",
			Title:    "The Left Hand of Darkness",
			Authors:  []string{"Ursula K. Le Guin"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	strict := api.NewStrictHandler(server, []api.StrictMiddlewareFunc{handlers.RequestContextMiddleware})
	handler := api.HandlerFromMux(strict, mux)
	return testApp{handler: handler, store: store, cfg: cfg}
}

func findCookie(cookies []*http.Cookie, name string) *http.Cookie {
	for _, cookie := range cookies {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}

func stateNext(t *testing.T, state string) string {
	t.Helper()
	bytes, err := base64.RawURLEncoding.DecodeString(state)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.SplitN(string(bytes), "|", 2)
	if len(parts) != 2 {
		t.Fatalf("invalid state payload %q", string(bytes))
	}
	return parts[1]
}

func seedUserSession(t *testing.T, store *db.Queries) (db.User, string) {
	t.Helper()
	ctx := context.Background()
	user, err := store.UpsertGoogleUser(ctx, db.UpsertGoogleUserParams{
		GoogleSub:   "google-sub-1",
		Email:       "reader@example.com",
		DisplayName: "Reader",
	})
	if err != nil {
		t.Fatal(err)
	}
	sessionID := "session-1"
	if err := store.CreateSession(ctx, db.CreateSessionParams{
		ID:        sessionID,
		UserID:    user.ID,
		ExpiresAt: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	return user, sessionID
}
