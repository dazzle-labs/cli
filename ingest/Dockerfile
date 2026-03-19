FROM tiangolo/nginx-rtmp:latest

RUN mkdir -p /tmp/hls /var/cache/nginx && chown -R 101:101 /tmp/hls /var/log/nginx /var/cache/nginx /run

USER 101

EXPOSE 1935 8080
