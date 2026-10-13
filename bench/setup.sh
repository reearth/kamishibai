#!/usr/bin/env bash
# Build everything the runners need, under .work/ (gitignored):
#
#   .work/kamishibai.tgz             kamishibai packed from this repo, or $KAMISHIBAI_TARBALL
#   .work/templates/<tool>/skill     a ready-to-use project per tool, with its
#   .work/templates/<tool>/noskill   official agent skills, and without them
#   .work/home-seed                  a HOME with every tool's browser and caches warm
#   .work/home/<tool>                the HOME each tool renders with in run-speed / run-edit
#
# and installs the dependencies of speed/<tool>/<task>/ and edit/<tool>/.
# Versions are pinned here, in the projects' package.json and lockfiles, and
# in the render commands (speed.json, run-edit.ts).
#
#   ./setup.sh                                            # pack this repo's kamishibai
#   KAMISHIBAI_TARBALL=path/to/kamishibai-x.y.z.tgz ./setup.sh
#
# Needs Node.js 22.18+ (the runners are TypeScript run by node), pnpm (to pack
# this repo), ffmpeg, and network access. Installers run with a throwaway HOME,
# so nothing is written to yours except the npm download cache.
set -euo pipefail
cd "$(dirname "$0")"
BENCH="$PWD"
REPO="$(cd .. && pwd)"
WORK="$BENCH/.work"
REMOTION_VERSION=4.0.534
HYPERFRAMES_VERSION=0.8.143
SKILLS_CLI=skills@1.7.1

mkdir -p "$WORK"
TARBALL="$WORK/kamishibai.tgz"
if [ -n "${KAMISHIBAI_TARBALL:-}" ]; then
  cp "$KAMISHIBAI_TARBALL" "$TARBALL"
else
  (cd "$REPO" && pnpm build >/dev/null)
  packed="$(cd "$REPO" && npm pack --pack-destination "$WORK" 2>/dev/null | tail -1)"
  mv "$WORK/$packed" "$TARBALL"
fi

# Some installers (hyperframes skills update) write to $HOME/.claude/skills
# and $HOME/.agents/skills whatever the project: point HOME at a throwaway dir
# and keep only the npm cache shared.
export npm_config_cache="${npm_config_cache:-$HOME/.npm}"
FAKE_HOME="$(mktemp -d)"
export HOME="$FAKE_HOME"
trap 'rm -rf "$FAKE_HOME"' EXIT
export DO_NOT_TRACK=1 HYPERFRAMES_TELEMETRY=0 HYPERFRAMES_NO_TELEMETRY=1 DISABLE_TELEMETRY=1

clone() { cp -cR "$1" "$2" 2>/dev/null || cp -R "$1" "$2"; }

# ---- agent templates -------------------------------------------------
# Every agent trial starts from a clone of one of these, so no trial pays (in
# time or tokens) for installing its tool. Skills go into .claude/skills only.
OUT="$WORK/templates"
rm -rf "$OUT" && mkdir -p "$OUT"

d="$OUT/kamishibai/skill"
mkdir -p "$d" && cd "$d"
npm init -y >/dev/null
npm pkg set type=module
npm i --no-audit --no-fund "$TARBALL" react@19 react-dom@19 >/dev/null
# The published skill, from this checkout.
mkdir -p .claude/skills
cp -R "$REPO/skills/kamishibai" .claude/skills/

cd "$OUT" && mkdir -p remotion
npx -y "create-video@$REMOTION_VERSION" --yes --blank remotion/skill >/dev/null
cd remotion/skill
[ -d node_modules ] || npm i --no-audit --no-fund >/dev/null
# Remotion's documented agent setup: its skills repo, every skill.
npx -y "$SKILLS_CLI" add remotion-dev/skills -s '*' -a claude-code -y --copy >/dev/null
# Remotion keeps its browser in node_modules/.remotion, not $HOME.
npx remotion browser ensure >/dev/null

cd "$OUT" && mkdir -p hyperframes
npx -y "hyperframes@$HYPERFRAMES_VERSION" init hyperframes/skill --example blank --resolution landscape --non-interactive >/dev/null
cd hyperframes/skill
[ -d node_modules ] || npm i --no-audit --no-fund >/dev/null || true
# The core set the README recommends for agents. It installs into $HOME (the
# throwaway one), so copy the result into the project.
npx -y "hyperframes@$HYPERFRAMES_VERSION" skills update >/dev/null
mkdir -p .claude/skills
src="$HOME/.claude/skills"; [ -d "$src" ] || src="$HOME/.agents/skills"
cp -RL "$src"/. .claude/skills/

# The baseline with no video tool: an empty project. The agent installs
# whatever it decides to use.
mkdir -p "$OUT/bare/noskill" && (cd "$OUT/bare/noskill" && npm init -y >/dev/null && npm pkg set type=module)

for tool in kamishibai remotion hyperframes; do
  rm -rf "$OUT/$tool/noskill"
  clone "$OUT/$tool/skill" "$OUT/$tool/noskill"
  rm -rf "$OUT/$tool/noskill/.claude/skills" "$OUT/$tool/noskill/.agents" "$OUT/$tool/noskill/skills-lock.json"
  # No git: an agent shouldn't read history; each template is its own world.
  rm -rf "$OUT/$tool/skill/.git" "$OUT/$tool/noskill/.git"
done
# HyperFrames' init also writes CLAUDE.md / AGENTS.md that route to its
# skills; without the skills they'd point at nothing, so they go too.
rm -f "$OUT/hyperframes/noskill/CLAUDE.md" "$OUT/hyperframes/noskill/AGENTS.md"

# ---- home seed -------------------------------------------------------
# Each tool fetches a browser (and HyperFrames, fonts) into $HOME on its first
# render. Render once per tool here, in a scratch copy, so every trial and
# timed render starts warm and identical.
SEED="$WORK/home-seed"
rm -rf "$SEED" && mkdir -p "$SEED"
warm() { # tool, command...
  local tool="$1"; shift
  local w; w="$(mktemp -d)/$tool"
  clone "$OUT/$tool/noskill" "$w"
  # Twice at most: the first launch of a freshly downloaded browser
  # sometimes times out (HyperFrames' `chrome --version` check).
  (cd "$w" && HOME="$SEED" "$@") >/dev/null 2>&1 ||
    (cd "$w" && HOME="$SEED" "$@") >/dev/null 2>&1 || { echo "warm-up failed: $tool" >&2; exit 1; }
  rm -rf "$w"
}
cat > "$OUT/.warm-reel.tsx" <<'TSX'
import React from "react";
import { mount } from "kamishibai/react";
mount(<div style={{ background: "#123", width: 320, height: 180 }} />, { fps: 30, durationMs: 200, width: 320, height: 180 });
TSX
warm kamishibai sh -c "cp '$OUT/.warm-reel.tsx' reel.tsx && npx playwright install chromium-headless-shell && npx kamishibai render reel.tsx -o out.mp4"
warm hyperframes sh -c "perl -pi -e 's/data-duration=\"10\"/data-duration=\"0.3\"/g' index.html && npx -y hyperframes@$HYPERFRAMES_VERSION render -o out.mp4"
rm -f "$OUT/.warm-reel.tsx"

rm -rf "$WORK/home" && mkdir -p "$WORK/home"
for tool in kamishibai remotion hyperframes; do clone "$SEED" "$WORK/home/$tool"; done

# ---- reference implementations ----------------------------------------
# kamishibai's projects depend on .work/kamishibai.tgz, so their lockfiles are
# local. The music goes where each tool reads it.
install() { # tool, dir
  case "$1" in
    kamishibai) (cd "$2" && rm -rf package-lock.json node_modules/kamishibai && npm install --no-audit --no-fund >/dev/null) ;;
    remotion) (cd "$2" && npm ci --no-audit --no-fund >/dev/null && npx remotion browser ensure >/dev/null) ;;
    hyperframes) ;; # rendered with npx hyperframes@<version>; nothing to install
  esac
}
for tool in kamishibai remotion hyperframes; do
  for task in text three scenes; do install "$tool" "$BENCH/speed/$tool/$task"; done
  install "$tool" "$BENCH/edit/$tool"
done
for tool in kamishibai remotion hyperframes; do
  music=assets; [ "$tool" = remotion ] && music=public
  mkdir -p "$BENCH/speed/$tool/scenes/$music"
  cp "$BENCH/briefs/scenes/assets/bgm.mp3" "$BENCH/speed/$tool/scenes/$music/"
done

# ---- inventory -------------------------------------------------------
{
  echo "# Bench setup — $(date -u +%FT%TZ)"
  echo "kamishibai: $(tar -xOzf "$TARBALL" package/package.json | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).version))') ($(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo "?")${KAMISHIBAI_TARBALL:+, from $(basename "$KAMISHIBAI_TARBALL")})"
  echo "remotion: $REMOTION_VERSION · hyperframes: $HYPERFRAMES_VERSION · skills cli: $SKILLS_CLI"
  for tool in kamishibai remotion hyperframes; do
    echo "## $tool/skill — skills and their size"
    (cd "$OUT/$tool/skill" && find .claude/skills -name SKILL.md 2>/dev/null | sort | while read -r f; do
      printf '%6d bytes (dir %s)  %s\n' "$(wc -c <"$f")" "$(du -sk "$(dirname "$f")" | cut -f1)k" "$f"; done)
    echo "## $tool top level"
    ls -A "$OUT/$tool/skill" | tr '\n' ' '; echo
  done
  echo "## home-seed caches"
  (cd "$SEED" && find . -maxdepth 4 -type d | sort | head -40)
} > "$OUT/INVENTORY.md"
cat "$OUT/INVENTORY.md"
