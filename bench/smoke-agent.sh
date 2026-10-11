#!/bin/sh
# Plumbing test for run-agents.ts --agent-cmd: render each tool's own starter
# composition inside the isolated trial env (no agent, no API). Proves the
# cloned HOME has warm caches and the checks / contact sheets work. Outputs
# won't match the brief, so the spec check is expected to FAIL.
set -e
echo "HOME=$HOME"
case "$KB_TOOL" in
  kamishibai)
    cat > reel.tsx <<'TSX'
import React from "react";
import { mount, useClock } from "kamishibai/react";
const R = () => { const { ms } = useClock(); return <div style={{ position: "absolute", inset: 0, background: `hsl(${ms / 20}, 50%, 30%)` }} />; };
mount(<R />, { fps: 30, durationMs: 1000, width: 1920, height: 1080 });
TSX
    npx kamishibai render reel.tsx -o out.mp4 ;;
  remotion) npx remotion render src/index.ts MyComp out.mp4 --frames=0-29 ;;
  hyperframes) perl -pi -e 's/data-duration="10"/data-duration="1"/g' index.html && npx -y hyperframes@0.8.143 render -o out.mp4 ;;
esac
ls -la out.mp4
