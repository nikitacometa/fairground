.PHONY: install build test lint typecheck dev clean \
        contracts-build contracts-test contracts-generate \
        db-migrate db-generate db-studio \
        localnet-start localnet-stop localnet-reset \
        docker-up docker-down docker-logs \
        proof-card-test

# ─── Setup ───────────────────────────────────────────────────────────────────

install:
	pnpm install

# ─── Build ───────────────────────────────────────────────────────────────────

build:
	pnpm turbo run build

# ─── Development ─────────────────────────────────────────────────────────────

dev:
	pnpm turbo run dev --parallel

# ─── Testing ─────────────────────────────────────────────────────────────────

test:
	pnpm turbo run test

test-watch:
	pnpm turbo run test -- --watch

# ─── Linting ─────────────────────────────────────────────────────────────────

lint:
	pnpm turbo run lint

lint-check:
	pnpm turbo run lint:check

typecheck:
	pnpm turbo run typecheck

format:
	pnpm prettier --write "**/*.{ts,tsx,js,json,md}" --ignore-path .gitignore

format-check:
	pnpm prettier --check "**/*.{ts,tsx,js,json,md}" --ignore-path .gitignore

# ─── Contracts (AlgoKit / Puya) ──────────────────────────────────────────────

contracts-build:
	cd packages/contracts && algokit project run build

# Run after contracts-build. Outputs ARC-56 JSON to packages/contracts/artifacts/.
contracts-test:
	cd packages/contracts && algokit project run test

# Regenerate typed TS clients in packages/sdk/src/clients/ from ARC-56 artifacts.
# Run after any contract ABI change. Never edit generated clients by hand.
contracts-generate:
	cd packages/contracts && algokit generate client \
		--language typescript \
		--output ../../sdk/src/clients/ \
		artifacts/

# ─── Database ────────────────────────────────────────────────────────────────

db-migrate:
	pnpm --filter @fairground/db run db:migrate

db-generate:
	pnpm --filter @fairground/db run db:generate

db-studio:
	pnpm --filter @fairground/db run db:studio

# ─── AlgoKit LocalNet ────────────────────────────────────────────────────────

localnet-start:
	algokit localnet start

localnet-stop:
	algokit localnet stop

localnet-reset:
	algokit localnet reset

# ─── Docker Compose ──────────────────────────────────────────────────────────

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

# ─── Proof Card ──────────────────────────────────────────────────────────────

# Quick smoke test for the proof card generator.
# Writes a test PNG to /tmp/fairground-proof-test.png.
proof-card-test:
	pnpm --filter @fairground/proof-card run cli -- \
		--txn-id TEST000000000000 \
		--outcome heads \
		--wallet AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA \
		--vrf-round 100 \
		--output /tmp/fairground-proof-test.png

# ─── Clean ───────────────────────────────────────────────────────────────────

clean:
	pnpm turbo run clean
	rm -rf node_modules
