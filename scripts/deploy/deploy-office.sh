#!/bin/bash
# Redeploy the atlasv2-office Python Lambda (the `extract` op + the build_*.py
# helpers). office.tf says the zip is uploaded "out-of-band" — this is that
# step, which previously lived only in someone's shell history.
#
# The ~37MB dependency set (python-pptx, python-docx, openpyxl, pdfplumber,
# built for arm64) is deliberately NOT rebuilt: this pulls the deployed zip,
# swaps in the current scripts/office/*.py, and pushes it back. Reconstructing
# those wheels just to ship a handler edit would risk breaking document
# GENERATION, which runs through the same function.
set -euo pipefail
cd "$(dirname "$0")/../.."

BUCKET=atlasv2-artifacts-683032473658
KEY=lambda/office.zip
FUNCTION=atlasv2-office
REGION=us-east-1

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "→ fetching deployed office.zip (keeps the known-good wheels)"
aws s3 cp "s3://$BUCKET/$KEY" "$WORK/office.zip" --region "$REGION" --only-show-errors

echo "→ swapping in scripts/office/*.py"
( cd scripts/office && zip -q "$WORK/office.zip" ./*.py )

# design-doctrine assets the builders read at runtime (validate_common loads
# schemas/<skill>.json beside the handler; build_pdf loads templates/paged.css)
echo "→ bundling skill schemas + pdf stylesheet"
STAGE="$WORK/stage"
mkdir -p "$STAGE/schemas" "$STAGE/templates"
for s in pptx docx xlsx pdf; do cp "skills/$s/schema.json" "$STAGE/schemas/$s.json"; done
cp skills/pdf/templates/paged.css "$STAGE/templates/paged.css"
( cd "$STAGE" && zip -q "$WORK/office.zip" schemas/*.json templates/paged.css )

echo "→ uploading"
aws s3 cp "$WORK/office.zip" "s3://$BUCKET/$KEY" --region "$REGION" --only-show-errors

echo "→ updating function code"
aws lambda update-function-code --function-name "$FUNCTION" \
  --s3-bucket "$BUCKET" --s3-key "$KEY" --region "$REGION" \
  --query LastUpdateStatus --output text
aws lambda wait function-updated --function-name "$FUNCTION" --region "$REGION"

# smoke: extraction must come back ok before we call this deployed
DECK=${1:-.playwright-mcp/Q3-Business-Review.pptx}
if [ -f "$DECK" ]; then
  echo "→ smoke test: extract $DECK"
  python3 -c "
import base64, json, sys
print(json.dumps({'op': 'extract', 'kind': 'pptx', 'file_b64': base64.b64encode(open('$DECK','rb').read()).decode()}))
" > "$WORK/payload.json"
  aws lambda invoke --function-name "$FUNCTION" --region "$REGION" \
    --payload "fileb://$WORK/payload.json" --cli-read-timeout 180 "$WORK/out.json" \
    --query 'FunctionError' --output text
  python3 -c "
import json, sys
d = json.load(open('$WORK/out.json'))
if not d.get('ok'):
    print('✗ extract failed:', d.get('error') or str(d)[:300]); sys.exit(1)
print(f\"✓ extract ok — {len(d.get('slides') or [])} slides, {len(d.get('text') or '')} chars\")
"
fi
echo "✓ office deployed"
