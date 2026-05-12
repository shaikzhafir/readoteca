# Readoteca

Readoteca is a small OAuth-only reading tracker with a Go backend, SQLite storage, and a React frontend.

## Current Scope

- Google OAuth login only.
- Server-side sessions stored in SQLite and sent with an HttpOnly `session_id` cookie.
- OpenAPI is the API contract for backend and frontend generated types.
- Google Books is the first catalog source.
- Authenticated users can search books, add them to a personal library, update progress/status/rating/notes/review, and remove books.

See [docs/v0.0.1-plan.md](docs/v0.0.1-plan.md) for the current MVP plan.

## Prerequisites

- Go
- Node.js and npm
- Google OAuth client credentials

For local OAuth, configure a Google OAuth web client with this redirect URI:

```text
http://localhost:8080/google/callback
```

## Environment

The backend reads these environment variables:

```sh
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URL=http://localhost:8080/google/callback
FRONTEND_URL=http://localhost:3000
CORS_ALLOWED_ORIGIN=http://localhost:3000
DATABASE_PATH=books.db
SCHEMA_PATH=schema.sql
AUTO_MIGRATE=true
SESSION_COOKIE_NAME=session_id
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_SAMESITE=lax
SESSION_DURATION_HOURS=24
GOOGLE_BOOKS_API_KEY=...
```

Only `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are required for the backend to start. `GOOGLE_BOOKS_API_KEY` is optional for local development.

## Common Commands

```sh
make install
make generate
make test
make backend
make frontend
```

`make start` runs backend and frontend together for local development. Use `make reset-db` when the SQLite schema has changed and you are fine deleting the local development database.

## API Generation

Backend API code is generated from [backend/api/openapi/openapi.yaml](backend/api/openapi/openapi.yaml):

```sh
make generate-backend
```

Frontend API types are generated from the same OpenAPI document:

```sh
make generate-frontend
```
