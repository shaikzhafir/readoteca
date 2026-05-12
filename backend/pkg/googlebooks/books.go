package googlebooks

import (
	"context"

	api "readoteca/api/generated"

	booksapi "google.golang.org/api/books/v1"
	"google.golang.org/api/option"
)

const Source = "google_books"

type Catalog interface {
	Search(ctx context.Context, query string) ([]api.CatalogBook, error)
	Get(ctx context.Context, sourceID string) (api.CatalogBook, error)
}

type Service struct {
	srv *booksapi.Service
}

func New(apiKey string) (*Service, error) {
	opts := []option.ClientOption{}
	if apiKey != "" {
		opts = append(opts, option.WithAPIKey(apiKey))
	}
	srv, err := booksapi.NewService(context.Background(), opts...)
	if err != nil {
		return nil, err
	}
	return &Service{srv: srv}, nil
}

func (s *Service) Search(ctx context.Context, query string) ([]api.CatalogBook, error) {
	volumes, err := s.srv.Volumes.List(query).Context(ctx).MaxResults(20).Do()
	if err != nil {
		return nil, err
	}
	results := make([]api.CatalogBook, 0, len(volumes.Items))
	for _, volume := range volumes.Items {
		if volume == nil || volume.Id == "" || volume.VolumeInfo == nil || volume.VolumeInfo.Title == "" {
			continue
		}
		results = append(results, normalize(volume))
	}
	return results, nil
}

func (s *Service) Get(ctx context.Context, sourceID string) (api.CatalogBook, error) {
	volume, err := s.srv.Volumes.Get(sourceID).Context(ctx).Do()
	if err != nil {
		return api.CatalogBook{}, err
	}
	return normalize(volume), nil
}

func normalize(volume *booksapi.Volume) api.CatalogBook {
	info := volume.VolumeInfo
	isbn10, isbn13 := identifiers(info.IndustryIdentifiers)
	return api.CatalogBook{
		Source:        Source,
		SourceId:      volume.Id,
		Isbn10:        stringPtr(isbn10),
		Isbn13:        stringPtr(isbn13),
		Title:         info.Title,
		Authors:       authors(info.Authors),
		Description:   stringPtr(info.Description),
		CoverUrl:      coverURL(info.ImageLinks),
		PublishedDate: stringPtr(info.PublishedDate),
	}
}

func authors(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func identifiers(ids []*booksapi.VolumeVolumeInfoIndustryIdentifiers) (string, string) {
	var isbn10 string
	var isbn13 string
	for _, id := range ids {
		if id == nil {
			continue
		}
		switch id.Type {
		case "ISBN_10":
			isbn10 = id.Identifier
		case "ISBN_13":
			isbn13 = id.Identifier
		}
	}
	return isbn10, isbn13
}

func coverURL(links *booksapi.VolumeVolumeInfoImageLinks) *string {
	if links == nil {
		return nil
	}
	if links.Thumbnail != "" {
		return &links.Thumbnail
	}
	if links.SmallThumbnail != "" {
		return &links.SmallThumbnail
	}
	return nil
}

func stringPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
