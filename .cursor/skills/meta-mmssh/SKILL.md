---
name: meta-mmssh
description: >-
  SSH to the home production metaverse host meta.mmh-virtual.jp as user cursor.
  Password comes from Cursor Environment Secrets (META_MMH_VIRTUAL_SSH_PASSWORD).
  Load when the user asks to SSH into production, deploy or ops on meta.mmh-virtual.jp,
  restart metaverse on the home server, or read server logs remotely.
---

# meta.mmh-virtual.jp SSH（cursor ユーザー）

Cloud Agent から自宅本番 **meta.mmh-virtual.jp** に **cursor** ユーザーで SSH する手順。

## Cursor Environment Secrets（ユーザー登録）

| 種別 | 変数名 | 値 |
|------|--------|-----|
| **Secret（必須）** | `META_MMH_VIRTUAL_SSH_PASSWORD` | cursor ユーザーの SSH パスワード |

ホストとユーザー名は固定（Secrets 不要）:

| 項目 | 値 |
|------|-----|
| ホスト | `meta.mmh-virtual.jp` |
| ユーザー | `cursor` |

Dashboard: Cloud Agent の Environment → **Secrets** に `META_MMH_VIRTUAL_SSH_PASSWORD` を追加する。パスワードをリポジトリ・チャット・コミットに書かない。

## エージェントの実行手順

1. この Skill を読んだうえで、接続前に Secret が VM に載っているか確認する（値は表示しない）:

   ```bash
   test -n "${META_MMH_VIRTUAL_SSH_PASSWORD:-}" && echo "META_MMH_VIRTUAL_SSH_PASSWORD: set" || echo "META_MMH_VIRTUAL_SSH_PASSWORD: missing"
   ```

2. `sshpass` が無ければインストールする（Ubuntu Cloud Agent 想定）:

   ```bash
   command -v sshpass >/dev/null || sudo apt-get update && sudo apt-get install -y sshpass openssh-client
   ```

3. リモートコマンドは **必ず** リポジトリ付属スクリプト経由で実行する（パスワードを argv に載せない）:

   ```bash
   .cursor/skills/meta-mmssh/scripts/ssh-meta-production.sh -- 'whoami && hostname'
   ```

   対話的シェル（非推奨・Cloud Agent では使いにくい）:

   ```bash
   .cursor/skills/meta-mmssh/scripts/ssh-meta-production.sh
   ```

4. 初回接続は `StrictHostKeyChecking=accept-new` でホスト鍵を記録する。既知ホストと不一致の場合は接続を止め、ユーザーに確認する（`StrictHostKeyChecking=no` は使わない）。

## Xserver DNS 自動更新（変動グローバル IP）

自宅回線の IPv4 変更時に **mmh-virtual.jp** の A レコードを Xserver ドメイン API で更新する。

| 種別 | 変数名 / パス | 説明 |
|------|----------------|------|
| **Secret（本番サーバー）** | `/etc/mmh-virtual/xserver-ddns.env` 内 **`XSERVER_API_TOKEN`** | Bearer トokens（git 禁止、chmod 600） |
| **Secret（Agent 用・任意）** | `XSERVER_API_TOKEN` | リモートから手動実行するとき |
| スクリプト | `scripts/mmh-virtual-xserver-ddns.sh` | 5 分 cron 用 |
| インストール | `sudo bash scripts/install-mmh-virtual-xserver-ddns.sh` | `/usr/local/bin` + `/etc/cron.d/` |

既定で更新するホスト: `meta`, `metair`, `sim`, `metapre`, `metadogo`, `metaprehub`（`MMH_DDNS_HOSTS` で変更）。

```bash
# 本番（token 設定後）
sudo /usr/local/bin/mmh-virtual-xserver-ddns.sh
sudo tail -20 /var/log/mmh-virtual-xserver-ddns.log
```

API 仕様: [Xserver ドメイン API – DNS](https://developer.xserver.ne.jp/api/domain/)

## スクリプト

| ファイル | 用途 |
|----------|------|
| `scripts/ssh-meta-production.sh` | パスワード認証 SSH（引数はリモートで実行するコマンド、省略時は対話シェル） |

## 禁止事項

- `META_MMH_VIRTUAL_SSH_PASSWORD` を `.env`、git、ログ、PR、チャットに出力しない
- `sshpass -p '...'` や `ssh ...` にパスワードを直書きしない
- 本番で `rm -rf`、ファイアウォール全開、root 昇格をユーザー明示なしに実行しない
- SSH 鍵を Skill や repo にコミットしない（将来鍵認証に移行する場合は Secrets に private key を別名で登録し Skill を更新する）

## 接続できないとき

1. Secret 未設定 → ユーザーに `META_MMH_VIRTUAL_SSH_PASSWORD` の登録を依頼
2. `Connection timed out` → 自宅側の SSH 公開（ポート転送 / Tailscale / Cloudflare Tunnel 等）と DNS が Cloud から届くかをユーザーが確認
3. `Permission denied` → パスワード・ユーザー名 `cursor`・サーバー側 `AllowUsers` 等
4. `sshpass` / `openssh-client` 不足 → 上記 apt 手順

## メタバース本番のよくあるリモート操作（例）

リポジトリパスや systemd ユニット名はサーバー実装に依存する。実行前にリモートで存在確認する:

```bash
.cursor/skills/meta-mmssh/scripts/ssh-meta-production.sh -- 'systemctl --user status metaverse 2>/dev/null || systemctl status metaverse 2>/dev/null || true'
```

ユーザーがパスを指定した場合のみ、その指示に従う。
