#!/usr/bin/env bash
# 本番に mediasoup 公衆 IP 同期 cron をインストール（root + sudo）。DDNS は使わない。
exec "$(dirname "$0")/install-mediasoup-announced-ip-sync.sh" metasim
