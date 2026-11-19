# fail2ban 本番導入（meta.mmh-virtual.jp）

## 背景（issue #47）

- UFW で SSH **22/tcp が全世界許可**のまま。
- `systemctl status fail2ban` が **inactive** で、ブルートフォース自動遮断がない。

本ドキュメントと `scripts/install-fail2ban-meta-production.sh` は **リポジトリ上の成果物**です。本番への適用はオーナー作業です。

## 成果物

| パス | 役割 |
|------|------|
| `scripts/install-fail2ban-meta-production.sh` | apt 導入・設定配置・サービス起動 |
| `scripts/security/fail2ban-jail.d-metasim-production.conf` | sshd jail（UFW 連携） |
| `scripts/security/fail2ban-jail.d-metasim-nginx.conf` | nginx jail（nginx 検出時のみ） |
| `scripts/security/fail2ban-ignoreip.conf.example` | 信頼 IP リストの例 |

## 前提・ロックアウト防止

1. **別経路のコンソール**（自宅 LAN・KVM・ルータ管理画面など）を確保してから作業する。
2. 作業中は **既存の SSH セッションを最低 1 本開いたまま**新しいターミナルで検証する。
3. UFW は本手順では変更しない（既存の `22` 許可を維持）。fail2ban は **ban 時に UFW ルールを追加**する。
4. 自宅など **固定グローバル IP** がある場合は、先に `/etc/mmh-virtual/fail2ban-ignoreip.conf` に登録する（誤 BAN 防止）。

## Cloud Agent（パスワード SSH）との関係

現状、Cursor Cloud Agent は Skill **meta-mmssh** 経由で  
`.cursor/skills/meta-mmssh/scripts/ssh-meta-production.sh` を使い、  
**`META_MMH_VIRTUAL_SSH_PASSWORD`**（Environment Secret）で `cursor@meta.mmh-virtual.jp` に接続します。

- エージェントの送信元 IP は **固定ではありません**（ignoreip に載せられない）。
- 設定では sshd jail の **`maxretry=12` / `findtime=20m`** とし、Secret 誤設定時の連続失敗で BAN されにくくしています。
- Secret が正しくても、短時間に大量の失敗ログが出れば BAN され得ます。**誤 BAN 時**は本番で `fail2ban-client set sshd unbanip <IP>`（要 root）。

鍵認証のみへ移行した後は、[ssh-key-only-migration.md](./ssh-key-only-migration.md) に従い Skill を鍵に切り替え、sshd の `maxretry` を標準寄りに下げてもよい。

## GitHub Actions との関係

本リポジトリの Actions（例: `deploy-metaverse-lobby.yml`）は **Cloudflare Workers へ `wrangler deploy`** であり、**本番ホストへ SSH しません**。fail2ban 導入で Actions が壊れる経路はありません（将来 SSH デプロイを足す場合は、その鍵を先に `authorized_keys` に登録してから fail2ban を有効化すること）。

## オーナー手順（本番）

### 1. リポジトリを最新化

`nagi` ユーザーで本番にいる場合の例:

```bash
sudo -u nagi git -C /home/nagi/sim-server/meta-server-sim pull --ff-only origin main
```

### 2.（推奨）信頼 IP を登録

```bash
sudo install -m 0640 -o root -g root \
  /home/nagi/sim-server/meta-server-sim/scripts/security/fail2ban-ignoreip.conf.example \
  /etc/mmh-virtual/fail2ban-ignoreip.conf
sudo nano /etc/mmh-virtual/fail2ban-ignoreip.conf
```

自宅グローバル IPv4/IPv6 を 1 行ずつ書く（**git にコミットしない**）。

### 3. インストール（root）

```bash
cd /home/nagi/sim-server/meta-server-sim
sudo METASIM_INSTALL_DIR="$PWD" ./scripts/install-fail2ban-meta-production.sh
```

- nginx が入っていれば **nginx jail 用ファイル**も配置される。
- 強制: `sudo METASIM_FAIL2BAN_NGINX=0 ./scripts/install-fail2ban-meta-production.sh` で nginx jail をスキップ。

### 4. 動作確認

```bash
sudo systemctl status fail2ban --no-pager
sudo fail2ban-client status
sudo fail2ban-client status sshd
sudo ufw status numbered
```

### 5. 誤 BAN の解除

```bash
sudo fail2ban-client status sshd
sudo fail2ban-client set sshd unbanip <BANNED_IP>
```

### 6. 再実行（設定更新時）

`git pull` のあと、再度 `install-fail2ban-meta-production.sh` を root で実行すると  
`jail.d` と `metasim-production-ignoreip.local` が再生成される。

## ロールバック（fail2ban だけ止める）

```bash
sudo systemctl stop fail2ban
sudo systemctl disable fail2ban
```

UFW に残った fail2ban が追加した deny ルールは `ufw status numbered` で確認し、必要なら手動削除。

## 監査コマンド（issue クローズ前の確認用）

```bash
systemctl is-active fail2ban
fail2ban-client ping
```