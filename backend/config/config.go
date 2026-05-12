package config

import (
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Address               string
	DatabasePath          string
	DistPath              string
	SchemaPath            string
	AutoMigrate           bool
	FrontendURL           string
	CORSAllowedOrigin     string
	GoogleClientID        string
	GoogleClientSecret    string
	GoogleRedirectURL     string
	SessionCookieName     string
	SessionCookieSecure   bool
	SessionCookieDomain   string
	SessionCookieSameSite http.SameSite
	SessionDuration       time.Duration
	GoogleBooksAPIKey     string
}

func Load() (Config, error) {
	frontendURL := getenv("FRONTEND_URL", "http://localhost:3000")
	sessionDurationHours, err := getenvInt("SESSION_DURATION_HOURS", 24)
	if err != nil {
		return Config{}, err
	}
	sameSite, err := parseSameSite(getenv("SESSION_COOKIE_SAMESITE", "lax"))
	if err != nil {
		return Config{}, err
	}
	autoMigrate, err := getenvBool("AUTO_MIGRATE", true)
	if err != nil {
		return Config{}, err
	}
	prod, err := getenvBool("PROD", false)
	if err != nil {
		return Config{}, err
	}
	secure, err := getenvBool("SESSION_COOKIE_SECURE", prod)
	if err != nil {
		return Config{}, err
	}
	address := ":8080"
	if prod {
		address = getenv("PROD_ADDRESS", ":5000")
	}

	return Config{
		Address:               address,
		DatabasePath:          getenv("DATABASE_PATH", "books.db"),
		DistPath:              getenv("DIST_PATH", "../frontend/dist"),
		SchemaPath:            getenv("SCHEMA_PATH", "schema.sql"),
		AutoMigrate:           autoMigrate,
		FrontendURL:           strings.TrimRight(frontendURL, "/"),
		CORSAllowedOrigin:     getenv("CORS_ALLOWED_ORIGIN", frontendURL),
		GoogleClientID:        os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret:    os.Getenv("GOOGLE_CLIENT_SECRET"),
		GoogleRedirectURL:     getenv("GOOGLE_REDIRECT_URL", "http://localhost:8080/google/callback"),
		SessionCookieName:     getenv("SESSION_COOKIE_NAME", "session_id"),
		SessionCookieSecure:   secure,
		SessionCookieDomain:   os.Getenv("SESSION_COOKIE_DOMAIN"),
		SessionCookieSameSite: sameSite,
		SessionDuration:       time.Duration(sessionDurationHours) * time.Hour,
		GoogleBooksAPIKey:     os.Getenv("GOOGLE_BOOKS_API_KEY"),
	}, nil
}

func (c Config) ValidateOAuth() error {
	if c.GoogleClientID == "" {
		return fmt.Errorf("GOOGLE_CLIENT_ID not set")
	}
	if c.GoogleClientSecret == "" {
		return fmt.Errorf("GOOGLE_CLIENT_SECRET not set")
	}
	return nil
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func getenvBool(key string, fallback bool) (bool, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("%s must be a boolean: %w", key, err)
	}
	return parsed, nil
}

func getenvInt(key string, fallback int) (int, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer: %w", key, err)
	}
	return parsed, nil
}

func parseSameSite(value string) (http.SameSite, error) {
	switch strings.ToLower(value) {
	case "", "default":
		return http.SameSiteDefaultMode, nil
	case "lax":
		return http.SameSiteLaxMode, nil
	case "strict":
		return http.SameSiteStrictMode, nil
	case "none":
		return http.SameSiteNoneMode, nil
	default:
		return http.SameSiteDefaultMode, fmt.Errorf("SESSION_COOKIE_SAMESITE must be one of default, lax, strict, none")
	}
}
