FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        ca-certificates curl osmium-tool python3 python3-pyosmium \
    && rm -rf /var/lib/apt/lists/*

COPY prepare-ankara.sh /usr/local/bin/prepare-ankara
COPY mask-restricted-areas.py /usr/local/bin/mask-restricted-areas
COPY extract-restricted-areas.py /usr/local/bin/extract-restricted-areas
RUN chmod +x /usr/local/bin/prepare-ankara \
    /usr/local/bin/mask-restricted-areas \
    /usr/local/bin/extract-restricted-areas

ENTRYPOINT ["/usr/local/bin/prepare-ankara"]
