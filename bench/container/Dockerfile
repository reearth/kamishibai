# kamishibai rendering a kit reel on the CPU, with no browser: Node, ffmpeg,
# the packed package and the kit's optional peers. Build from the repo root
# after bench/setup.sh has packed kamishibai (bench/run-container.ts builds it):
#   docker build -f bench/container/Dockerfile -t kamishibai-cpu .
# Cloudflare Containers and Sandboxes run linux/amd64 (--platform linux/amd64).
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY bench/.work/kamishibai.tgz /tmp/kamishibai.tgz
RUN npm init -y >/dev/null && npm pkg set type=module \
  && npm i --no-audit --no-fund /tmp/kamishibai.tgz @napi-rs/canvas@1.0.9 yoga-layout@3.2.1 yaml@2.8.1
# The kit example, with its fonts: a container has none of its own.
COPY examples/kit /app/reel
ENTRYPOINT ["npx", "kamishibai"]
