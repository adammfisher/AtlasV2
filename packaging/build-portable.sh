#!/bin/bash
# Axiom Local portable build (PRD Stage 5).
# Produces dist/AtlasLocal/ — a folder that runs on a clean macOS account with
# no Homebrew on PATH: vendored node, standalone python, vendored llama-server
# (+ dylibs), bundled server + MCP servers, built client served by Express.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"
DIST="$REPO/dist/AtlasLocal"

echo "==> clean dist"
rm -rf "$DIST"
mkdir -p "$DIST"/{runtimes/llama,server,servers,data/models}

echo "==> client build"
pnpm --filter @axiom/client build
mkdir -p "$DIST/client"
cp -R client/dist "$DIST/client/dist"

echo "==> server bundle (esbuild, better-sqlite3 external)"
pnpm exec esbuild server/src/index.ts \
  --bundle --platform=node --format=esm --target=node22 \
  --external:better-sqlite3 \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --outfile="$DIST/server/index.mjs" --log-level=warning
cp server/src/db/schema.sql "$DIST/server/schema.sql"

echo "==> MCP server bundles"
for s in filesystem memory sqlite; do
  pnpm exec esbuild "servers/$s.ts" \
    --bundle --platform=node --format=esm --target=node22 \
    --external:better-sqlite3 \
    --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
    --outfile="$DIST/servers/$s.mjs" --log-level=warning
done

echo "==> native module: better-sqlite3 (+ transitive deps via pnpm's real paths)"
mkdir -p "$DIST/node_modules"
BSQ_DIR="$(node -e "console.log(require('path').dirname(require.resolve('better-sqlite3/package.json')))")"
cp -RL "$BSQ_DIR" "$DIST/node_modules/better-sqlite3"
for dep in bindings file-uri-to-path prebuild-install; do
  DEP_DIR="$(node -e "
    const { createRequire } = require('module');
    const r = createRequire('$BSQ_DIR/index.js');
    try { console.log(require('path').dirname(r.resolve('$dep/package.json'))); } catch {}
  ")"
  [ -n "$DEP_DIR" ] && cp -RL "$DEP_DIR" "$DIST/node_modules/$dep" || true
done

echo "==> vendored node ($(node --version))"
mkdir -p "$DIST/runtimes/node/bin"
cp "$(command -v node)" "$DIST/runtimes/node/bin/node"

echo "==> vendored llama-server + dylibs"
LLAMA_BIN="$(command -v llama-server)"
cp "$LLAMA_BIN" "$DIST/runtimes/llama/llama-server"
# pull every non-system dylib it links (homebrew + @rpath), recursively
collect_dylibs() {
  otool -L "$1" | awk 'NR>1 {print $1}' | grep -vE '^/(usr/lib|System)' || true
}
# macOS ships bash 3.2 — no associative arrays; track seen basenames in a string
queue="$LLAMA_BIN"
seen=""
while [ -n "$queue" ]; do
  bin="${queue%%$'\n'*}"
  rest="${queue#*$'\n'}"
  [ "$rest" = "$queue" ] && queue="" || queue="$rest"
  for dep in $(collect_dylibs "$bin"); do
    real="$dep"
    case "$dep" in
      @rpath/*) real="$(dirname "$(readlink -f "$LLAMA_BIN")")/../lib/${dep#@rpath/}"
                [ -f "$real" ] || real="/opt/homebrew/lib/${dep#@rpath/}" ;;
    esac
    # copy under the REFERENCED basename (the binary links the symlink name)
    base="$(basename "$dep")"
    real="$(readlink -f "$real" 2>/dev/null || echo "$real")"
    case "$seen" in *"|$base|"*) continue ;; esac
    if [ -f "$real" ]; then
      seen="$seen|$base|"
      cp "$real" "$DIST/runtimes/llama/$base"
      queue="$queue$(printf '\n%s' "$real")"
      queue="${queue#$'\n'}"
    fi
  done
done
# ggml dlopens compute backends from a baked-in Cellar path — vendor them too
GGML_LIBEXEC="$(dirname "$(readlink -f /opt/homebrew/lib/libggml.0.dylib)")/../libexec"
if [ -d "$GGML_LIBEXEC" ]; then
  cp "$GGML_LIBEXEC"/*.so "$DIST/runtimes/llama/" 2>/dev/null || true
fi

# point the vendored binary and dylibs at the local folder
for f in "$DIST/runtimes/llama/"*; do
  chmod u+w "$f"
  for dep in $(collect_dylibs "$f"); do
    install_name_tool -change "$dep" "@executable_path/$(basename "$dep")" "$f" 2>/dev/null || true
  done
  codesign --force --sign - "$f" 2>/dev/null || true
done

echo "==> standalone python + office wheels (uv)"
command -v uv >/dev/null || brew install uv
UV_PYTHON_INSTALL_DIR="$DIST/runtimes/python-standalone" uv python install 3.13
PYBIN="$(find "$DIST/runtimes/python-standalone" -name python3.13 -path '*/bin/*' | head -1)"
"$PYBIN" -m venv --copies "$DIST/runtimes/python/venv"
"$DIST/runtimes/python/venv/bin/pip" install --quiet \
  python-pptx==1.0.2 python-docx==1.2.0 openpyxl==3.1.5 docxtpl==0.20.2 \
  weasyprint==69.0 pdfplumber==0.11.9 "markitdown[all]==0.1.6" openxml-audit==0.7.5
# venv --copies still writes absolute shebangs — rewrite to relative discovery
for f in "$DIST/runtimes/python/venv/bin/"*; do
  [ -f "$f" ] && head -1 "$f" | grep -q '^#!' && \
    sed -i '' "1s|^#!.*python.*|#!/usr/bin/env python3|" "$f" 2>/dev/null || true
done

echo "==> runtime assets"
cp -R skills "$DIST/skills"
cp -R directory "$DIST/directory"
mkdir -p "$DIST/scripts"
cp -R scripts/office "$DIST/scripts/office"

echo "==> portable config + launcher"
cat > "$DIST/axiom.config.json" <<'JSON'
{
  "userName": "Axiom user",
  "dataDir": "./data",
  "models": { "dir": "./data/models", "manifestUrl": null },
  "llamaServer": {
    "binary": "./runtimes/llama/llama-server",
    "chatPort": 8080,
    "embedPort": 8081,
    "ctx": 8192,
    "parallel": 2,
    "extraFlags": ["--jinja"]
  },
  "server": { "port": 5175 },
  "bedrock": { "enabled": false, "region": "us-east-1", "profile": "default" }
}
JSON

cat > "$DIST/start.command" <<'CMD'
#!/bin/bash
# Axiom Local — double-click to start. Everything runs from this folder.
set -e
cd "$(dirname "$0")"
export PATH="$PWD/runtimes/python/venv/bin:$PWD/runtimes/node/bin:/usr/bin:/bin"
if ! ls data/models/*e4b*.gguf >/dev/null 2>&1; then
  echo "Place the Gemma E4B GGUF (gemma-4-e4b-it-q4_k_m.gguf) in data/models/ first."
  open data/models
  read -p "Press Enter once the model file is in place…"
fi
echo "Starting Axiom Local on http://127.0.0.1:5175 …"
( sleep 4 && open "http://127.0.0.1:5175" ) &
exec ./runtimes/node/bin/node server/index.mjs
CMD
chmod +x "$DIST/start.command"

echo "==> done: $DIST"
du -sh "$DIST"
