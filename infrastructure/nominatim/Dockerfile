FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates curl osmium-tool \
    && rm -rf /var/lib/apt/lists/*

COPY prepare-ankara.sh /usr/local/bin/prepare-ankara
RUN chmod +x /usr/local/bin/prepare-ankara

ENTRYPOINT ["/usr/local/bin/prepare-ankara"]
