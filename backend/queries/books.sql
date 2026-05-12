-- name: UpsertBookFromSource :one
INSERT INTO books (
    source,
    source_id,
    isbn_10,
    isbn_13,
    title,
    authors,
    description,
    cover_url,
    published_date,
    updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(source, source_id) DO UPDATE SET
    isbn_10 = excluded.isbn_10,
    isbn_13 = excluded.isbn_13,
    title = excluded.title,
    authors = excluded.authors,
    description = excluded.description,
    cover_url = excluded.cover_url,
    published_date = excluded.published_date,
    updated_at = CURRENT_TIMESTAMP
RETURNING *;

-- name: GetBookBySource :one
SELECT * FROM books
WHERE source = ? AND source_id = ?;

-- name: GetBook :one
SELECT * FROM books
WHERE id = ?;

-- name: CreateLibraryItem :one
INSERT INTO user_books (user_id, book_id)
VALUES (?, ?)
RETURNING *;

-- name: GetLibraryItemByUserAndBook :one
SELECT
    ub.id,
    ub.user_id,
    ub.book_id,
    ub.status,
    ub.progress,
    ub.rating,
    ub.notes,
    ub.review,
    ub.review_published,
    ub.started_at,
    ub.finished_at,
    ub.abandoned_at,
    ub.created_at,
    ub.updated_at,
    b.id AS book_id_2,
    b.source,
    b.source_id,
    b.isbn_10,
    b.isbn_13,
    b.title,
    b.authors,
    b.description,
    b.cover_url,
    b.published_date,
    b.created_at AS book_created_at,
    b.updated_at AS book_updated_at
FROM user_books ub
JOIN books b ON b.id = ub.book_id
WHERE ub.user_id = ? AND ub.book_id = ?;

-- name: GetLibraryItem :one
SELECT
    ub.id,
    ub.user_id,
    ub.book_id,
    ub.status,
    ub.progress,
    ub.rating,
    ub.notes,
    ub.review,
    ub.review_published,
    ub.started_at,
    ub.finished_at,
    ub.abandoned_at,
    ub.created_at,
    ub.updated_at,
    b.id AS book_id_2,
    b.source,
    b.source_id,
    b.isbn_10,
    b.isbn_13,
    b.title,
    b.authors,
    b.description,
    b.cover_url,
    b.published_date,
    b.created_at AS book_created_at,
    b.updated_at AS book_updated_at
FROM user_books ub
JOIN books b ON b.id = ub.book_id
WHERE ub.user_id = ? AND ub.id = ?;

-- name: ListLibraryItems :many
SELECT
    ub.id,
    ub.user_id,
    ub.book_id,
    ub.status,
    ub.progress,
    ub.rating,
    ub.notes,
    ub.review,
    ub.review_published,
    ub.started_at,
    ub.finished_at,
    ub.abandoned_at,
    ub.created_at,
    ub.updated_at,
    b.id AS book_id_2,
    b.source,
    b.source_id,
    b.isbn_10,
    b.isbn_13,
    b.title,
    b.authors,
    b.description,
    b.cover_url,
    b.published_date,
    b.created_at AS book_created_at,
    b.updated_at AS book_updated_at
FROM user_books ub
JOIN books b ON b.id = ub.book_id
WHERE ub.user_id = ?
ORDER BY ub.updated_at DESC, ub.id DESC;

-- name: UpdateLibraryItem :one
UPDATE user_books SET
    status = ?,
    progress = ?,
    rating = ?,
    notes = ?,
    review = ?,
    review_published = ?,
    started_at = ?,
    finished_at = ?,
    abandoned_at = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE user_id = ? AND id = ?
RETURNING *;

-- name: DeleteLibraryItem :execrows
DELETE FROM user_books
WHERE user_id = ? AND id = ?;
