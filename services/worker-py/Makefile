.PHONY: install lint typecheck format format-check test clean run

install:
	pip install -e ".[dev]"

lint:
	@if [ -d tests ]; then ruff check src/ tests/; else ruff check src/; fi

typecheck:
	mypy src/

format:
	@if [ -d tests ]; then ruff format src/ tests/; else ruff format src/; fi

format-check:
	@if [ -d tests ]; then ruff format --check src/ tests/; else ruff format --check src/; fi

test:
	@if [ -d tests ]; then pytest tests/ -v; else pytest -v; fi

clean:
	rm -rf build/ dist/ *.egg-info __pycache__ .pytest_cache .mypy_cache .ruff_cache
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

run:
	python -m jobforge_worker.cli
