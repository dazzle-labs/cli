FROM rclone/rclone:1.69

RUN apk add --no-cache inotify-tools util-linux

COPY entrypoint.sh /scripts/entrypoint.sh
COPY restore.sh /scripts/restore.sh
RUN chmod +x /scripts/entrypoint.sh /scripts/restore.sh
