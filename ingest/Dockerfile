FROM tiangolo/nginx-rtmp:latest

COPY nginx.conf /etc/nginx/nginx.conf

RUN mkdir -p /tmp/hls && chown -R 101:101 /tmp/hls /var/log/nginx /var/cache/nginx /run

USER 101

EXPOSE 1935 8080
