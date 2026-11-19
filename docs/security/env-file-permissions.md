# .env ファイル権限（0600）

## 背景

本番の `meta-server-sim` `.env` が mode `664` だった事例があり、同一 OS グループの他ユーザーが秘密を読める状態になります。アプリは起動時に group/other 読取可なら **警告ログのみ** 出します（サービスは止めません）。

## 目標

- 各 `.env` の mode を **0600**（所有者のみ読み書き）
- 所有者を **サービス実行ユーザー `nagi`** に合わせる（`data/platform/fleet-registry.json` の各コア）

## 起動時のサーバチェック

`server.js` は `lib/env-file-permissions.js` を読み、リポジトリ直下の `.env` を検査します。

| 条件 | ログ |
|------|------|
| mode で group/other に読み取り等が付いている | `[security] ... allows group/other access` |
| `NODE_ENV=production` かつ所有者が `nagi` でない | `[security] ... owner is ... expected nagi` |

本番以外では所有者チェックは省略されます（上書きする場合は `ENV_FILE_EXPECTED_OWNER` を設定）。

## 本番での点検・修正手順

**SSH で本番に入り、サービスを止めずに権限だけ直す場合の例です。** 値の中身は表示しないでください。

1. MetaSim 作業ツリーのスクリプトを最新にする（通常は main への push 後の自動デプロイ、または `git pull`）。
2. **点検のみ（変更なし）:**

   ```bash
   cd /home/nagi/sim-server/meta-server-sim
   bash scripts/secure-fleet-env-permissions.sh
   ```

3. 問題が報告されたら **適用**（`nagi` で実行するか、`sudo -u nagi` を使用）:

   ```bash
   bash scripts/secure-fleet-env-permissions.sh --apply
   ```

4. 所有者が `nagi` でないファイルは、先に `chown` が必要です（root 作業）:

   ```bash
   # 例: metasim の .env のみ
   sudo chown nagi:nagi /home/nagi/sim-server/meta-server-sim/.env
   sudo -u nagi bash /home/nagi/sim-server/meta-server-sim/scripts/secure-fleet-env-permissions.sh --apply
   ```

5. **再起動は必須ではありません**（権限変更のみ）。次回 `systemctl restart metasim-server` 時に起動ログで警告が消えているか確認してください。

## fleet 全体（系列メタバースコア）

`data/platform/fleet-registry.json` に列挙されている各 `envFile` が対象です（meta / metair / metasim / staging / metapre / metadogo）。

カスタム registry を使う場合:

```bash
PLATFORM_FLEET_REGISTRY_PATH=/path/to/fleet-registry.json \
  bash scripts/secure-fleet-env-permissions.sh
```

## 手動で 1 ファイルだけ直す場合

```bash
stat -c '%a %U %n' /home/nagi/sim-server/meta-server-sim/.env
chmod 600 /home/nagi/sim-server/meta-server-sim/.env
# 所有者が nagi でない場合（root）:
# chown nagi:nagi /home/nagi/sim-server/meta-server-sim/.env
```

## 関連

- 管理画面 Basic 認証ファイルは `lib/admin-auth.js` が別途 0600 に寄せます（`.env` とは別経路）。
- Issue: GitHub #45（`.env` 664）