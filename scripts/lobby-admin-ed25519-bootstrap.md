# スーパー管理者 Ed25519 公開鍵 — 初回登録（SSH/CLI）

秘密鍵は**絶対に**サーバー・リポジトリ・ログに置かない。公開鍵のみ登録する。

## 1. 鍵ペア生成（オペレータ端末）

```bash
openssl genpkey -algorithm Ed25519 -out admin-ed25519-private.pem
chmod 600 admin-ed25519-private.pem
openssl pkey -in admin-ed25519-private.pem -pubout -outform DER | tail -c 32 | base64 -w0
```

出力した base64 1 行を `ADMIN_ED25519_PUBLIC_KEY` に設定する（Worker secret または wrangler）。

## 2. Worker 環境変数（bootstrap）

```bash
# 例: wrangler secret put ADMIN_ED25519_PUBLIC_KEY
```

## 3. D1 へ直接登録（任意・2 本目以降の救済）

```bash
node scripts/lobby-admin-ed25519-register.mjs --name "bootstrap-ssh" --public-b64 "$(cat pubkey.b64)"
```

`wrangler d1 execute` で `admin_ed25519_keys` に INSERT してもよい（`migrations/0005_admin_ed25519_keys.sql` 参照）。

## 4. 検証

管理画面 `admin` でパスワード → 秘密鍵 PEM で第2要素を完了できること。