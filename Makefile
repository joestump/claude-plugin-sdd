# SDD plugin — test and lint entry points.
#
# This repo is a Claude Code plugin: markdown skills, JSON manifests, eval
# definitions, and a Docusaurus docs site. `make test` and `make lint` wrap the
# native tooling for each of those, and .github/workflows/ci.yml runs the same
# targets so local and CI cannot drift.
#
# The skill evals under evals/ are graded by an LLM in CI (see
# .github/workflows/skill-evals.yml) and are deliberately NOT run here — `make
# lint` validates that their definitions are well-formed and reference real
# skills, which is the part that can be checked deterministically.

NPM ?= npm
DOCS_DIR := docs-site
DOCS_MODULES := $(DOCS_DIR)/node_modules

.DEFAULT_GOAL := help
.PHONY: help check test lint deps structure docs-test docs-typecheck docs-build clean

help: ## Show this help
	@printf 'Targets:\n'
	@grep -hE '^[a-z][a-z-]*:.*?## ' $(MAKEFILE_LIST) \
		| sed 's/:.*## /\t/' \
		| awk -F'\t' '{ printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 }'

check: lint test ## Run lint and test

test: docs-test ## Run the deterministic test suites

lint: structure docs-typecheck ## Validate repo structure and typecheck the docs site

structure: ## Validate plugin manifests, skill frontmatter, and eval definitions
	@./scripts/check-structure.sh

docs-test: $(DOCS_MODULES) ## Run the docs-site build-script unit tests
	@files=$$(find $(DOCS_DIR)/scripts -name '*.test.js' -not -path '*/node_modules/*'); \
		if [ -z "$$files" ]; then echo "no test files found under $(DOCS_DIR)/scripts"; exit 1; fi; \
		node --test $$files

docs-typecheck: $(DOCS_MODULES) ## Typecheck the docs-site TypeScript sources
	@$(NPM) --prefix $(DOCS_DIR) run typecheck

docs-build: $(DOCS_MODULES) ## Build the docs site (what deploy-docs.yml runs)
	@$(NPM) --prefix $(DOCS_DIR) run build

deps: $(DOCS_MODULES) ## Install docs-site dependencies

$(DOCS_MODULES): $(DOCS_DIR)/package-lock.json
	@$(NPM) --prefix $(DOCS_DIR) ci
	@touch $@

clean: ## Remove generated docs output and installed dependencies
	@rm -rf $(DOCS_MODULES) $(DOCS_DIR)/build $(DOCS_DIR)/.docusaurus docs-generated
