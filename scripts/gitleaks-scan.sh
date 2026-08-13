#!/usr/bin/env bash
#
# Secret scanning. Runs in two passes, because a leaked credential can be in
# either place and only one of them is recoverable:
#
#   1. git history — everything already committed. A hit here means the secret
#      is published and must be rotated, not just deleted.
#   2. working tree — uncommitted and untracked files, so a secret is caught
#      locally before it becomes case 1.
#
# CI runs this same target (see .github/workflows/ci.yml), so a scan that
# passes locally and fails in CI can only mean the two are looking at
# different commits.
#
# Always --redact: gitleaks prints matched values by default, and this output
# lands in CI logs and agent transcripts. The finding's file and rule are
# enough to act on; the value itself is not needed and must not be echoed.

set -euo pipefail

if ! command -v gitleaks >/dev/null 2>&1; then
	cat >&2 <<-'EOF'
		gitleaks is not installed.

		  macOS:  brew install gitleaks
		  Linux:  https://github.com/gitleaks/gitleaks/releases

		Refusing to report a clean scan without having run one.
	EOF
	exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

status=0

echo "==> scanning git history"
gitleaks git --redact --no-banner . || status=$?

echo "==> scanning working tree (uncommitted and untracked files)"
gitleaks dir --redact --no-banner . || status=$?

if [ "$status" -ne 0 ]; then
	cat >&2 <<-'EOF'

		Secret scan failed.

		If a finding is real: the credential is compromised the moment it is
		committed or pushed. Rotate it first, then remove it from the tree —
		deleting the line is not sufficient once it is in history.

		If it is a false positive, add a narrowly-scoped allowlist entry to
		.gitleaks.toml describing why it is safe. Do not disable the rule
		wholesale, and do not pass --no-verify to get around the check.
	EOF
fi

exit "$status"
