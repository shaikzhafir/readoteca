#!/bin/bash
find ./.. \( -name "*.go" -o -name "*.html" \) ! -name "*_test.go" | entr -r go run ./cmd/server/main.go