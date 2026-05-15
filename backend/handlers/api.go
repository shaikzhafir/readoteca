package handlers

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	api "readoteca/api/generated"
	"readoteca/auth"
	"readoteca/config"
	"readoteca/db"
	log "readoteca/logging"
	"readoteca/pkg/googlebooks"

	"github.com/oapi-codegen/runtime/types"
	"golang.org/x/oauth2"
)

type Catalog interface {
	Search(ctx context.Context, query string) ([]api.CatalogBook, error)
	Get(ctx context.Context, sourceID string) (api.CatalogBook, error)
}

type Server struct {
	cfg     config.Config
	store   *db.Queries
	catalog Catalog
	oauth   *oauth2.Config
}

type requestContextKey struct{}

type googleUserInfo struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
}

func NewServer(cfg config.Config, store *db.Queries, catalog Catalog) (*Server, error) {
	oauthConfig, err := auth.OAuthConfig(cfg)
	if err != nil {
		return nil, err
	}
	return &Server{
		cfg:     cfg,
		store:   store,
		catalog: catalog,
		oauth:   oauthConfig,
	}, nil
}

func RequestContextMiddleware(f api.StrictHandlerFunc, operationID string) api.StrictHandlerFunc {
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request interface{}) (interface{}, error) {
		ctx = context.WithValue(ctx, requestContextKey{}, r)
		resp, err := f(ctx, w, r, request)
		if err != nil {
			log.Error("request error op=%s method=%s path=%s err=%v", operationID, r.Method, r.URL.Path, err)
		}
		return resp, err
	}
}

func (s *Server) GoogleLogin(ctx context.Context, request api.GoogleLoginRequestObject) (api.GoogleLoginResponseObject, error) {
	state, err := encodeOAuthState(request.Params.Next)
	if err != nil {
		return nil, err
	}
	loginURL := s.oauth.AuthCodeURL(state, oauth2.AccessTypeOnline)
	return api.GoogleLogin302Response{
		Headers: api.GoogleLogin302ResponseHeaders{
			Location:  loginURL,
			SetCookie: auth.OAuthStateCookie(s.cfg, state).String(),
		},
	}, nil
}

func (s *Server) GoogleCallback(ctx context.Context, request api.GoogleCallbackRequestObject) (api.GoogleCallbackResponseObject, error) {
	if request.Params.Error != nil && *request.Params.Error != "" {
		return api.GoogleCallback400JSONResponse{Error: *request.Params.Error}, nil
	}
	if request.Params.Code == nil || request.Params.State == nil {
		return api.GoogleCallback400JSONResponse{Error: "missing oauth code or state"}, nil
	}

	httpRequest, ok := ctx.Value(requestContextKey{}).(*http.Request)
	if !ok {
		return nil, errors.New("request missing from context")
	}
	expectedState, err := auth.OAuthStateFromRequest(httpRequest)
	if err != nil || expectedState != *request.Params.State {
		return api.GoogleCallback400JSONResponse{Error: "invalid oauth state"}, nil
	}

	next, err := decodeOAuthState(*request.Params.State)
	if err != nil {
		return api.GoogleCallback400JSONResponse{Error: "invalid oauth state"}, nil
	}
	token, err := s.oauth.Exchange(ctx, *request.Params.Code)
	if err != nil {
		return api.GoogleCallback400JSONResponse{Error: "failed to exchange oauth code"}, nil
	}
	userInfo, err := s.fetchGoogleUserInfo(ctx, token)
	if err != nil {
		return api.GoogleCallback400JSONResponse{Error: "failed to fetch google user"}, nil
	}

	user, err := s.store.UpsertGoogleUser(ctx, db.UpsertGoogleUserParams{
		GoogleSub:   userInfo.ID,
		Email:       userInfo.Email,
		DisplayName: displayName(userInfo),
		AvatarUrl:   nullString(userInfo.Picture),
	})
	if err != nil {
		return nil, err
	}
	sessionID, err := auth.GenerateRandomToken()
	if err != nil {
		return nil, err
	}
	if err := s.store.CreateSession(ctx, db.CreateSessionParams{
		ID:        sessionID,
		UserID:    user.ID,
		ExpiresAt: time.Now().Add(s.cfg.SessionDuration),
	}); err != nil {
		return nil, err
	}

	callbackURL := fmt.Sprintf("%s/auth/callback?next=%s", s.cfg.FrontendURL, url.QueryEscape(next))
	return api.GoogleCallback302Response{
		Headers: api.GoogleCallback302ResponseHeaders{
			Location:  callbackURL,
			SetCookie: auth.SessionCookie(s.cfg, sessionID).String(),
		},
	}, nil
}

func (s *Server) GetMe(ctx context.Context, request api.GetMeRequestObject) (api.GetMeResponseObject, error) {
	user, err := s.currentUser(ctx)
	if err != nil {
		return api.GetMe401JSONResponse{Error: "unauthorized"}, nil
	}
	return api.GetMe200JSONResponse(userResponse(user)), nil
}

func (s *Server) Logout(ctx context.Context, request api.LogoutRequestObject) (api.LogoutResponseObject, error) {
	httpRequest, ok := ctx.Value(requestContextKey{}).(*http.Request)
	if ok {
		if sessionID, err := auth.SessionIDFromRequest(s.cfg, httpRequest); err == nil {
			_, _ = s.store.DeleteSession(ctx, sessionID)
		}
	}
	return api.Logout204Response{
		Headers: api.Logout204ResponseHeaders{
			SetCookie: auth.ClearSessionCookie(s.cfg).String(),
		},
	}, nil
}

func (s *Server) SearchBooks(ctx context.Context, request api.SearchBooksRequestObject) (api.SearchBooksResponseObject, error) {
	if _, err := s.currentUser(ctx); err != nil {
		return api.SearchBooks401JSONResponse{Error: "unauthorized"}, nil
	}
	query := strings.TrimSpace(request.Params.Q)
	if query == "" {
		return api.SearchBooks400JSONResponse{Error: "query is required"}, nil
	}
	results, err := s.catalog.Search(ctx, query)
	if err != nil {
		return nil, err
	}
	return api.SearchBooks200JSONResponse(results), nil
}

func (s *Server) ListLibrary(ctx context.Context, request api.ListLibraryRequestObject) (api.ListLibraryResponseObject, error) {
	user, err := s.currentUser(ctx)
	if err != nil {
		return api.ListLibrary401JSONResponse{Error: "unauthorized"}, nil
	}
	rows, err := s.store.ListLibraryItems(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	items := make([]api.LibraryItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, libraryItemFromListRow(row))
	}
	return api.ListLibrary200JSONResponse(items), nil
}

func (s *Server) AddLibraryItem(ctx context.Context, request api.AddLibraryItemRequestObject) (api.AddLibraryItemResponseObject, error) {
	user, err := s.currentUser(ctx)
	if err != nil {
		return api.AddLibraryItem401JSONResponse{Error: "unauthorized"}, nil
	}
	if request.Body == nil || strings.TrimSpace(request.Body.SourceId) == "" {
		return api.AddLibraryItem400JSONResponse{Error: "sourceId is required"}, nil
	}
	if request.Body.Source != api.GoogleBooks {
		return api.AddLibraryItem400JSONResponse{Error: "unsupported source"}, nil
	}

	catalogBook, err := s.catalog.Get(ctx, request.Body.SourceId)
	if err != nil {
		return nil, err
	}
	book, err := s.store.UpsertBookFromSource(ctx, db.UpsertBookFromSourceParams{
		Source:        catalogBook.Source,
		SourceID:      catalogBook.SourceId,
		Isbn10:        nullStringFromPtr(catalogBook.Isbn10),
		Isbn13:        nullStringFromPtr(catalogBook.Isbn13),
		Title:         catalogBook.Title,
		Authors:       authorsJSON(catalogBook.Authors),
		Description:   nullStringFromPtr(catalogBook.Description),
		CoverUrl:      nullStringFromPtr(catalogBook.CoverUrl),
		PublishedDate: nullStringFromPtr(catalogBook.PublishedDate),
	})
	if err != nil {
		return nil, err
	}

	if _, err := s.store.CreateLibraryItem(ctx, db.CreateLibraryItemParams{UserID: user.ID, BookID: book.ID}); err != nil {
		if !isUniqueConstraint(err) {
			return nil, err
		}
		existing, err := s.store.GetLibraryItemByUserAndBook(ctx, db.GetLibraryItemByUserAndBookParams{UserID: user.ID, BookID: book.ID})
		if err != nil {
			return nil, err
		}
		return api.AddLibraryItem200JSONResponse(libraryItemFromUserBookRow(existing)), nil
	}

	row, err := s.store.GetLibraryItemByUserAndBook(ctx, db.GetLibraryItemByUserAndBookParams{UserID: user.ID, BookID: book.ID})
	if err != nil {
		return nil, err
	}
	return api.AddLibraryItem201JSONResponse(libraryItemFromUserBookRow(row)), nil
}

func (s *Server) GetLibraryItem(ctx context.Context, request api.GetLibraryItemRequestObject) (api.GetLibraryItemResponseObject, error) {
	user, err := s.currentUser(ctx)
	if err != nil {
		return api.GetLibraryItem401JSONResponse{Error: "unauthorized"}, nil
	}
	row, err := s.store.GetLibraryItem(ctx, db.GetLibraryItemParams{UserID: user.ID, ID: request.Id})
	if errors.Is(err, sql.ErrNoRows) {
		return api.GetLibraryItem404JSONResponse{Error: "not found"}, nil
	}
	if err != nil {
		return nil, err
	}
	return api.GetLibraryItem200JSONResponse(libraryItemFromGetRow(row)), nil
}

func (s *Server) PatchLibraryItem(ctx context.Context, request api.PatchLibraryItemRequestObject) (api.PatchLibraryItemResponseObject, error) {
	user, err := s.currentUser(ctx)
	if err != nil {
		return api.PatchLibraryItem401JSONResponse{Error: "unauthorized"}, nil
	}
	if request.Body == nil {
		return api.PatchLibraryItem400JSONResponse{Error: "request body is required"}, nil
	}

	current, err := s.store.GetLibraryItem(ctx, db.GetLibraryItemParams{UserID: user.ID, ID: request.Id})
	if errors.Is(err, sql.ErrNoRows) {
		return api.PatchLibraryItem404JSONResponse{Error: "not found"}, nil
	}
	if err != nil {
		return nil, err
	}

	next := editableLibraryState{
		Status:          current.Status,
		Progress:        int(current.Progress),
		Rating:          current.Rating,
		Notes:           current.Notes,
		Review:          current.Review,
		ReviewPublished: current.ReviewPublished == 1,
		StartedAt:       current.StartedAt,
		FinishedAt:      current.FinishedAt,
		AbandonedAt:     current.AbandonedAt,
	}
	if err := next.Apply(*request.Body); err != nil {
		return api.PatchLibraryItem400JSONResponse{Error: err.Error()}, nil
	}

	_, err = s.store.UpdateLibraryItem(ctx, db.UpdateLibraryItemParams{
		Status:          next.Status,
		Progress:        int64(next.Progress),
		Rating:          next.Rating,
		Notes:           next.Notes,
		Review:          next.Review,
		ReviewPublished: boolInt(next.ReviewPublished),
		StartedAt:       next.StartedAt,
		FinishedAt:      next.FinishedAt,
		AbandonedAt:     next.AbandonedAt,
		UserID:          user.ID,
		ID:              request.Id,
	})
	if err != nil {
		return nil, err
	}
	updated, err := s.store.GetLibraryItem(ctx, db.GetLibraryItemParams{UserID: user.ID, ID: request.Id})
	if err != nil {
		return nil, err
	}
	return api.PatchLibraryItem200JSONResponse(libraryItemFromGetRow(updated)), nil
}

func (s *Server) DeleteLibraryItem(ctx context.Context, request api.DeleteLibraryItemRequestObject) (api.DeleteLibraryItemResponseObject, error) {
	user, err := s.currentUser(ctx)
	if err != nil {
		return api.DeleteLibraryItem401JSONResponse{Error: "unauthorized"}, nil
	}
	rows, err := s.store.DeleteLibraryItem(ctx, db.DeleteLibraryItemParams{UserID: user.ID, ID: request.Id})
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		return api.DeleteLibraryItem404JSONResponse{Error: "not found"}, nil
	}
	return api.DeleteLibraryItem204Response{}, nil
}

func (s *Server) currentUser(ctx context.Context) (db.User, error) {
	httpRequest, ok := ctx.Value(requestContextKey{}).(*http.Request)
	if !ok {
		return db.User{}, errors.New("request missing from context")
	}
	sessionID, err := auth.SessionIDFromRequest(s.cfg, httpRequest)
	if err != nil {
		return db.User{}, err
	}
	session, err := s.store.GetSessionByID(ctx, sessionID)
	if err != nil {
		return db.User{}, err
	}
	if session.ExpiresAt.Before(time.Now()) {
		_, _ = s.store.DeleteSession(ctx, sessionID)
		return db.User{}, errors.New("session expired")
	}
	return s.store.GetUserByID(ctx, session.UserID)
}

func (s *Server) fetchGoogleUserInfo(ctx context.Context, token *oauth2.Token) (googleUserInfo, error) {
	client := s.oauth.Client(ctx, token)
	res, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		return googleUserInfo{}, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return googleUserInfo{}, fmt.Errorf("google userinfo returned %s", res.Status)
	}
	var user googleUserInfo
	if err := json.NewDecoder(res.Body).Decode(&user); err != nil {
		return googleUserInfo{}, err
	}
	if user.ID == "" || user.Email == "" {
		return googleUserInfo{}, errors.New("google userinfo missing id or email")
	}
	return user, nil
}

type editableLibraryState struct {
	Status          string
	Progress        int
	Rating          sql.NullInt64
	Notes           sql.NullString
	Review          sql.NullString
	ReviewPublished bool
	StartedAt       sql.NullTime
	FinishedAt      sql.NullTime
	AbandonedAt     sql.NullTime
}

func (s *editableLibraryState) Apply(patch api.PatchLibraryItemRequest) error {
	now := time.Now()
	if patch.Status != nil {
		s.Status = string(*patch.Status)
	}
	if patch.Progress != nil {
		if *patch.Progress < 0 || *patch.Progress > 100 {
			return errors.New("progress must be between 0 and 100")
		}
		s.Progress = *patch.Progress
	}
	if patch.Rating != nil {
		if *patch.Rating < 1 || *patch.Rating > 5 {
			return errors.New("rating must be between 1 and 5")
		}
		s.Rating = sql.NullInt64{Int64: int64(*patch.Rating), Valid: true}
	}
	if patch.Notes != nil {
		s.Notes = sql.NullString{String: *patch.Notes, Valid: *patch.Notes != ""}
	}
	if patch.Review != nil {
		s.Review = sql.NullString{String: *patch.Review, Valid: *patch.Review != ""}
	}
	if patch.ReviewPublished != nil {
		s.ReviewPublished = *patch.ReviewPublished
	}

	switch s.Status {
	case string(api.WantToRead):
	case string(api.Reading):
		if !s.StartedAt.Valid {
			s.StartedAt = sql.NullTime{Time: now, Valid: true}
		}
	case string(api.Finished):
		if !s.FinishedAt.Valid {
			s.FinishedAt = sql.NullTime{Time: now, Valid: true}
		}
		if !s.StartedAt.Valid {
			s.StartedAt = sql.NullTime{Time: now, Valid: true}
		}
	case string(api.Abandoned):
		if !s.AbandonedAt.Valid {
			s.AbandonedAt = sql.NullTime{Time: now, Valid: true}
		}
	default:
		return errors.New("invalid status")
	}
	return nil
}

func userResponse(user db.User) api.User {
	return api.User{
		Id:          user.ID,
		Email:       types.Email(user.Email),
		DisplayName: user.DisplayName,
		AvatarUrl:   stringPtrFromNull(user.AvatarUrl),
	}
}

func libraryItemFromListRow(row db.ListLibraryItemsRow) api.LibraryItem {
	return libraryItem(
		row.ID, row.Status, int(row.Progress), row.Rating, row.Notes, row.Review, row.ReviewPublished,
		row.StartedAt, row.FinishedAt, row.AbandonedAt, row.CreatedAt, row.UpdatedAt,
		row.BookID2, row.Source, row.SourceID, row.Isbn10, row.Isbn13, row.Title, row.Authors,
		row.Description, row.CoverUrl, row.PublishedDate,
	)
}

func libraryItemFromGetRow(row db.GetLibraryItemRow) api.LibraryItem {
	return libraryItem(
		row.ID, row.Status, int(row.Progress), row.Rating, row.Notes, row.Review, row.ReviewPublished,
		row.StartedAt, row.FinishedAt, row.AbandonedAt, row.CreatedAt, row.UpdatedAt,
		row.BookID2, row.Source, row.SourceID, row.Isbn10, row.Isbn13, row.Title, row.Authors,
		row.Description, row.CoverUrl, row.PublishedDate,
	)
}

func libraryItemFromUserBookRow(row db.GetLibraryItemByUserAndBookRow) api.LibraryItem {
	return libraryItem(
		row.ID, row.Status, int(row.Progress), row.Rating, row.Notes, row.Review, row.ReviewPublished,
		row.StartedAt, row.FinishedAt, row.AbandonedAt, row.CreatedAt, row.UpdatedAt,
		row.BookID2, row.Source, row.SourceID, row.Isbn10, row.Isbn13, row.Title, row.Authors,
		row.Description, row.CoverUrl, row.PublishedDate,
	)
}

func libraryItem(
	id int64,
	status string,
	progress int,
	rating sql.NullInt64,
	notes sql.NullString,
	review sql.NullString,
	reviewPublished int64,
	startedAt sql.NullTime,
	finishedAt sql.NullTime,
	abandonedAt sql.NullTime,
	createdAt time.Time,
	updatedAt time.Time,
	bookID int64,
	source string,
	sourceID string,
	isbn10 sql.NullString,
	isbn13 sql.NullString,
	title string,
	authors string,
	description sql.NullString,
	coverURL sql.NullString,
	publishedDate sql.NullString,
) api.LibraryItem {
	return api.LibraryItem{
		Id:              id,
		Status:          api.BookStatus(status),
		Progress:        progress,
		Rating:          intPtrFromNull(rating),
		Notes:           stringPtrFromNull(notes),
		Review:          stringPtrFromNull(review),
		ReviewPublished: reviewPublished == 1,
		StartedAt:       timePtrFromNull(startedAt),
		FinishedAt:      timePtrFromNull(finishedAt),
		AbandonedAt:     timePtrFromNull(abandonedAt),
		CreatedAt:       createdAt,
		UpdatedAt:       updatedAt,
		Book: api.Book{
			Id:            bookID,
			Source:        source,
			SourceId:      sourceID,
			Isbn10:        stringPtrFromNull(isbn10),
			Isbn13:        stringPtrFromNull(isbn13),
			Title:         title,
			Authors:       authorsFromJSON(authors),
			Description:   stringPtrFromNull(description),
			CoverUrl:      stringPtrFromNull(coverURL),
			PublishedDate: stringPtrFromNull(publishedDate),
		},
	}
}

func encodeOAuthState(next *string) (string, error) {
	token, err := auth.GenerateRandomToken()
	if err != nil {
		return "", err
	}
	payload := token + "|" + auth.SafeNext(next)
	return base64.RawURLEncoding.EncodeToString([]byte(payload)), nil
}

func decodeOAuthState(state string) (string, error) {
	bytes, err := base64.RawURLEncoding.DecodeString(state)
	if err != nil {
		return "", err
	}
	parts := strings.SplitN(string(bytes), "|", 2)
	if len(parts) != 2 {
		return "", errors.New("invalid state")
	}
	next := parts[1]
	return auth.SafeNext(&next), nil
}

func displayName(user googleUserInfo) string {
	if user.Name != "" {
		return user.Name
	}
	return user.Email
}

func authorsJSON(authors []string) string {
	if authors == nil {
		return "[]"
	}
	bytes, err := json.Marshal(authors)
	if err != nil {
		return "[]"
	}
	return string(bytes)
}

func authorsFromJSON(value string) []string {
	var authors []string
	if err := json.Unmarshal([]byte(value), &authors); err != nil {
		return []string{}
	}
	return authors
}

func nullString(value string) sql.NullString {
	return sql.NullString{String: value, Valid: value != ""}
}

func nullStringFromPtr(value *string) sql.NullString {
	if value == nil || *value == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: *value, Valid: true}
}

func stringPtrFromNull(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func intPtrFromNull(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}
	i := int(value.Int64)
	return &i
}

func timePtrFromNull(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func boolInt(value bool) int64 {
	if value {
		return 1
	}
	return 0
}

func isUniqueConstraint(err error) bool {
	return strings.Contains(strings.ToLower(err.Error()), "unique constraint")
}

var _ api.StrictServerInterface = (*Server)(nil)
var _ Catalog = (*googlebooks.Service)(nil)
