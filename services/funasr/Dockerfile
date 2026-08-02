FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FUNASR_DEVICE=cpu

RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 funasr

WORKDIR /srv/funasr

COPY requirements.lock ./requirements.lock
RUN python -m pip install --upgrade pip \
    && python -m pip install \
        --index-url https://download.pytorch.org/whl/cpu \
        torch==2.11.0 \
        torchaudio==2.11.0 \
    && python -m pip install --requirement requirements.lock

COPY app ./app
COPY model-manifest.json ./model-manifest.json

RUN mkdir -p /home/funasr/.cache \
    && chown -R funasr:funasr /srv/funasr /home/funasr/.cache

USER funasr

EXPOSE 8100

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100", "--workers", "1"]
