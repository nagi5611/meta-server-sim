# セキュリティ運用ドキュメント（meta.mmh-virtual.jp）

本番サーバーへ **リポジトリを push するだけでは適用されません**。オーナーが SSH で本番に入り、各 runbook の手順を実行してください。

| ドキュメント | 内容 |
|--------------|------|
| [env-file-permissions.md](./env-file-permissions.md) | fleet 各コア `.env` を mode 0600・所有者 nagi に揃える |
| [fail2ban-production.md](./fail2ban-production.md) | fail2ban（sshd / 任意で nginx）導入 |
| [ssh-key-only-migration.md](./ssh-key-only-migration.md) | SSH 鍵認証への移行（パスワード廃止前のロックアウト防止） |

関連スクリプト: `scripts/install-fail2ban-meta-production.sh`、`scripts/security/*`。