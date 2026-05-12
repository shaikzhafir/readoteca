package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"readoteca/config"

	"golang.org/x/oauth2"
	googleOAuth2 "golang.org/x/oauth2/google"
)

const OAuthStateCookieName = "oauth_state"

func OAuthConfig(cfg config.Config) (*oauth2.Config, error) {
	if err := cfg.ValidateOAuth(); err != nil {
		return nil, err
	}
	return &oauth2.Config{
		ClientID:     cfg.GoogleClientID,
		ClientSecret: cfg.GoogleClientSecret,
		RedirectURL:  cfg.GoogleRedirectURL,
		Endpoint:     googleOAuth2.Endpoint,
		Scopes:       []string{"profile", "email"},
	}, nil
}

func GenerateRandomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func SessionCookie(cfg config.Config, sessionID string) *http.Cookie {
	return &http.Cookie{
		Name:     cfg.SessionCookieName,
		Value:    sessionID,
		Path:     "/",
		Domain:   cfg.SessionCookieDomain,
		Expires:  time.Now().Add(cfg.SessionDuration),
		MaxAge:   int(cfg.SessionDuration.Seconds()),
		HttpOnly: true,
		SameSite: cfg.SessionCookieSameSite,
		Secure:   cfg.SessionCookieSecure,
	}
}

func ClearSessionCookie(cfg config.Config) *http.Cookie {
	return &http.Cookie{
		Name:     cfg.SessionCookieName,
		Value:    "",
		Path:     "/",
		Domain:   cfg.SessionCookieDomain,
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: cfg.SessionCookieSameSite,
		Secure:   cfg.SessionCookieSecure,
	}
}

func OAuthStateCookie(cfg config.Config, state string) *http.Cookie {
	return &http.Cookie{
		Name:     OAuthStateCookieName,
		Value:    state,
		Path:     "/",
		Domain:   cfg.SessionCookieDomain,
		MaxAge:   10 * 60,
		HttpOnly: true,
		SameSite: cfg.SessionCookieSameSite,
		Secure:   cfg.SessionCookieSecure,
	}
}

func SessionIDFromRequest(cfg config.Config, r *http.Request) (string, error) {
	cookie, err := r.Cookie(cfg.SessionCookieName)
	if err != nil {
		return "", err
	}
	if cookie.Value == "" {
		return "", errors.New("session cookie is empty")
	}
	return cookie.Value, nil
}

func OAuthStateFromRequest(r *http.Request) (string, error) {
	cookie, err := r.Cookie(OAuthStateCookieName)
	if err != nil {
		return "", err
	}
	if cookie.Value == "" {
		return "", errors.New("oauth state cookie is empty")
	}
	return cookie.Value, nil
}

func SafeNext(next *string) string {
	if next == nil || *next == "" {
		return "/library"
	}
	value := strings.TrimSpace(*next)
	parsed, err := url.Parse(value)
	if err != nil || parsed.IsAbs() || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") {
		return "/library"
	}
	return value
}
