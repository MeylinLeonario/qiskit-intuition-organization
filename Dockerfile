# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS web-build
WORKDIR /build
COPY web/package*.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM python:3.11-slim-bookworm AS runtime
COPY --from=web-build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY requirements.txt ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi; \
    pip install --no-cache-dir -r requirements.txt
COPY backend/ backend/
COPY agents/ agents/
COPY frontend/learning_content.py frontend/site_content.json frontend/
COPY scripts/serve.py scripts/serve.py
COPY --from=web-build /build/.next/standalone/ web/
COPY --from=web-build /build/.next/static/ web/.next/static/
ENV PORT=7860 HOSTNAME=0.0.0.0 NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 NEXT_TELEMETRY_DISABLED=1
EXPOSE 7860
RUN useradd --create-home --uid 1000 app && chmod -R a+rX /app
USER app
CMD ["python", "scripts/serve.py"]
