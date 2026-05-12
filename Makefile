.PHONY: generate generate-backend generate-frontend test test-backend test-frontend install backend frontend start reset-db

generate: generate-backend generate-frontend

generate-backend:
	cd backend && sqlc generate
	cd backend && go generate ./api/openapi

generate-frontend:
	cd frontend && npm run generate:api

install:
	cd frontend && npm install

test: test-backend test-frontend

test-backend:
	cd backend && go test ./...

test-frontend:
	cd frontend && npm run build

backend: generate-backend
	cd backend && set -a && . ./.env && set +a && go run main.go

frontend: generate-frontend
	cd frontend && npm run dev

start: generate install
	cd backend && set -a && . ./.env && set +a && go run main.go & \
	sleep 1; \
	cd frontend && npm run dev

reset-db:
	rm -f backend/books.db
