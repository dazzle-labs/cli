FROM tiangolo/nginx-rtmp:latest

RUN mkdir -p /tmp/hls /var/cache/nginx /usr/local/nginx/proxy_temp /usr/local/nginx/fastcgi_temp /usr/local/nginx/uwsgi_temp /usr/local/nginx/scgi_temp /usr/local/nginx/client_body_temp && \
    chown -R 101:101 /tmp/hls /var/log/nginx /var/cache/nginx /run /usr/local/nginx

USER 101

EXPOSE 1935 8080
