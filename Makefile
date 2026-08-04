# =======================================================================================
# Mait AI — developer task runner
#
# `make help` lists everything. Targets are thin wrappers over docker compose and the
# per-workstream tooling, so nothing here hides a command you cannot run yourself.
# =======================================================================================

COMPOSE := docker compose -f infra/docker-compose.yml
API     := $(COMPOSE) exec api

.DEFAULT_GOAL := help
.PHONY: help up down restart logs shell dbshell migrate makemigrations superuser seed \
        test test-backend test-mobile test-admin lint lint-backend lint-mobile format \
        schema check-schema audit build clean

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	 awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# -- environment -------------------------------------------------------------------------
up: ## Start the full local stack (MySQL, Redis, API, Celery, Flower, admin web)
	$(COMPOSE) up -d --build
	@echo "API      → http://localhost:8000/api/v1/"
	@echo "Swagger  → http://localhost:8000/api/docs/"
	@echo "Admin    → http://localhost:8080/"
	@echo "Flower   → http://localhost:5555/"

down: ## Stop the stack (volumes are preserved)
	$(COMPOSE) down

restart: ## Restart the API container
	$(COMPOSE) restart api celery-worker celery-beat

logs: ## Tail logs from every service
	$(COMPOSE) logs -f --tail=100

shell: ## Django shell inside the API container
	$(API) python manage.py shell_plus || $(API) python manage.py shell

dbshell: ## MySQL shell
	$(COMPOSE) exec mysql mysql -umaitai -pmaitai maitai

# -- database ----------------------------------------------------------------------------
migrate: ## Apply database migrations
	$(API) python manage.py migrate

makemigrations: ## Generate migrations from model changes
	$(API) python manage.py makemigrations

superuser: ## Create a Super Admin account
	$(API) python manage.py createsuperuser

seed: ## Load development fixtures (never real SAP data — see CONTRIBUTING.md)
	$(API) python manage.py loaddata fixtures/dev_seed.json

# -- testing -----------------------------------------------------------------------------
test: test-backend test-mobile ## Run every test suite

test-backend: ## pytest with coverage (fails under 80%)
	$(API) pytest

test-mobile: ## Jest unit tests for the mobile app
	cd mobile && npm test

test-admin: ## Cypress E2E for the admin portal
	cd admin-web && npm run test:e2e

# -- quality -----------------------------------------------------------------------------
lint: lint-backend lint-mobile ## Lint everything

lint-backend: ## Ruff + Black check + mypy
	$(API) ruff check .
	$(API) black --check .
	$(API) mypy apps config

lint-mobile: ## ESLint + TypeScript for mobile and admin web
	cd mobile && npm run lint && npm run typecheck
	cd admin-web && npm run lint

format: ## Auto-format Python and JS/TS
	$(API) ruff check --fix .
	$(API) black .
	cd mobile && npm run format

# -- API contract ------------------------------------------------------------------------
schema: ## Regenerate backend/openapi.yaml from the code
	$(API) python manage.py spectacular --file openapi.yaml --validate

check-schema: ## Fail if the committed schema has drifted (CI runs this)
	$(API) python manage.py spectacular --file /tmp/openapi.yaml --validate
	$(API) diff -u openapi.yaml /tmp/openapi.yaml

audit: ## Dependency vulnerability scan
	$(API) pip-audit -r requirements/base.txt
	cd mobile && npm audit --audit-level=high

# -- build -------------------------------------------------------------------------------
build: ## Build the production API image
	docker build -t maitai-api:local -f backend/Dockerfile backend

clean: ## Remove containers and volumes — DESTROYS local database data
	$(COMPOSE) down -v
