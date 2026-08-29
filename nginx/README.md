# nginx — metaverse-simulation

metaverse-simulation は **パスベースの tenant**（例: `https://sim.example.com/P-01/`）を採用しています。tenant を管理パネルから追加・削除しても、nginx の `location` を増やす必要はありません。

## 基本構成

1 ドメイン（例: `sim.mmh-virtual.jp`）に対し、Node プロセス（既定 `127.0.0.1:3002`）へ全体を `proxy_pass` します。

- プラットフォーム hub: `/`
- 管理パネル: `/admin`, `/admin.html`, `/admin/tenant/{tenantId}`
- tenant アプリ: `/{tenantId}/`, `/{tenantId}/api/*`
- Socket.io: `/{tenantId}/socket.io`

tenant ID は英数字始まりのパスセグメントとして透過されるため、**新規 tenant 追加時の nginx 変更は不要**です。

## 設定例

詳細な TLS・複数ドメインの例は系列プロジェクト [metaverse-simple/nginx/README.md](../../metaverse-simple/nginx/README.md) および `metaverse-proxy.conf.example` を参照してください。

sim 用 server ブロックの要点:

```nginx
server {
    listen 443 ssl http2;
    server_name sim.mmh-virtual.jp;

    client_max_body_size 500m;

    include /etc/nginx/snippets/metaverse-proxy-headers.conf;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

## 環境変数（Node 側）

nginx ではなく `.env` で設定する項目:

| 変数 | 説明 |
|------|------|
| `USE_REVERSE_PROXY=1` | リバースプロキシ利用 |
| `TRUST_PROXY=1` | `X-Forwarded-*` を信頼 |
| `PROXY_DOMAIN_PORT_MAP` | ドメイン→ポート（**プラットフォーム単位**。tenant 単位ではない） |
| `PROXY_SERVICE_DOMAIN` | このプロセスのドメイン |
| `SOCKET_CORS_ORIGINS` | 本番の Socket.io CORS |

tenant の追加・削除は **管理パネルまたは API** で行い、`PROXY_DOMAIN_PORT_MAP` の更新は不要です。

## Vite 開発時

ローカルでは Vite（3003）が tenant パスを Node（3002）へプロキシします。新 tenant も正規表現 `TENANT_SEGMENT` で自動転送されます。ブラウザは `http://localhost:3003` を開いてください。

## Socket.io 注意

長時間接続のため `proxy_read_timeout` / `proxy_send_timeout` を十分長く設定してください（上記例は 86400s）。

## tenant 削除（アーカイブ）

管理パネルから削除した tenant は `tenants/_archive/` へ移動されます。nginx 設定の変更は不要です。アーカイブ済み tenant の URL は 404 になります。
