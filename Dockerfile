# Atlas serverless container (PRD §12.1): Express app unchanged behind
# Lambda Web Adapter (streaming Function URL → SSE works). Python office
# builders ride along; weasyprint gets pango; soffice checks amber-skip.
FROM public.ecr.aws/docker/library/node:20-slim

# Lambda Web Adapter — turns the Lambda runtime API into plain HTTP to :8080
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip zip \
    libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 libffi8 shared-mime-info \
    fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /var/task
ENV PORT=8080 AWS_LWA_INVOKE_MODE=response_stream NODE_ENV=production

# python office toolchain (pinned like scripts/dev/bootstrap-python.sh)
RUN python3 -m venv runtimes/python/venv && \
    runtimes/python/venv/bin/pip install --no-cache-dir \
    python-pptx python-docx openpyxl weasyprint markitdown[all] pdfplumber

# server source runs under tsx (matches dev exactly — no build-step drift)
COPY package.json pnpm-workspace.yaml atlas.config.json ./
COPY server/package.json server/package.json
RUN corepack enable && cd server && pnpm install --prod=false --ignore-workspace
COPY server server
COPY skills skills
COPY scripts/office scripts/office
COPY directory directory
COPY servers servers

EXPOSE 8080
CMD ["server/node_modules/.bin/tsx", "server/src/index.ts"]
