package googlebooks

import (
	"encoding/json"
	"strings"
	"testing"

	booksapi "google.golang.org/api/books/v1"
)

func TestNormalizeUsesEmptyAuthorsArrayWhenGoogleAuthorsMissing(t *testing.T) {
	book := normalize(&booksapi.Volume{
		Id: "volume-1",
		VolumeInfo: &booksapi.VolumeVolumeInfo{
			Title: "Authorless Book",
		},
	})

	if book.Authors == nil {
		t.Fatal("expected authors to be an empty slice, got nil")
	}

	bytes, err := json.Marshal(book)
	if err != nil {
		t.Fatal(err)
	}
	if string(bytes) == "" || !json.Valid(bytes) {
		t.Fatalf("expected valid JSON, got %s", bytes)
	}
	if got := string(bytes); !strings.Contains(got, `"authors":[]`) {
		t.Fatalf("expected authors to encode as [], got %s", got)
	}
}
