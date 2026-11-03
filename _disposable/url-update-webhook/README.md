# URL 更新 → Webhook 通知（使い捨て）

指定 URL を定期的に GET し、内容（または ETag / Last-Modified）が変わったら Webhook に「更新されました」を送ります。メタバース本体とは無関係。**フォルダごと削除して問題ありません。**

## 使い方

```bash
cd _disposable/url-update-webhook
export WATCH_URL='https://example.com/'
export WEBHOOK_URL='https://discord.com/api/webhooks/...'
export INTERVAL_MS=60000
node watch.mjs
```

`.env` を使う場合は手元で `export $(grep -v '^#' .env | xargs)` などしてください（このフォルダは dotenv 依存を増やしていません）。

## 検知の仕組み

1. レスポンスに `ETag` または `Last-Modified` があればそれで比較
2. なければ本文 SHA-256 で比較

初回はベースラインのみ（`NOTIFY_ON_START=1` で初回も通知）。

## Webhook ペイロード（JSON）

Discord は `content`、Slack は `text` を参照します。

```json
{
  "content": "更新されました\nhttps://example.com/\n(2026-11-04T...)",
  "text": "...",
  "message": "更新されました",
  "url": "https://example.com/",
  "updatedAt": "...",
  "fingerprint": "..."
}
```

## 削除

`_disposable/url-update-webhook` ディレクトリを削除するだけです。
