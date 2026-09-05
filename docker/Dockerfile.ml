# Python YOLO card recognizer (ml/server/inference_server.py).
#
# Game Mode and the /api/recognize endpoint call this service. It is large
# (torch pulls in ~2GB), so compose keeps it behind the "ml" profile:
#
#   docker compose --profile ml up --build
#
# Without it, uploads and multiplayer work; card detection does not.

FROM python:3.11-slim

WORKDIR /app

# OpenCV needs these at runtime even in headless mode.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

COPY ml/requirements.txt ./requirements.txt
# CPU-only torch keeps the image to a size that still fits most hosts. Drop
# the extra index if you want the CUDA build.
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
    -r requirements.txt

# inference_server.py resolves the model as SCRIPT_DIR/../models, so the
# layout under /app/ml has to match the repo's.
COPY ml/server ./ml/server
COPY ml/models ./ml/models

WORKDIR /app/ml/server

EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD curl -fsS http://localhost:3002/health || exit 1

CMD ["python", "inference_server.py"]
