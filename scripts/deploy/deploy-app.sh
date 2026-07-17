#!/bin/bash
# Redeploy the Axiom app Lambda (esbuild bundle) + client to CloudFront.
# Scale-to-zero: zip Lambda + S3/CloudFront, no containers.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "→ bundling server"
npx esbuild server/src/index.ts --bundle --platform=node --format=esm --target=node20 \
  --outfile=dist-lambda/index.mjs \
  --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
  --external:better-sqlite3 >/dev/null
printf '#!/bin/bash\nexec node index.mjs\n' > dist-lambda/run.sh && chmod +x dist-lambda/run.sh
cp axiom.config.json models.config.json users.config.json dist-lambda/
rm -rf dist-lambda/skills dist-lambda/directory
cp -R skills directory dist-lambda/
( cd dist-lambda && zip -qr ../infra/lambda.zip . -x "*.DS_Store" )

echo "→ updating Lambda code"
aws lambda update-function-code --function-name atlasv2-app \
  --zip-file fileb://infra/lambda.zip --region us-east-1 --query LastUpdateStatus --output text
aws lambda wait function-updated --function-name atlasv2-app --region us-east-1

if [ "${1:-}" = "--client" ]; then
  echo "→ building + deploying client"
  pnpm --filter @axiom/client build >/dev/null
  aws s3 sync client/dist s3://atlasv2-client-683032473658 --delete --only-show-errors
  DIST=$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?Aliases.Items==null && contains(Origins.Items[].DomainName, 'atlasv2-client-683032473658.s3.us-east-1.amazonaws.com')].Id | [0]" \
    --output text)
  [ -n "$DIST" ] && [ "$DIST" != "None" ] && aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/*' --query 'Invalidation.Status' --output text
fi
echo "✓ deployed"
