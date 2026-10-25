.PHONY: dev dev-live dev-mock test build assets

dev: dev-live

dev-live:
	./scripts/dev-live.sh

dev-mock:
	APP_MODE=mock ./scripts/dev.sh

test:
	cd frontend && npm run typecheck
	cd backend && .venv/bin/python -m unittest discover -s tests -v

build:
	cd frontend && npm run build

assets:
	python3 scripts/generate_assets.py
	python3 scripts/generate_state_fx.py
