# Resend パスワード再設定 — 本番手順

送信元: **`みんなでメタ <noreply@mmh-virtual.jp>`**（Resend でドメイン検証済み想定）

## 1. コード反映（sim）

```bash
sudo /usr/local/bin/metasim-production-git-sync.sh
```

`main` にマージ済みの `lobby-admin-impl` / Resend 変更が入っていること。

## 2. sim `.env`

```bash
sudo env \
  RESEND_FROM_EMAIL='みんなでメタ <noreply@mmh-virtual.jp>' \
  RESEND_API_KEY='(Resend ダッシュボードのキー)' \
  bash /home/nagi/sim-server/meta-server-sim/scripts/metasim-production-resend-env.sh
sudo systemctl restart metasim-server
```

## 3. テストユーザー nagi のメール

```bash
cd /home/nagi/sim-server/meta-server-sim
sudo -u nagi node scripts/lobby-set-user-email.mjs student nagi nagi@mmh-virtual.jp
```

（ユーザーが `teachers` 側なら `teacher` に変更）

## 4. Pages / Worker デプロイ

GitHub Actions **Deploy metaverse-lobby** またはローカル `scripts/lobby-provision-cloudflare.sh`。  
`public/admin/` と `reset-password.html` が本番に載ること。

Worker secrets: `LOBBY_ADMIN_PASSWORD`, `LOBBY_SIM_SERVICE_TOKEN`, `LOBBY_JWT_SECRET` 等（既存 lobby 手順）。

## 5. 送信テスト（管理画面）

1. `https://m.mmh-virtual.jp/admin/` に Worker 設定の管理者でログイン
2. **ユーザー** → `nagi` → ⋮ → **パスワード再設定を送る**
3. **nagi@mmh-virtual.jp** に届くこと、リンクから `reset-password.html` で変更できること

## 6. Resend 単体 smoke（サーバー上）

```bash
cd /home/nagi/sim-server/meta-server-sim
sudo -u nagi env RESEND_TO=nagi@mmh-virtual.jp node scripts/lobby-resend-smoke.mjs
```