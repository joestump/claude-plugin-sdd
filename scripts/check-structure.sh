#!/usr/bin/env bash
#
# Structural lint for the SDD plugin. Catches the failure modes that markdown
# and JSON can hit without anything else noticing: an unparseable JSON file, a
# skill whose frontmatter name disagrees with its directory, a skill missing
# from skills/_index.json (so it never reaches the docs site), or a second
# plugin manifest drifting out of sync with .claude-plugin/plugin.json.
#
# Governing: ADR-0029 (skills/_index.json drives skill page generation)

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
  printf 'FAIL  %s\n' "$1" >&2
  failures=$((failures + 1))
}

pass() {
  printf 'ok    %s\n' "$1"
}

# Tracked files only, so generated output under docs-generated/ and
# docs-site/.docusaurus/ never enters the picture. Falls back to find for a
# tarball checkout with no .git.
list_files() {
  local pattern="$1"
  if git rev-parse --git-dir >/dev/null 2>&1; then
    git ls-files "$pattern"
  else
    find . -path ./node_modules -prune -o -name "${pattern##*/}" -print \
      | sed 's|^\./||'
  fi
}

# --- JSON syntax -----------------------------------------------------------

json_bad=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if ! python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$f" 2>/dev/null; then
    fail "$f: not valid JSON"
    json_bad=1
  fi
done < <(list_files '*.json')
[ "$json_bad" -eq 0 ] && pass "all tracked JSON files parse"

# --- Plugin manifest -------------------------------------------------------

manifest=.claude-plugin/plugin.json

if [ ! -f "$manifest" ]; then
  fail "$manifest: missing — Claude Code loads the plugin from here"
else
  for field in name version description; do
    if ! python3 -c "
import json,sys
m = json.load(open('$manifest'))
sys.exit(0 if m.get('$field') else 1)
"; then
      fail "$manifest: missing or empty \"$field\""
    fi
  done

  version=$(python3 -c "import json; print(json.load(open('$manifest')).get('version',''))")
  if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    fail "$manifest: version \"$version\" is not semver (X.Y.Z)"
  else
    pass "$manifest: valid manifest at v$version"
  fi
fi

# A second plugin.json anywhere else is a duplicate manifest waiting to drift —
# the release process bumps one copy and readers trust the other.
strays=$(list_files '*plugin.json' | grep -v '^\.claude-plugin/plugin\.json$' || true)
if [ -n "$strays" ]; then
  while IFS= read -r stray; do
    fail "$stray: duplicate plugin manifest — $manifest is the only one"
  done <<<"$strays"
else
  pass "no duplicate plugin manifests"
fi

# --- Skill frontmatter -----------------------------------------------------

skill_bad=0
skill_dirs=()
for dir in skills/*/; do
  name=$(basename "$dir")
  skill_dirs+=("$name")
  skill_md="${dir}SKILL.md"

  if [ ! -f "$skill_md" ]; then
    fail "$dir: no SKILL.md"
    skill_bad=1
    continue
  fi

  if [ "$(head -n 1 "$skill_md")" != "---" ]; then
    fail "$skill_md: no YAML frontmatter"
    skill_bad=1
    continue
  fi

  frontmatter=$(awk 'NR>1 { if ($0 == "---") exit; print }' "$skill_md")

  declared=$(printf '%s\n' "$frontmatter" | sed -n 's/^name: *//p' | head -n 1)
  if [ -z "$declared" ]; then
    fail "$skill_md: frontmatter has no \"name\""
    skill_bad=1
  elif [ "$declared" != "$name" ]; then
    fail "$skill_md: frontmatter name \"$declared\" != directory \"$name\""
    skill_bad=1
  fi

  if ! printf '%s\n' "$frontmatter" | grep -q '^description: *[^ ]'; then
    fail "$skill_md: frontmatter has no \"description\" (skills trigger on it)"
    skill_bad=1
  fi
done
[ "$skill_bad" -eq 0 ] && pass "${#skill_dirs[@]} skills have well-formed frontmatter"

# --- skills/_index.json <-> skills/ ---------------------------------------

index=skills/_index.json
if [ ! -f "$index" ]; then
  fail "$index: missing — the docs site generates skill pages from it"
else
  listed=$(python3 -c "
import json
groups = json.load(open('$index'))
for names in groups.values():
    for n in names:
        print(n)
" | sort)

  on_disk=$(printf '%s\n' "${skill_dirs[@]}" | sort)

  missing=$(comm -13 <(printf '%s\n' "$listed") <(printf '%s\n' "$on_disk"))
  orphaned=$(comm -23 <(printf '%s\n' "$listed") <(printf '%s\n' "$on_disk"))
  dupes=$(printf '%s\n' "$listed" | uniq -d)

  index_bad=0
  for s in $missing; do
    fail "$index: skill \"$s\" exists on disk but is in no group"
    index_bad=1
  done
  for s in $orphaned; do
    fail "$index: lists \"$s\", but skills/$s/ does not exist"
    index_bad=1
  done
  for s in $dupes; do
    fail "$index: \"$s\" appears in more than one group"
    index_bad=1
  done
  [ "$index_bad" -eq 0 ] && pass "$index matches skills/ on disk"
fi

# --- Shell ----------------------------------------------------------------

if command -v shellcheck >/dev/null 2>&1; then
  if shellcheck scripts/*.sh; then
    pass "shellcheck clean"
  else
    fail "shellcheck reported problems"
  fi
else
  printf 'skip  shellcheck not installed\n'
fi

# --------------------------------------------------------------------------

if [ "$failures" -gt 0 ]; then
  printf '\n%d structural check(s) failed\n' "$failures" >&2
  exit 1
fi

printf '\nall structural checks passed\n'
