# Task entry points for the SDD plugin.
#
# The plugin itself is mostly markdown — skills/, references/, docs/ — but three
# things can break without anything else noticing: the docs-site build scripts
# (which have real unit tests), the Docusaurus site itself (CI deploys it on
# every push to main), and the plugin's own structure (manifest, skill
# frontmatter, skills/_index.json, evals/). `make test` covers the first two,
# `make lint` the third, and `make scan` checks that no credential has been
# committed. `make check` runs all three.
#
# The behavioural test suite is evals/, which drives real Claude sessions and
# needs CLAUDE_CODE_OAUTH_TOKEN. It runs in CI only — see
# .github/workflows/skill-evals.yml.

DOCS_SITE := docs-site
NODE_MODULES := $(DOCS_SITE)/node_modules

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# --- The three every repo exposes ------------------------------------------

.PHONY: check
check: test lint scan ## Run tests, linters, and the secret scan

.PHONY: test
test: test-unit build ## Run the build-script unit tests, then build the docs site

.PHONY: lint
lint: lint-structure lint-types ## Validate plugin structure and docs-site types

# Kept out of `lint` deliberately: lint is static analysis of the tree, while
# this also reads git history and needs a separate tool installed. CI runs it
# as its own job for the same reason — when it fails you want the run to say
# "gitleaks", not "lint".
.PHONY: scan
scan: ## Scan git history and the working tree for committed secrets
	./scripts/gitleaks-scan.sh

# --- Test components -------------------------------------------------------

# node --test over the docs-site build scripts. Fails loudly when no test files
# are found, so a rename that orphans the suite cannot pass as a green run.
.PHONY: test-unit
test-unit: $(NODE_MODULES) ## Run the docs-site build-script unit tests
	@files=$$(find $(DOCS_SITE)/scripts -name '*.test.js' -not -path '*/node_modules/*'); \
		if [ -z "$$files" ]; then \
			echo "no *.test.js files found under $(DOCS_SITE)/scripts" >&2; exit 1; \
		fi; \
		node --test $$files

# --- Lint components -------------------------------------------------------

.PHONY: lint-structure
lint-structure: ## Check the plugin manifest, skill frontmatter, and JSON syntax
	./scripts/check-structure.sh

.PHONY: lint-types
lint-types: $(NODE_MODULES) ## Typecheck the docs site
	cd $(DOCS_SITE) && npm run typecheck

# --- Build and serve -------------------------------------------------------

.PHONY: build
build: $(NODE_MODULES) ## Build the docs site (content transforms + Docusaurus)
	cd $(DOCS_SITE) && npm run build

.PHONY: dev
dev: $(NODE_MODULES) ## Run the docs site with live content reload
	cd $(DOCS_SITE) && npm run dev

.PHONY: serve
serve: $(NODE_MODULES) ## Serve the built docs site locally
	cd $(DOCS_SITE) && npm run serve

# --- Dependencies and cleanup ----------------------------------------------

.PHONY: install
install: $(NODE_MODULES) ## Install docs-site dependencies

# Reinstall whenever the lockfile moves. The touch keeps make from reinstalling
# on every invocation, since npm ci does not necessarily bump the directory's
# mtime past the lockfile's.
$(NODE_MODULES): $(DOCS_SITE)/package-lock.json
	cd $(DOCS_SITE) && npm ci
	@touch $@

.PHONY: clean
clean: ## Remove generated docs and build output
	rm -rf docs-generated $(DOCS_SITE)/build $(DOCS_SITE)/.docusaurus

.PHONY: distclean
distclean: clean ## Also remove installed dependencies
	rm -rf $(NODE_MODULES)
