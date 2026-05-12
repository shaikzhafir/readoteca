package handlers

import (
	log "readoteca/logging"
	"encoding/json"
	"net/http"
)

// JSONResponse represents a standard JSON response structure
type JSONResponse struct {
	Error   string      `json:"error,omitempty"`
	Message string      `json:"message,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

// WriteJSON writes a JSON response with the given status code
func WriteJSON(w http.ResponseWriter, status int, response JSONResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(response)
}

func WriteJSONWithRedirect(w http.ResponseWriter, status int, response JSONResponse, redirectURL string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Location", redirectURL)
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(response)
}

// WriteJSONError is a helper function for writing error responses
func WriteJSONError(w http.ResponseWriter, message string, status int) {
	log.Error("Error: %s, Status: %d", message, status)
	WriteJSON(w, status, JSONResponse{
		Error: message,
	})
}
