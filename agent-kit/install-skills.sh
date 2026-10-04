#!/usr/bin/env bash
# Install or refresh the agent skill kit for the Hermes agents on the host.
#
# Copies pinned upstream skills plus the in-repo django-ninja skill into
# <root>/<agent>/skills/<skill>/. Re-running the script is the refresh.
# Only the managed skill folders below and KIT-SOURCE.txt are written;
# every other folder in <root> and in each skills dir is left alone.
#
# Usage: agent-kit/install-skills.sh [--root DIR] [--dry-run]
set -euo pipefail

# --- Pins -------------------------------------------------------------------
readonly ANGULAR_REPO="https://github.com/angular/skills.git"
readonly ANGULAR_SHA="961267cebb8f91e2caf666bb3e15090659aabd98"
readonly DJANGO_AI_REPO="https://github.com/vintasoftware/django-ai-plugins.git"
readonly DJANGO_AI_SHA="b8af2688d994747666e6a793d441365807d6772f"

# --- Install map ------------------------------------------------------------
readonly AGENTS=(finn frida kasper)
readonly BASE_SKILLS=(angular-developer angular-new-app django-ninja)
skills_for() {
  case "$1" in
    kasper) echo "${BASE_SKILLS[@]}" django-reviewer ;;
    *) echo "${BASE_SKILLS[@]}" ;;
  esac
}

ROOT="/srv/agents"
DRY_RUN=0

usage() {
  echo "Usage: $0 [--root DIR] [--dry-run]"
  echo "  --root DIR  agents root (default /srv/agents)"
  echo "  --dry-run   print every action, change nothing"
}

die() { echo "ERROR: $*" >&2; exit 1; }

# Print an action; run it unless --dry-run.
run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    echo "+ $*"
    "$@"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) [[ $# -ge 2 ]] || die "--root needs a directory"; ROOT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

[[ $(id -u) -ne 0 ]] || die "refusing to run as root; run as the owner of $ROOT (e.g. stig)"
command -v git >/dev/null || die "git is required"

ROOT="${ROOT%/}"
[[ -d $ROOT ]] || die "root $ROOT does not exist"

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NINJA_SRC="$KIT_DIR/django-ninja"
[[ -f $NINJA_SRC/SKILL.md ]] || die "missing $NINJA_SRC/SKILL.md; run from a full checkout"
KIT_SHA="$(git -C "$KIT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"

# Never create agent folders: every skills dir must already exist.
for agent in "${AGENTS[@]}"; do
  [[ -d $ROOT/$agent/skills && ! -L $ROOT/$agent/skills ]] \
    || die "$ROOT/$agent/skills does not exist (or is a symlink); this script never creates agent folders"
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# fetch_pin URL SHA DIR: shallow-fetch one commit and verify it is the pin.
fetch_pin() {
  local url="$1" sha="$2" dir="$3"
  echo "Fetching $url @ $sha"
  git init -q "$dir"
  git -C "$dir" remote add origin "$url"
  git -C "$dir" fetch -q --depth 1 origin "$sha"
  git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD
  local got
  got="$(git -C "$dir" rev-parse HEAD)"
  [[ $got == "$sha" ]] || die "$url: checked out $got, expected pin $sha"
}

fetch_pin "$ANGULAR_REPO" "$ANGULAR_SHA" "$WORK/angular"
fetch_pin "$DJANGO_AI_REPO" "$DJANGO_AI_SHA" "$WORK/django-ai"

source_for() {
  case "$1" in
    angular-developer) echo "$WORK/angular/angular-developer" ;;
    angular-new-app) echo "$WORK/angular/angular-new-app" ;;
    django-reviewer) echo "$WORK/django-ai/skills/django-reviewer" ;;
    django-ninja) echo "$NINJA_SRC" ;;
    *) die "no source for skill $1" ;;
  esac
}

for skill in angular-developer angular-new-app django-reviewer django-ninja; do
  [[ -f $(source_for "$skill")/SKILL.md ]] || die "source for $skill has no SKILL.md"
done

# install_skill SKILLS_DIR SKILL: copy to a hidden staging folder next to the
# target, then swap, so an aborted run never leaves a half-copied skill.
install_skill() {
  local dir="$1" skill="$2"
  local src dest="$dir/$skill" new="$dir/.kit-new-$skill" old="$dir/.kit-old-$skill"
  src="$(source_for "$skill")"

  # Recover from an earlier run that stopped mid-swap.
  if [[ -e $old && ! -e $dest ]]; then
    run mv "$old" "$dest"
  fi
  if [[ -e $new ]]; then run rm -rf "$new"; fi
  if [[ -e $old ]]; then run rm -rf "$old"; fi

  run cp -R "$src" "$new"
  run rm -rf "$new/.git"
  if [[ -e $dest || -L $dest ]]; then
    run mv "$dest" "$old"
  fi
  run mv "$new" "$dest"
  if [[ -e $old || -L $old ]]; then run rm -rf "$old"; fi
}

DATE_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

write_source_file() {
  local dir="$1" skills="$2"
  local file="$dir/KIT-SOURCE.txt"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] write $file"
    return
  fi
  echo "+ write $file"
  {
    echo "Installed by agent-kit/install-skills.sh (food-st44 @ $KIT_SHA)"
    echo "Date (UTC): $DATE_UTC"
    echo "Skills: $skills"
    echo "angular/skills: $ANGULAR_SHA (angular-developer, angular-new-app)"
    echo "vintasoftware/django-ai-plugins: $DJANGO_AI_SHA (skills/django-reviewer)"
    echo "food-st44: $KIT_SHA (agent-kit/django-ninja)"
  } > "$file.tmp"
  mv "$file.tmp" "$file"
}

for agent in "${AGENTS[@]}"; do
  dir="$ROOT/$agent/skills"
  read -r -a skills <<< "$(skills_for "$agent")"
  echo "== $agent ($dir)"
  for skill in "${skills[@]}"; do
    install_skill "$dir" "$skill"
  done
  write_source_file "$dir" "${skills[*]}"
done

echo
[[ $DRY_RUN -eq 0 ]] || echo "Dry run: nothing was changed. Current state:"
echo "Result:"
for agent in "${AGENTS[@]}"; do
  dir="$ROOT/$agent/skills"
  echo "$agent:"
  for path in "$dir"/*/; do
    [[ -d $path ]] || continue
    name="$(basename "$path")"
    if [[ -f $path/SKILL.md ]]; then
      echo "  $name: SKILL.md ok"
    else
      echo "  $name: NO SKILL.md"
    fi
  done
done
