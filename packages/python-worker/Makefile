# JobForge Python Worker - Development Commands

.PHONY: help install test lint typecheck format check clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	pip install -r requirements-dev.txt

test: ## Run tests
	pytest -v

test-cov: ## Run tests with coverage
	pytest --cov=jobforge_worker --cov-report=term-missing --cov-report=html

lint: ## Run linter
	ruff check src tests examples

lint-fix: ## Run linter with auto-fix
	ruff check --fix src tests examples

typecheck: ## Run type checker
	mypy src

format: ## Format code
	ruff format src tests examples

format-check: ## Check code formatting
	ruff format --check src tests examples

check: format-check lint typecheck test ## Run all checks (CI)

clean: ## Clean build artifacts
	rm -rf build/ dist/ *.egg-info
	rm -rf .pytest_cache .mypy_cache .ruff_cache
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
