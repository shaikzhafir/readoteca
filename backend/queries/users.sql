-- name: UpsertGoogleUser :one
INSERT INTO users (
    google_sub,
    email,
    display_name,
    avatar_url,
    updated_at
)
VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(google_sub) DO UPDATE SET
    email = excluded.email,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    updated_at = CURRENT_TIMESTAMP
RETURNING *;

-- name: GetUserByID :one
SELECT * FROM users
WHERE id = ?;

-- name: GetUserByGoogleSub :one
SELECT * FROM users
WHERE google_sub = ?;

-- name: CreateSession :exec
INSERT INTO sessions (id, user_id, expires_at)
VALUES (?, ?, ?);

-- name: GetSessionByID :one
SELECT * FROM sessions
WHERE id = ?;

-- name: DeleteSession :execrows
DELETE FROM sessions
WHERE id = ?;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions
WHERE expires_at <= CURRENT_TIMESTAMP;
