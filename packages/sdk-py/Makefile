.PHONY: install lint typecheck format format-check test clean

install:
	pip install -e ".[dev]"

lint:
	ruff check src/ tests/

typecheck:
	mypy src/

format:
	ruff format src/ tests/

format-check:
	ruff format --check src/ tests/

test:
	pytest tests/ -v

clean:
	rm -rf build/ dist/ *.egg-info __pycache__ .pytest_cache .mypy_cache .ruff_cache
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
