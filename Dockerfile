FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npx vite build

FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py seed.py export_xlsx.py alembic.ini ./
COPY migrations ./migrations
COPY --from=web /web/dist ./static
ENV STATIC_DIR=/srv/static
EXPOSE 8000
CMD ["sh","-c","alembic upgrade head && uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
