import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { components } from "../api/schema";
import { apiFetch } from "../api/client";

type CatalogBook = components["schemas"]["CatalogBook"];
type LibraryItem = components["schemas"]["LibraryItem"];
type BookStatus = components["schemas"]["BookStatus"];
type LibraryScreen = "library" | "add";

const statuses: Array<{ value: BookStatus; label: string }> = [
  { value: "want_to_read", label: "Want to read" },
  { value: "reading", label: "Reading" },
  { value: "finished", label: "Finished" },
  { value: "abandoned", label: "Abandoned" },
];

export const Route = createFileRoute("/_auth/library")({
  component: LibraryPage,
});

function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [screen, setScreen] = useState<LibraryScreen>("library");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogBook[]>([]);
  const [selectedCatalogBook, setSelectedCatalogBook] = useState<CatalogBook | null>(null);
  const [filter, setFilter] = useState<BookStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [addingBookKey, setAddingBookKey] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const loadLibrary = async () => {
    setLoading(true);
    setLibraryError(null);
    try {
      const data = await apiFetch<LibraryItem[]>("/library");
      setItems(data);
      setSelected((current) => {
        if (!current) return null;
        return data.find((item) => item.id === current.id) ?? null;
      });
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLibrary();
  }, []);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((item) => item.status === filter);
  }, [filter, items]);

  const stats = useMemo(
    () => ({
      total: items.length,
      reading: items.filter((item) => item.status === "reading").length,
      finished: items.filter((item) => item.status === "finished").length,
    }),
    [items],
  );

  const librarySourceKeys = useMemo(
    () => new Set(items.map((item) => sourceKey(item.book.source, item.book.sourceId))),
    [items],
  );

  const dedupedResults = useMemo(() => dedupeCatalogBooks(results), [results]);

  useEffect(() => {
    if (!selectedCatalogBook) return;
    const selectedKey = sourceKey(selectedCatalogBook.source, selectedCatalogBook.sourceId);
    if (!dedupedResults.some((book) => sourceKey(book.source, book.sourceId) === selectedKey)) {
      setSelectedCatalogBook(null);
    }
  }, [dedupedResults, selectedCatalogBook]);

  const searchBooks = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSelectedCatalogBook(null);
    try {
      const data = await apiFetch<CatalogBook[]>(
        `/books/search?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(data);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const addBook = async (book: CatalogBook) => {
    const bookKey = sourceKey(book.source, book.sourceId);
    setSearchError(null);
    setAddingBookKey(bookKey);
    try {
      await apiFetch<LibraryItem>("/library", {
        method: "POST",
        body: JSON.stringify({ source: book.source, sourceId: book.sourceId }),
      });
      await loadLibrary();
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Failed to add book");
    } finally {
      setAddingBookKey(null);
    }
  };

  const patchItem = async (id: number, body: Record<string, unknown>) => {
    setSavingId(id);
    setDetailError(null);
    try {
      const updated = await apiFetch<LibraryItem>(`/library/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setItems((current) => current.map((item) => (item.id === id ? updated : item)));
      setSelected((current) => (current?.id === id ? updated : current));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingId(null);
    }
  };

  const removeItem = async (id: number) => {
    setSavingId(id);
    setDetailError(null);
    try {
      await apiFetch<void>(`/library/${id}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== id));
      setSelected((current) => (current?.id === id ? null : current));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setSavingId(null);
    }
  };

  const selectCatalogBook = (book: CatalogBook) => {
    const bookKey = sourceKey(book.source, book.sourceId);
    setSelectedCatalogBook((current) => {
      if (!current) return book;
      return sourceKey(current.source, current.sourceId) === bookKey ? null : book;
    });
  };

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <h1 className="page-title">{screen === "library" ? "Library" : "Add books"}</h1>
          {screen === "library" && stats.total > 0 && (
            <p className="page-meta mt-2">
              {stats.total} · {stats.reading} reading · {stats.finished} finished
            </p>
          )}
        </div>
        <nav className="screen-tabs" aria-label="Library screens">
          <ScreenTab active={screen === "library"} onClick={() => setScreen("library")}>
            Current books
          </ScreenTab>
          <ScreenTab active={screen === "add"} onClick={() => setScreen("add")}>
            Add books
          </ScreenTab>
        </nav>
      </div>

      {screen === "add" ? (
        <>
          <form onSubmit={searchBooks} className="mb-8 flex flex-col gap-2 sm:flex-row sm:max-w-xl">
            <input
              className="form-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title, author, or ISBN"
              aria-label="Search Google Books"
            />
            <button type="submit" className="btn btn-primary sm:w-32" disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </button>
          </form>
          {searchError && (
            <InlineError onDismiss={() => setSearchError(null)} className="-mt-6 mb-8 sm:max-w-xl">
              {searchError}
            </InlineError>
          )}
          {searching ? (
            <SkeletonGrid />
          ) : dedupedResults.length > 0 ? (
            <div>
              <SectionHeading>
                Catalog results{results.length > dedupedResults.length ? ` · ${results.length - dedupedResults.length} duplicates hidden` : ""}
              </SectionHeading>
              <div
                className={`grid gap-10 ${selectedCatalogBook ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""}`}
              >
                <div className="book-grid">
                  {dedupedResults.map((book) => {
                    const bookKey = sourceKey(book.source, book.sourceId);
                    const isInLibrary = librarySourceKeys.has(bookKey);
                    const isSelected =
                      selectedCatalogBook != null &&
                      sourceKey(selectedCatalogBook.source, selectedCatalogBook.sourceId) === bookKey;
                    return (
                      <SearchResultCard
                        key={bookKey}
                        book={book}
                        isSelected={isSelected}
                        isInLibrary={isInLibrary}
                        isAdding={addingBookKey === bookKey}
                        onSelect={() => selectCatalogBook(book)}
                        onAdd={() => void addBook(book)}
                      />
                    );
                  })}
                </div>
                {selectedCatalogBook && (
                  <CatalogDetailPanel
                    book={selectedCatalogBook}
                    isInLibrary={librarySourceKeys.has(
                      sourceKey(selectedCatalogBook.source, selectedCatalogBook.sourceId),
                    )}
                    isAdding={
                      addingBookKey ===
                      sourceKey(selectedCatalogBook.source, selectedCatalogBook.sourceId)
                    }
                    onAdd={() => void addBook(selectedCatalogBook)}
                    onClose={() => setSelectedCatalogBook(null)}
                  />
                )}
              </div>
            </div>
          ) : (
            <p className="page-meta" style={{ marginTop: "2rem" }}>
              No catalog results yet.
            </p>
          )}
        </>
      ) : (
        <>
          {libraryError && (
            <InlineError onDismiss={() => setLibraryError(null)} className="mb-4">
              {libraryError}
            </InlineError>
          )}

          <div className="mb-6 flex flex-wrap gap-1" role="tablist" aria-label="Filter library by status">
            <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
              All
            </FilterPill>
            {statuses.map((status) => (
              <FilterPill
                key={status.value}
                active={filter === status.value}
                onClick={() => setFilter(status.value)}
              >
                {status.label}
              </FilterPill>
            ))}
          </div>

          {loading ? (
            <SkeletonGrid />
          ) : filteredItems.length === 0 ? (
            <EmptyState filter={filter} onAddBooks={() => setScreen("add")} />
          ) : (
            <div
              className={`grid gap-10 ${selected ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""}`}
            >
              <div className="book-grid">
                {filteredItems.map((item) => (
                  <LibraryCard
                    key={item.id}
                    item={item}
                    isSelected={selected?.id === item.id}
                    isSaving={savingId === item.id}
                    onSelect={() => setSelected(item)}
                    onProgress={(progress) => void patchItem(item.id, { progress })}
                  />
                ))}
              </div>
              {selected && (
                <DetailPanel
                  item={selected}
                  saving={savingId === selected.id}
                  error={detailError}
                  onDismissError={() => setDetailError(null)}
                  onPatch={patchItem}
                  onRemove={removeItem}
                  onClose={() => setSelected(null)}
                />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function InlineError({
  children,
  onDismiss,
  className = "",
}: {
  children: React.ReactNode;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div className={`alert alert-error ${className}`} role="alert">
      <span>{children}</span>
      <button type="button" className="btn btn-ghost" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="section-heading">{children}</h2>;
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`btn ${active ? "btn-active" : "btn-ghost"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ScreenTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={`screen-tab ${active ? "is-active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function LibraryCard({
  item,
  isSelected,
  isSaving,
  onSelect,
  onProgress,
}: {
  item: LibraryItem;
  isSelected: boolean;
  isSaving: boolean;
  onSelect: () => void;
  onProgress: (progress: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  const setProgressFromEvent = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const next = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
    if (next !== item.progress) onProgress(next);
  };

  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onProgress(Math.min(100, item.progress + 5));
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onProgress(Math.max(0, item.progress - 5));
    } else if (event.key === "Home") {
      event.preventDefault();
      onProgress(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onProgress(100);
    }
  };

  return (
    <div
      className={`book-card ${isSelected ? "is-selected" : ""}`}
      data-saving={isSaving || undefined}
    >
      <button
        type="button"
        className="book-cover"
        onClick={onSelect}
        aria-label={`${item.book.title}, open details`}
      >
        {item.book.coverUrl ? (
          <img src={item.book.coverUrl} alt="" />
        ) : (
          <span className="book-cover-empty">No cover</span>
        )}
      </button>
      <div className="book-meta">
        <h3 className="book-title">{item.book.title}</h3>
        <p className="book-author">{authorLabel(item.book.authors)}</p>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <StatusChip status={item.status} />
          <span className="book-progress-text">{item.progress}%</span>
        </div>
        <div
          ref={trackRef}
          className="progress-track mt-1"
          role="slider"
          tabIndex={0}
          aria-label={`${item.book.title} reading progress, click track or use arrow keys to set`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={item.progress}
          aria-busy={isSaving}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setProgressFromEvent(event.clientX);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              setProgressFromEvent(event.clientX);
            }
          }}
          onKeyDown={handleKey}
        >
          <div
            className="progress-fill"
            style={{ transform: `scaleX(${item.progress / 100})` }}
          />
        </div>
      </div>
    </div>
  );
}

function SearchResultCard({
  book,
  isSelected,
  isInLibrary,
  isAdding,
  onSelect,
  onAdd,
}: {
  book: CatalogBook;
  isSelected: boolean;
  isInLibrary: boolean;
  isAdding: boolean;
  onSelect: () => void;
  onAdd: () => void;
}) {
  return (
    <div className={`book-card ${isSelected ? "is-selected" : ""}`}>
      <button
        type="button"
        className="book-cover"
        onClick={onSelect}
        aria-label={`${book.title}, show catalog details`}
      >
        {book.coverUrl ? (
          <img src={book.coverUrl} alt="" />
        ) : (
          <span className="book-cover-empty">No cover</span>
        )}
      </button>
      <div className="book-meta">
        <button
          type="button"
          className="book-title-button"
          onClick={onSelect}
          aria-label={`${book.title}, show catalog details`}
        >
          {book.title}
        </button>
        <p className="book-author">{authorLabel(book.authors)}</p>
        <dl className="catalog-details">
          {book.publishedDate && (
            <div>
              <dt>Published</dt>
              <dd>{book.publishedDate}</dd>
            </div>
          )}
          {(book.isbn13 || book.isbn10) && (
            <div>
              <dt>ISBN</dt>
              <dd>{book.isbn13 ?? book.isbn10}</dd>
            </div>
          )}
        </dl>
        {book.description && <p className="catalog-description">{book.description}</p>}
        <button
          type="button"
          className="btn btn-secondary mt-2 self-start"
          onClick={onAdd}
          disabled={isInLibrary || isAdding}
        >
          {isAdding ? "Adding…" : isInLibrary ? "In library" : "Add"}
        </button>
      </div>
    </div>
  );
}

function CatalogDetailPanel({
  book,
  isInLibrary,
  isAdding,
  onAdd,
  onClose,
}: {
  book: CatalogBook;
  isInLibrary: boolean;
  isAdding: boolean;
  onAdd: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const bookKey = sourceKey(book.source, book.sourceId);

  useEffect(() => {
    asideRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    closeRef.current?.focus({ preventScroll: true });
  }, [bookKey]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);

  return (
    <aside ref={asideRef} className="card catalog-panel detail-panel" aria-label={`${book.title} catalog details`}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="panel-title">{book.title}</h2>
        <button
          ref={closeRef}
          type="button"
          className="btn btn-ghost"
          onClick={onClose}
          aria-label="Close catalog details"
        >
          Close
        </button>
      </div>

      <p className="book-author mb-5">{authorLabel(book.authors)}</p>

      <dl className="catalog-panel-details">
        {book.publishedDate && (
          <div>
            <dt>Published</dt>
            <dd>{book.publishedDate}</dd>
          </div>
        )}
        {(book.isbn13 || book.isbn10) && (
          <div>
            <dt>ISBN</dt>
            <dd>{book.isbn13 ?? book.isbn10}</dd>
          </div>
        )}
        <div>
          <dt>Source</dt>
          <dd>Google Books</dd>
        </div>
      </dl>

      {book.description ? (
        <p className="catalog-panel-description">{book.description}</p>
      ) : (
        <p className="page-meta mt-6">No catalog description available.</p>
      )}

      <button
        type="button"
        className="btn btn-primary mt-6 w-full"
        onClick={onAdd}
        disabled={isInLibrary || isAdding}
      >
        {isAdding ? "Adding…" : isInLibrary ? "Already in library" : "Add to library"}
      </button>
    </aside>
  );
}

function StatusChip({ status }: { status: BookStatus }) {
  const label = statuses.find((s) => s.value === status)?.label ?? status;
  return (
    <span className={`status-chip ${status === "reading" ? "status-chip-reading" : ""}`}>
      {label}
    </span>
  );
}

function SkeletonGrid() {
  return (
    <div className="book-grid" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="book-card">
          <div className="book-cover skeleton" />
          <div className="book-meta">
            <div className="skeleton" style={{ height: "0.875rem", width: "80%" }} />
            <div className="skeleton mt-1" style={{ height: "0.625rem", width: "55%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  filter,
  onAddBooks,
}: {
  filter: BookStatus | "all";
  onAddBooks: () => void;
}) {
  if (filter === "all") {
    return (
      <div className="empty-state">
        <p className="page-meta">Empty library.</p>
        <button type="button" className="btn btn-secondary" onClick={onAddBooks}>
          Add books
        </button>
      </div>
    );
  }
  const label = statuses.find((s) => s.value === filter)?.label ?? "this status";
  return (
    <p className="page-meta" style={{ marginTop: "2rem" }}>
      Nothing in <span style={{ textTransform: "lowercase" }}>{label}</span>.
    </p>
  );
}

function DetailPanel({
  item,
  saving,
  error,
  onDismissError,
  onPatch,
  onRemove,
  onClose,
}: {
  item: LibraryItem;
  saving: boolean;
  error: string | null;
  onDismissError: () => void;
  onPatch: (id: number, body: Record<string, unknown>) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(item.notes ?? "");
  const [review, setReview] = useState(item.review ?? "");
  const [progressDraft, setProgressDraft] = useState(item.progress);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const itemIdRef = useRef(item.id);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    itemIdRef.current = item.id;
    setNotes(item.notes ?? "");
    setReview(item.review ?? "");
    setProgressDraft(item.progress);
    setConfirmRemove(false);
    setSavedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    setProgressDraft(item.progress);
  }, [item.id, item.progress]);

  const patchField = useCallback(
    async (body: Record<string, unknown>) => {
      const targetId = item.id;
      if (itemIdRef.current !== targetId) return;
      await onPatch(targetId, body);
      if (itemIdRef.current === targetId) setSavedAt(new Date());
    },
    [item.id, onPatch],
  );

  useEffect(() => {
    if (notes === (item.notes ?? "")) return;
    const handle = setTimeout(() => {
      void patchField({ notes });
    }, 900);
    return () => clearTimeout(handle);
  }, [notes, item.notes, patchField]);

  useEffect(() => {
    if (review === (item.review ?? "")) return;
    const handle = setTimeout(() => {
      void patchField({ review });
    }, 900);
    return () => clearTimeout(handle);
  }, [review, item.review, patchField]);

  useEffect(() => {
    if (progressDraft === item.progress) return;
    const handle = setTimeout(() => {
      void patchField({ progress: progressDraft });
    }, 350);
    return () => clearTimeout(handle);
  }, [progressDraft, item.progress, patchField]);

  useEffect(() => {
    asideRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    closeRef.current?.focus({ preventScroll: true });
  }, [item.id]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);

  const saveStatus = saving ? "Saving…" : savedAt ? `Saved ${formatRelative(savedAt)}` : "";

  return (
    <aside ref={asideRef} className="card detail-panel" aria-label={`${item.book.title} details`}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="panel-title">{item.book.title}</h2>
        <button
          ref={closeRef}
          type="button"
          className="btn btn-ghost"
          onClick={onClose}
          aria-label="Close details"
        >
          Close
        </button>
      </div>
      <p className="book-author mb-5">{authorLabel(item.book.authors)}</p>

      <p
        className="page-meta mb-5"
        aria-live="polite"
        style={{ minHeight: "1rem" }}
      >
        {saveStatus}
      </p>

      {error && (
        <InlineError onDismiss={onDismissError} className="mb-4">
          {error}
        </InlineError>
      )}

      <div className="field-row">
        <label htmlFor={`status-${item.id}`}>Status</label>
        <select
          id={`status-${item.id}`}
          className="form-input"
          value={item.status}
          onChange={(event) => void patchField({ status: event.target.value as BookStatus })}
        >
          {statuses.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <label htmlFor={`progress-${item.id}`}>Progress</label>
        <span className="field-suffix">
          <input
            id={`progress-${item.id}`}
            className="form-input progress-number"
            type="number"
            min={0}
            max={100}
            step={1}
            value={progressDraft}
            onChange={(event) => setProgressDraft(clampProgress(Number(event.target.value)))}
            aria-label={`${item.book.title} progress, percent`}
          />
          <span className="field-suffix-unit" aria-hidden="true">
            %
          </span>
        </span>
      </div>

      <div className="field-row">
        <label htmlFor={`rating-${item.id}`}>Rating</label>
        <select
          id={`rating-${item.id}`}
          className="form-input"
          value={item.rating == null ? "" : String(item.rating)}
          onChange={(event) =>
            void patchField({
              rating: event.target.value === "" ? null : Number(event.target.value),
            })
          }
        >
          <option value="">Unrated</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div className="field-stack">
        <label className="form-label" htmlFor={`notes-${item.id}`}>
          Private notes
        </label>
        <textarea
          id={`notes-${item.id}`}
          className="form-input"
          style={{ minHeight: "5rem" }}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Only you see these."
        />
      </div>

      <div className="field-stack mb-6">
        <label className="form-label" htmlFor={`review-${item.id}`}>
          Review draft
        </label>
        <textarea
          id={`review-${item.id}`}
          className="form-input"
          style={{ minHeight: "5rem" }}
          value={review}
          onChange={(event) => setReview(event.target.value)}
          placeholder="Saved as draft."
        />
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        {confirmRemove ? (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setConfirmRemove(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={saving}
              onClick={() => void onRemove(item.id)}
            >
              Confirm remove
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-danger"
            disabled={saving}
            onClick={() => setConfirmRemove(true)}
          >
            Remove from library
          </button>
        )}
      </div>
    </aside>
  );
}

function formatRelative(date: Date) {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function authorLabel(authors: string[] | null | undefined) {
  if (!Array.isArray(authors)) return "Unknown author";
  const label = authors.filter(Boolean).join(", ");
  return label || "Unknown author";
}

function sourceKey(source: string, sourceId: string) {
  return `${source}:${sourceId}`;
}

function dedupeCatalogBooks(books: CatalogBook[]) {
  const seen = new Set<string>();
  const unique: CatalogBook[] = [];

  for (const book of books) {
    const keys = [
      sourceKey(book.source, book.sourceId),
      book.isbn13 ? `isbn13:${book.isbn13}` : "",
      book.isbn10 ? `isbn10:${book.isbn10}` : "",
      `title:${normaliseBookText(book.title)}|authors:${normaliseBookText(authorLabel(book.authors))}`,
    ].filter(Boolean);

    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    unique.push(book);
  }

  return unique;
}

function normaliseBookText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
