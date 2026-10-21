#!/usr/bin/env bash
#
# Structural lint for the SDD plugin. Catches the failure modes that markdown
# and JSON can hit without anything else noticing: an unparseable JSON file, a
# skill whose frontmatter name disagrees with its directory, a skill missing
# from skills/_index.json (so it never reaches the docs site), a second plugin
# manifest drifting out of sync with .claude-plugin/plugin.json, or a skill
# whose only path to being invoked is a command layer that half our target
# harnesses do not have.
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
#
# The fallback must prune node_modules at *any* depth, not just the repo root:
# docs-site/node_modules alone carries thousands of package.json/plugin.json
# files, which would otherwise be parsed as repo sources and reported as
# duplicate plugin manifests.
list_files() {
  local pattern="$1"
  if git rev-parse --git-dir >/dev/null 2>&1; then
    git ls-files "$pattern"
  else
    find . \
      \( -name node_modules -o -name .git -o -name build -o -name .docusaurus \) -prune -o \
      -name "${pattern##*/}" -print \
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

# --- Eval definitions ------------------------------------------------------

# The evals themselves are LLM-graded in CI (skill-evals.yml). What is checkable
# here is their shape: duplicate ids, missing assertions, or a reference to a
# skill that has since been renamed or deleted would otherwise only surface as a
# silently-degraded grading run.
if [ -d evals ]; then
  eval_errors=$(
    python3 - "${skill_dirs[@]}" <<'PY'
import glob, json, os, sys

known = set(sys.argv[1:])
errors = []


def load(path):
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, ValueError) as exc:
        errors.append(f"{path}: unreadable ({exc})")
        return None


evals_path = "evals/evals.json"
if not os.path.exists(evals_path):
    errors.append(f"{evals_path}: missing")
else:
    doc = load(evals_path)
    entries = (doc or {}).get("evals")
    if not isinstance(entries, list) or not entries:
        errors.append(f"{evals_path}: .evals must be a non-empty array")
    else:
        seen = set()
        for entry in entries:
            ident = entry.get("id")
            label = ident if ident is not None else "<no id>"
            if ident is None:
                errors.append(f"{evals_path}: an eval has no id")
            elif ident in seen:
                errors.append(f"{evals_path}: duplicate eval id {ident}")
            else:
                seen.add(ident)

            skill = entry.get("skill")
            if not isinstance(skill, str) or not skill:
                errors.append(f"{evals_path}: eval {label} has no skill")
            elif skill not in known:
                errors.append(
                    f"{evals_path}: eval {label} references unknown skill '{skill}'"
                )

            if not isinstance(entry.get("prompt"), str) or not entry["prompt"]:
                errors.append(f"{evals_path}: eval {label} has no prompt")

            assertions = entry.get("assertions")
            if not isinstance(assertions, list) or not assertions:
                errors.append(f"{evals_path}: eval {label} has no assertions")
            elif any(not isinstance(a.get("text"), str) or not a["text"] for a in assertions):
                errors.append(f"{evals_path}: eval {label} has an assertion with no text")

for path in sorted(glob.glob("evals/triggers/*.json")):
    name = os.path.basename(path)[: -len(".json")]
    if name not in known:
        errors.append(f"{path}: no matching skills/{name}/")
    cases = load(path)
    if cases is None:
        continue
    if not isinstance(cases, list) or not cases:
        errors.append(f"{path}: must be a non-empty array of trigger cases")
        continue
    for case in cases:
        if not isinstance(case.get("query"), str) or not case["query"]:
            errors.append(f"{path}: a case has no query")
        if not isinstance(case.get("should_trigger"), bool):
            errors.append(f"{path}: a case has no boolean should_trigger")

for path in sorted(glob.glob("evals/pipeline/*.json")):
    scenario = load(path)
    if scenario is None:
        continue
    for field in ("id", "description"):
        if not isinstance(scenario.get(field), str) or not scenario[field]:
            errors.append(f"{path}: missing {field}")
    strategy = (scenario.get("setup") or {}).get("repo_strategy")
    if strategy not in ("local-tmp-init", "gh-disposable"):
        errors.append(f"{path}: setup.repo_strategy must be local-tmp-init or gh-disposable")
    steps = scenario.get("steps")
    if not isinstance(steps, list) or not steps:
        errors.append(f"{path}: steps must be a non-empty array")
    else:
        for step in steps:
            skill = step.get("skill")
            if not isinstance(skill, str) or not skill:
                errors.append(f"{path}: a step has no skill")
            elif skill not in known:
                errors.append(f"{path}: step references unknown skill '{skill}'")
            if not isinstance(step.get("prompt"), str) or not step["prompt"]:
                errors.append(f"{path}: a step has no prompt")
            if not isinstance(step.get("verify"), list) or not step["verify"]:
                errors.append(f"{path}: a step has no verify assertions")
    if not isinstance(scenario.get("final_assertions"), list) or not scenario["final_assertions"]:
        errors.append(f"{path}: final_assertions must be a non-empty array")

print("\n".join(errors), end="")
PY
  )

  if [ -n "$eval_errors" ]; then
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      fail "$line"
    done <<<"$eval_errors"
  else
    pass "eval definitions are well-formed"
  fi
fi

# --- Scaffolded template hygiene -------------------------------------------

# templates/docusaurus/ is copied verbatim into a user's repo by /sdd:docs, but
# nothing typechecks it here. React 19's @types removed the global JSX
# namespace, so a bare `JSX.Element` annotation compiles in this repo's history
# yet fails every scaffolded site with TS2503. Guard the pattern directly.
bad_jsx=$(grep -rln '[^.]JSX\.Element' templates/ docs-site/src 2>/dev/null || true)
if [ -n "$bad_jsx" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    fail "$f: bare \"JSX.Element\" — use \"React.JSX.Element\" (React 19 removed the global JSX namespace)"
  done <<<"$bad_jsx"
else
  pass "no bare JSX.Element annotations in templates or docs-site"
fi

# --- Harness portability ---------------------------------------------------

# The invocation layer is the one that breaks silently: a skill can satisfy
# every rule in its body and still do nothing on a harness with no command
# layer, because the "/sdd:x" the README told the user to type matched no
# command and $ARGUMENTS was never populated (#236). These three checks keep
# the portable-invocation contract in the files that carry it, rather than in
# a reference nobody opens when a skill "won't trigger".

# 1. Every skill states the invocation and argument rule under its title, so a
#    skill read on its own (which is how a skill is read) explains itself.
inv_bad=0
for skill_md in skills/*/SKILL.md; do
  if ! grep -q 'Invocation and Arguments' "$skill_md"; then
    fail "$skill_md: portability note does not cover invocation/\$ARGUMENTS (harness-compat § \"Invocation and Arguments\")"
    inv_bad=1
  fi
done
[ "$inv_bad" -eq 0 ] && pass "every skill states how it is invoked without a command layer"

# 2. A description that names a slash command trains the model to wait for a
#    command instead of recognizing the task, which is the only trigger a
#    description-matching harness has.
desc_bad=0
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  fail "${hit%%:*}: frontmatter description names a slash command (it is also the trigger phrase)"
  desc_bad=1
done < <(grep -n '^description:.*\[\?/sdd:' skills/*/SKILL.md 2>/dev/null || true)
[ "$desc_bad" -eq 0 ] && pass "no skill description depends on a slash command"

# 3. A normative rule that names a harness-specific tool is violated on every
#    other harness unless the line itself gives the fallback. Citing the
#    capability map at the top of the file is not enough: the rules are what a
#    model follows literally.
must_bad=0
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  fail "${hit:0:200}: normative rule names a harness-specific tool with no fallback clause"
  must_bad=1
done < <(grep -nE 'MUST[^|]*\b(AskUserQuestion|TeamCreate|TeamDelete|SendMessage|TaskCreate|TaskUpdate|TaskList|TaskGet|ToolSearch|EnterWorktree|WebFetch|WebSearch)\b' skills/*/SKILL.md \
  | grep -v 'Harness portability' \
  | grep -vE 'where the harness|where available|where it cannot|otherwise|harness-compat|Capability Map|Single-Agent|single-agent|non-interactive|batch mode' || true)
[ "$must_bad" -eq 0 ] && pass "no MUST outranks a harness it cannot satisfy"

# --- Constitutions ----------------------------------------------------------

# A constitution (ADR-0037) is read by unattended runs as a source of standing
# decisions, so the two ways it can rot are both silent: a rule whose number
# collides or whose Decision is missing is skipped without anyone noticing, and
# a rule that grew into a procedure hands whoever can edit the file a way to
# instruct every future run. Validate the format statically. The fixture is the
# example template itself, so `make lint` proves it stays copyable.
#
# CONSTITUTION_FILES overrides the tracked-file discovery so the checks can be
# exercised against a file that is not in the index (see scripts/README notes on
# the other checks); unset, tracked files only, so generated output never fails
# the build.

constitution_files=()
if [ -n "${CONSTITUTION_FILES:-}" ]; then
  read -r -a constitution_files <<<"$CONSTITUTION_FILES"
else
  while IFS= read -r constitution_file; do
    [ -n "$constitution_file" ] || continue
    constitution_files+=("$constitution_file")
  done < <(
    {
      list_files '*constitution.md'
      list_files '*constitution-example.md'
    } | grep -v '^references/constitution\.md$' | sort -u
  )
fi

if [ "${#constitution_files[@]}" -eq 0 ]; then
  printf 'skip  no constitution files tracked\n'
else
  constitution_errors=$(
    python3 - "${constitution_files[@]}" <<'PY'
import re
import sys

SKILLS = {"work", "respond", "review", "check", "status"}
GOVERNS = re.compile(r"^(ADR-\d{4}|SPEC-\d{4}(?:\s+Req\s+\d+)?)(?:\s*,\s*(ADR-\d{4}|SPEC-\d{4}(?:\s+Req\s+\d+)?))?$")
RULE_HEAD = re.compile(r"^### Rule (\d+)(?:\s*[—–-]\s*(.*))?$")
BAD_HEAD = re.compile(r"^###\s+Rule\b", re.IGNORECASE)

errors = []

for path in sys.argv[1:]:
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError as exc:
        errors.append(f"{path}: unreadable ({exc})")
        continue

    if any(line.lstrip().startswith("```") for line in lines):
        errors.append(
            f"{path}: contains a fenced code block; a constitution holds decisions, "
            "not procedures or commands (ADR-0037)"
        )

    if not any(line.strip() == "## Rules" for line in lines):
        errors.append(f"{path}: no '## Rules' section, so no skill can read it")
        continue

    numbers = {}
    current = None

    def close(rule):
        if rule is None:
            return
        if rule["retired"]:
            return
        if not rule["decision"]:
            errors.append(
                f"{path}: Rule {rule['num']} ({rule['title'] or 'untitled'}) has no "
                "- **Decision**: line, so it can never be applied"
            )

    for offset, line in enumerate(lines, start=1):
        head = RULE_HEAD.match(line)
        if head:
            close(current)
            num = int(head.group(1))
            if num < 1:
                errors.append(f"{path}: line {offset}: rule numbers start at 1, not {num}")
            if num in numbers:
                errors.append(
                    f"{path}: line {offset}: Rule {num} already defined at line {numbers[num]}; "
                    "numbers MUST be unique"
                )
            else:
                numbers[num] = offset
            current = {"num": num, "title": (head.group(2) or "").strip(),
                       "decision": "", "retired": False, "fields": []}
            continue
        if BAD_HEAD.match(line):
            errors.append(
                f"{path}: line {offset}: rule heading does not match "
                "'### Rule N — Title' with a positive integer N"
            )
            continue
        if current is None:
            continue
        if line.startswith("## ") and not line.startswith("### "):
            close(current)
            current = None
            continue
        field = re.match(r"^\s*-\s+\*\*(.+?)\*\*\s*:\s*(.*)$", line)
        if not field:
            continue
        name, value = field.group(1).strip(), field.group(2).strip()
        lowered = name.lower()
        current["fields"].append(lowered)
        if lowered == "decision":
            current["decision"] = value
        elif lowered == "status":
            current["retired"] = value.lower() == "retired"
            if value.lower() not in {"retired", "active"}:
                errors.append(
                    f"{path}: line {offset}: rule Status MUST be 'retired' or omitted, got '{value}'"
                )
        elif lowered == "governs":
            if not value or not GOVERNS.match(value):
                errors.append(
                    f"{path}: line {offset}: Governs must name an ADR-XXXX or "
                    f"SPEC-XXXX Req N (optionally both), got '{value}'"
                )
        elif lowered == "applies to":
            wanted = [part.strip().lower() for part in value.split(",") if part.strip()]
            if not wanted:
                errors.append(f"{path}: line {offset}: Applies to is empty; omit the field to mean all skills")
            unknown = [part for part in wanted if part not in SKILLS]
            if unknown:
                errors.append(
                    f"{path}: line {offset}: Applies to names unknown skill(s) "
                    f"{', '.join(unknown)} (known: {', '.join(sorted(SKILLS))})"
                )
    close(current)

for problem in errors:
    print(problem)
PY
  )
  if [ -n "$constitution_errors" ]; then
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      fail "$line"
    done <<<"$constitution_errors"
  else
    pass "constitution files parse and hold decisions only"
  fi
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
