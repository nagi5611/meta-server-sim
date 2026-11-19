# SSH 鍵認証のみへの移行（ロックアウト防止付き）

## 現状

| 接続元 | 方式 | 備考 |
|--------|------|------|
| Cursor Cloud Agent | **パスワード** | `META_MMH_VIRTUAL_SSH_PASSWORD` + `ssh-meta-production.sh`（sshpass） |
| オーナー（Windows 等） | おそらくパスワード or 既存鍵 | 実機の `~/.ssh` を確認 |
| GitHub Actions | **本番 SSH なし** | lobby は Cloudflare API のみ |

パスワードを突然 `no` にすると、上記のいずれかが **永久に入れなくなる**可能性があります。以下の順序を守ってください。

## 原則（必ず守る）

1. **コンソール／自宅 LAN など SSH 以外の復旧経路**を先に確保する。
2. **鍵を全部載せてから** `PasswordAuthentication no` にする（逆順禁止）。
3. 設定変更は **`sshd -t` → `systemctl reload ssh`**。reload 前に **既存 SSH セッションを維持**。
4. **新しいターミナル**で鍵ログインを成功させてから、古いセッションを閉じる。
5. 鍵・パスワードを **リポジトリ・issue・チャットに書かない**。公開鍵のみサーバーへ。

## フェーズ A — 鍵の準備（本番を触らない）

### A1. オーナー PC（Windows）

PowerShell または Git Bash:

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\meta_mmh_virtual_ed25519" -C "owner-meta-production"
```

公開鍵: `meta_mmh_virtual_ed25519.pub` の内容を控える。

### A2. Cloud Agent 用（cursor ユーザー）

Cloud Agent VM 上で **一度だけ** 鍵を生成し、**private key は Cursor Environment Secret にのみ保存**する（git 禁止）:

```bash
ssh-keygen -t ed25519 -f "$HOME/.ssh/meta_cursor_agent_ed25519" -N "" -C "cursor-agent-meta-production"
```

Dashboard → Environment → Secrets に例:

| Secret 名（例） | 内容 |
|-----------------|------|
| `META_MMH_VIRTUAL_SSH_PRIVATE_KEY` | `meta_cursor_agent_ed25519` の **秘密鍵全文**（OpenSSH 形式） |

公開鍵ファイル `meta_cursor_agent_ed25519.pub` だけ本番へ載せる。

Skill `meta-mmssh` は現状パスワード専用。鍵移行完了後、オーナーが Skill を更新するか、エージェントに「鍵 Secret + `ssh -i`」手順を別 Skill で足す（本 issue の範囲外だが移行完了の目安）。

### A3. その他の管理者（nagi 等）

運用で使うユーザーごとに **別鍵**（共有禁止）。

## フェーズ B — 本番で authorized_keys を追加（パスワードはまだ有効）

本番に **すでに入れるセッション**を開いたまま:

```bash
# cursor（エージェント用公開鍵）
sudo install -d -m 700 -o cursor -g cursor /home/cursor/.ssh
sudo touch /home/cursor/.ssh/authorized_keys
sudo chown cursor:cursor /home/cursor/.ssh/authorized_keys
sudo chmod 600 /home/cursor/.ssh/authorized_keys
# 公開鍵 1 行を追記（エディタまたは ssh-copy-id）
sudo -u cursor nano /home/cursor/.ssh/authorized_keys

# オーナー用ユーザー（例: nagi）も同様
```

## フェーズ C — 並行稼働で鍵ログインを検証

**サーバー側はまだ `PasswordAuthentication yes` のまま。**

### C1. Windows から

```powershell
ssh -i "$env:USERPROFILE\.ssh\meta_mmh_virtual_ed25519" nagi@meta.mmh-virtual.jp "whoami"
ssh -i "$env:USERPROFILE\.ssh\meta_mmh_virtual_ed25519" cursor@meta.mmh-virtual.jp "whoami"
```

### C2. Cloud Agent から（鍵 Secret 設定後）

パスワードスクリプトは使わず、Secret をファイルに一度だけ展開しない方式（例）:

```bash
# Secret を直接 echo しない。仮ファイルは削除する。
umask 077
keyfile="$(mktemp)"
printf '%s\n' "$META_MMH_VIRTUAL_SSH_PRIVATE_KEY" >"$keyfile"
chmod 600 "$keyfile"
ssh -i "$keyfile" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
  cursor@meta.mmh-virtual.jp "whoami && hostname"
rm -f "$keyfile"
```

失敗する場合は **パスワード経路でまだ入れる**ので、authorized_keys・権限（700/600）・ユーザー名を直す。**フェーズ D に進まない。**

### C3. fail2ban との同時運用

[fail2ban-production.md](./fail2ban-production.md) 導入済みなら、鍵検証の失敗連打で BAN されないよう、**1〜2 回ずつ**試す。BAN されたら `fail2ban-client set sshd unbanip`。

## フェーズ D — sshd を鍵のみに（最終段階）

**C がすべて成功した日のみ**実施。

1. バックアップ:

```bash
sudo cp -a /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%Y%m%d)
```

2. `sshd_config` または `sshd_config.d/*.conf` に追記（distribution の include 規約に合わせる）:

```text
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin no
```

`AllowUsers` / `AllowGroups` を既に使っている場合は **削除せず**、鍵登録済みユーザーだけが含まれることを確認する。

3. 検証と反映:

```bash
sudo sshd -t
sudo systemctl reload ssh
```

4. **新規ターミナル**でフェーズ C の鍵テストを再実行。
5. 成功したらパスワード経路は不要。Cursor の `META_MMH_VIRTUAL_SSH_PASSWORD` は Secret から削除してよい（鍵運用が安定してから）。

## フェーズ E — ロールバック（鍵のみで入れないとき）

**既存セッションがまだ生きている場合:**

```bash
sudo sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config.d/*.conf 2>/dev/null || true
# またはバックアップから復元
sudo cp -a /etc/ssh/sshd_config.bak.* /etc/ssh/sshd_config
sudo sshd -t && sudo systemctl reload ssh
```

セッションも切れている場合は **コンソール／LAN** のみ。

## 移行後のおすすめ

- fail2ban sshd の `maxretry` をやや厳しめ（例: 8）に戻すか検討。
- `MaxAuthTries 3` を sshd 側で設定（鍵のみなら影響小）。
- 定期的に `authorized_keys` を棚卸し。

## 関連

- Cloud Agent SSH: `.cursor/skills/meta-mmssh/SKILL.md`
- fail2ban: [fail2ban-production.md](./fail2ban-production.md)