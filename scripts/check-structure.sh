#!/usr/bin/env bash
#
# Structural validation for the SDD plugin repo.
#
# This is the deterministic half of `make lint`: everything that can be
# checked without an LLM. The skill evals in evals/ are graded by
# anthropics/claude-code-action in CI and are NOT run here.
#
# Checks:
#   1. Every tracked *.json file parses.
#   2. .claude-plugin/plugin.json and marketplace.json carry required fields.
#   3. Every skills/<name>/SKILL.md has frontmatter with a name matching its
#      directory and a non-empty description.
#   4. skills/_index.json matches the schema shape and is bidirectionally
#      consistent with the skills/ directory.
#   5. evals/evals.json, evals/triggers/*.json and evals/pipeline/*.json are
#      well-formed and reference skills that exist.
#
# Coverage gaps (a skill with no evals or no trigger file) are reported as
# advisories and do not fail the run.

set -uo pipefail

cd "$(dirname "$0")/.."

ERRORS=0
NOTES=0

err() {
	printf '  \033[31mFAIL\033[0m %s\n' "$1"
	ERRORS=$((ERRORS + 1))
}

note() {
	printf '  \033[33mNOTE\033[0m %s\n' "$1"
	NOTES=$((NOTES + 1))
}

section() {
	printf '\n\033[1m%s\033[0m\n' "$1"
}

command -v jq >/dev/null 2>&1 || {
	echo "check-structure.sh requires jq (brew install jq / apt-get install jq)" >&2
	exit 2
}

# Print the YAML frontmatter block of a markdown file (contents between the
# leading '---' and the next '---'). Empty output means no frontmatter.
frontmatter() {
	awk 'NR == 1 && $0 != "---" { exit } NR > 1 { if ($0 == "---") exit; print }' "$1"
}

# Value of a top-level scalar key in a frontmatter block, with surrounding
# whitespace and quotes stripped.
fm_value() {
	printf '%s\n' "$1" | sed -n "s/^$2:[[:space:]]*//p" | head -1 | sed 's/^["'\'']//; s/["'\'']$//'
}

SKILL_DIRS=()
for dir in skills/*/; do
	SKILL_DIRS+=("$(basename "$dir")")
done

skill_exists() {
	local candidate="$1" name
	for name in "${SKILL_DIRS[@]}"; do
		[[ "$name" == "$candidate" ]] && return 0
	done
	return 1
}

# --- 1. JSON syntax ----------------------------------------------------------

section "JSON syntax"
json_count=0
while IFS= read -r file; do
	json_count=$((json_count + 1))
	jq empty "$file" >/dev/null 2>&1 || err "$file is not valid JSON"
done < <(git ls-files '*.json')
echo "  checked $json_count tracked JSON files"

# --- 2. Plugin manifests -----------------------------------------------------

section "Plugin manifests"
PLUGIN_MANIFEST=.claude-plugin/plugin.json
if [[ -f "$PLUGIN_MANIFEST" ]]; then
	jq -e '.name | type == "string" and length > 0' "$PLUGIN_MANIFEST" >/dev/null ||
		err "$PLUGIN_MANIFEST: missing or empty name"
	version=$(jq -r '.version // ""' "$PLUGIN_MANIFEST")
	[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+].*)?$ ]] ||
		err "$PLUGIN_MANIFEST: version '$version' is not semver"
	jq -e '.description | type == "string" and length > 0' "$PLUGIN_MANIFEST" >/dev/null ||
		err "$PLUGIN_MANIFEST: missing or empty description"
	echo "  $PLUGIN_MANIFEST declares version $version"
else
	err "$PLUGIN_MANIFEST is missing"
fi

MARKETPLACE=.claude-plugin/marketplace.json
if [[ -f "$MARKETPLACE" ]]; then
	jq -e '.name | type == "string" and length > 0' "$MARKETPLACE" >/dev/null ||
		err "$MARKETPLACE: missing or empty name"
	jq -e '.plugins | type == "array" and length > 0' "$MARKETPLACE" >/dev/null ||
		err "$MARKETPLACE: plugins must be a non-empty array"
	jq -e 'all(.plugins[]; (.name | type == "string" and length > 0) and (.source.repo | type == "string" and length > 0))' \
		"$MARKETPLACE" >/dev/null ||
		err "$MARKETPLACE: every plugin entry needs a name and source.repo"
else
	err "$MARKETPLACE is missing"
fi

# --- 3. SKILL.md frontmatter -------------------------------------------------

section "Skill frontmatter"
for name in "${SKILL_DIRS[@]}"; do
	file="skills/$name/SKILL.md"
	if [[ ! -f "$file" ]]; then
		err "skills/$name/ has no SKILL.md"
		continue
	fi
	block=$(frontmatter "$file")
	if [[ -z "$block" ]]; then
		err "$file: no YAML frontmatter block"
		continue
	fi
	fm_name=$(fm_value "$block" name)
	fm_desc=$(fm_value "$block" description)
	[[ -n "$fm_name" ]] || err "$file: frontmatter is missing 'name'"
	[[ -z "$fm_name" || "$fm_name" == "$name" ]] ||
		err "$file: frontmatter name '$fm_name' does not match directory '$name'"
	[[ -n "$fm_desc" ]] || err "$file: frontmatter is missing 'description'"
done
echo "  checked ${#SKILL_DIRS[@]} skills"

# --- 4. skills/_index.json ---------------------------------------------------

section "Skills manifest"
MANIFEST=skills/_index.json
if [[ -f "$MANIFEST" ]]; then
	jq -e 'type == "object" and length > 0' "$MANIFEST" >/dev/null ||
		err "$MANIFEST: must be a non-empty object of group -> [skill]"
	jq -e 'all(.[]; type == "array" and length > 0 and (all(.[]; type == "string" and test("^[a-z0-9][a-z0-9-]*$"))))' \
		"$MANIFEST" >/dev/null ||
		err "$MANIFEST: every group must be a non-empty array of kebab-case skill names"

	listed=$(jq -r '[.[][]] | .[]' "$MANIFEST")
	duplicates=$(printf '%s\n' "$listed" | sort | uniq -d)
	[[ -z "$duplicates" ]] ||
		err "$MANIFEST: skill listed in more than one group: $(echo "$duplicates" | tr '\n' ' ')"

	while IFS= read -r name; do
		[[ -n "$name" ]] || continue
		skill_exists "$name" || err "$MANIFEST lists '$name' but skills/$name/ does not exist"
	done <<<"$listed"

	for name in "${SKILL_DIRS[@]}"; do
		printf '%s\n' "$listed" | grep -qx "$name" ||
			err "skills/$name/ exists but is not listed in $MANIFEST"
	done
	echo "  $(printf '%s\n' "$listed" | grep -c .) skills across $(jq -r 'length' "$MANIFEST") groups"
else
	err "$MANIFEST is missing"
fi

# --- 5. Evals ----------------------------------------------------------------

section "Eval definitions"
EVALS=evals/evals.json
if [[ -f "$EVALS" ]]; then
	if jq -e '.evals | type == "array" and length > 0' "$EVALS" >/dev/null; then
		jq -e '[.evals[].id] | length == (unique | length)' "$EVALS" >/dev/null ||
			err "$EVALS: eval ids are not unique"
		bad=$(jq -r '[.evals[] | select(
				(.id | type) != "number"
				or (.skill | type != "string" or length == 0)
				or (.prompt | type != "string" or length == 0)
				or (.assertions | type != "array" or length == 0)
				or (any(.assertions[]; (.text | type != "string" or length == 0)))
			) | (.id // "?" | tostring)] | join(", ")' "$EVALS")
		[[ -z "$bad" ]] ||
			err "$EVALS: entries missing id/skill/prompt/assertions[].text: $bad"

		while IFS= read -r name; do
			[[ -n "$name" ]] || continue
			skill_exists "$name" || err "$EVALS references unknown skill '$name'"
		done < <(jq -r '[.evals[].skill] | unique | .[]' "$EVALS")
		echo "  $(jq -r '.evals | length' "$EVALS") evals across $(jq -r '[.evals[].skill] | unique | length' "$EVALS") skills"
	else
		err "$EVALS: .evals must be a non-empty array"
	fi
else
	err "$EVALS is missing"
fi

for file in evals/triggers/*.json; do
	[[ -e "$file" ]] || break
	name=$(basename "$file" .json)
	skill_exists "$name" || err "$file has no matching skills/$name/"
	jq -e 'type == "array" and length > 0 and all(.[];
			(.query | type == "string" and length > 0) and (.should_trigger | type == "boolean"))' \
		"$file" >/dev/null ||
		err "$file: must be a non-empty array of {query, should_trigger}"
done

for file in evals/pipeline/*.json; do
	[[ -e "$file" ]] || break
	jq -e '(.id | type == "string" and length > 0)
			and (.description | type == "string" and length > 0)
			and (.setup.repo_strategy | . == "local-tmp-init" or . == "gh-disposable")
			and ((.cost_class // "low") | . == "low" or . == "high")
			and (.steps | type == "array" and length > 0)
			and all(.steps[];
				(.skill | type == "string" and length > 0)
				and (.prompt | type == "string" and length > 0)
				and (.verify | type == "array" and length > 0))
			and (.final_assertions | type == "array" and length > 0)' \
		"$file" >/dev/null ||
		err "$file: malformed scenario (needs id, description, setup.repo_strategy, steps[].{skill,prompt,verify}, final_assertions)"

	while IFS= read -r name; do
		[[ -n "$name" ]] || continue
		skill_exists "$name" || err "$file: step references unknown skill '$name'"
	done < <(jq -r '[.steps[].skill] | unique | .[]' "$file" 2>/dev/null)
done
echo "  checked $(find evals/triggers -name '*.json' | wc -l | tr -d ' ') trigger sets and $(find evals/pipeline -name '*.json' | wc -l | tr -d ' ') pipeline scenarios"

# --- Advisories --------------------------------------------------------------

section "Eval coverage (advisory)"
for name in "${SKILL_DIRS[@]}"; do
	has_eval=$(jq -r --arg s "$name" '[.evals[] | select(.skill == $s)] | length' "$EVALS" 2>/dev/null || echo 0)
	[[ "$has_eval" != "0" ]] || note "skills/$name/ has no entry in $EVALS"
	[[ -f "evals/triggers/$name.json" ]] || note "skills/$name/ has no evals/triggers/$name.json"
done
[[ "$NOTES" -gt 0 ]] || echo "  every skill has evals and a trigger set"

# --- Result ------------------------------------------------------------------

echo
if [[ "$ERRORS" -eq 0 ]]; then
	printf '\033[32mStructure checks passed\033[0m (%d advisories)\n' "$NOTES"
	exit 0
fi
printf '\033[31m%d structure check(s) failed\033[0m\n' "$ERRORS"
exit 1
