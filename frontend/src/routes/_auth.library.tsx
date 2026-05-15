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

  const stats = useMemo(() => {
    const counts: Record<BookStatus, number> = {
      want_to_read: 0,
      reading: 0,
      finished: 0,
      abandoned: 0,
    };
    for (const item of items) counts[item.status] += 1;
    return { total: items.length, byStatus: counts };
  }, [items]);

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

  const runSearch = async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSelectedCatalogBook(null);
    try {
      const data = await apiFetch<CatalogBook[]>(
        `/books/search?q=${encodeURIComponent(q.trim())}`,
      );
      setResults(data);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const searchBooks = (event: React.FormEvent) => {
    event.preventDefault();
    void runSearch(query);
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

  const patchItem = useCallback(async (id: number, body: Record<string, unknown>) => {
    setSavingId(id);
    setDetailError(null);
    let snapshot: LibraryItem | undefined;
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        snapshot = item;
        return { ...item, ...body } as LibraryItem;
      }),
    );
    setSelected((current) =>
      current?.id === id ? ({ ...current, ...body } as LibraryItem) : current,
    );
    try {
      const updated = await apiFetch<LibraryItem>(`/library/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setItems((current) => current.map((item) => (item.id === id ? updated : item)));
      setSelected((current) => (current?.id === id ? updated : current));
    } catch (err) {
      if (snapshot) {
        const prior = snapshot;
        setItems((current) => current.map((item) => (item.id === id ? prior : item)));
        setSelected((current) => (current?.id === id ? prior : current));
      }
      setDetailError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingId(null);
    }
  }, []);

  const removeItem = useCallback(async (id: number) => {
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
  }, []);

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
              {stats.total} {stats.total === 1 ? "book" : "books"}
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
            <InlineError
              onDismiss={() => setSearchError(null)}
              onRetry={query.trim() ? () => void runSearch(query) : undefined}
              className="-mt-6 mb-8 sm:max-w-xl"
            >
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
                  <>
                    <button
                      type="button"
                      className="detail-backdrop"
                      aria-label="Close details"
                      onClick={() => setSelectedCatalogBook(null)}
                    />
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
                  </>
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
            <InlineError
              onDismiss={() => setLibraryError(null)}
              onRetry={() => void loadLibrary()}
              className="mb-4"
            >
              {libraryError}
            </InlineError>
          )}

          <div className="mb-6 flex flex-wrap gap-1" role="tablist" aria-label="Filter library by status">
            <FilterPill active={filter === "all"} onClick={() => setFilter("all")} count={stats.total}>
              All
            </FilterPill>
            {statuses.map((status) => (
              <FilterPill
                key={status.value}
                active={filter === status.value}
                onClick={() => setFilter(status.value)}
                count={stats.byStatus[status.value]}
              >
                {status.label}
              </FilterPill>
            ))}
          </div>

          {loading ? (
            <SkeletonGrid />
          ) : filteredItems.length === 0 ? (
            <EmptyState
              filter={filter}
              onAddBooks={() => setScreen("add")}
              onShowAll={() => setFilter("all")}
            />
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
                  />
                ))}
              </div>
              {selected && (
                <>
                  <button
                    type="button"
                    className="detail-backdrop"
                    aria-label="Close details"
                    onClick={() => setSelected(null)}
                  />
                  <DetailPanel
                    item={selected}
                    saving={savingId === selected.id}
                    error={detailError}
                    onDismissError={() => setDetailError(null)}
                    onPatch={patchItem}
                    onRemove={removeItem}
                    onClose={() => setSelected(null)}
                  />
                </>
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
  onRetry,
  className = "",
}: {
  children: React.ReactNode;
  onDismiss: () => void;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={`alert alert-error ${className}`} role="alert">
      <span>{children}</span>
      <div className="flex gap-1">
        {onRetry && (
          <button type="button" className="btn btn-ghost" onClick={onRetry}>
            Retry
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
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
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`btn ${active ? "btn-active" : "btn-ghost"}`}
      onClick={onClick}
    >
      <span>{children}</span>
      <span className="filter-pill-count">{count}</span>
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
}: {
  item: LibraryItem;
  isSelected: boolean;
  isSaving: boolean;
  onSelect: () => void;
}) {
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
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <StatusChip status={item.status} />
          <span className="book-progress-text">{item.progress}%</span>
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

  useLockBodyScrollOnMobile();

  useEffect(() => {
    scrollIntoViewIfNeeded(asideRef.current);
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
      <div className="detail-panel-body">
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
      </div>
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
  onShowAll,
}: {
  filter: BookStatus | "all";
  onAddBooks: () => void;
  onShowAll: () => void;
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
    <div className="empty-state">
      <p className="page-meta">Nothing in <span className="lowercase">{label}</span>.</p>
      <button type="button" className="btn btn-ghost" onClick={onShowAll}>
        Show all
      </button>
    </div>
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
  const lastPatchRef = useRef<Record<string, unknown> | null>(null);

  useLockBodyScrollOnMobile();

  useEffect(() => {
    itemIdRef.current = item.id;
    setNotes(item.notes ?? "");
    setReview(item.review ?? "");
    setProgressDraft(item.progress);
    setConfirmRemove(false);
    setSavedAt(null);
    lastPatchRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const patchField = useCallback(
    async (body: Record<string, unknown>) => {
      const targetId = item.id;
      if (itemIdRef.current !== targetId) return;
      lastPatchRef.current = body;
      await onPatch(targetId, body);
      if (itemIdRef.current === targetId) setSavedAt(new Date());
    },
    [item.id, onPatch],
  );

  const retryLastPatch = lastPatchRef.current
    ? () => void patchField(lastPatchRef.current as Record<string, unknown>)
    : undefined;

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

  const commitProgress = useCallback(() => {
    if (progressDraft === item.progress) return;
    void patchField({ progress: progressDraft });
  }, [progressDraft, item.progress, patchField]);

  useEffect(() => {
    scrollIntoViewIfNeeded(asideRef.current);
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
      <div className="detail-panel-body">
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

      <p className="page-meta mb-5 min-h-4" aria-live="polite">
        {saveStatus}
      </p>

      {error && (
        <InlineError
          onDismiss={onDismissError}
          onRetry={retryLastPatch}
          className="mb-4"
        >
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
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            value={String(progressDraft)}
            onChange={(event) => setProgressDraft(sanitizeProgress(event.target.value))}
            onBlur={commitProgress}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
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
          className="form-input min-h-20"
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
          className="form-input min-h-20"
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
      </div>
    </aside>
  );
}

function formatRelative(date: Date) {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function sanitizeProgress(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return 0;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
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

function scrollIntoViewIfNeeded(el: HTMLElement | null) {
  if (!el) return;
  if (window.getComputedStyle(el).position === "fixed") return;
  const rect = el.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  if (rect.top >= 0 && rect.bottom <= viewportHeight) return;
  el.scrollIntoView({ block: "nearest", behavior: "auto" });
}

function useLockBodyScrollOnMobile() {
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    if (!mq.matches) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);
}
