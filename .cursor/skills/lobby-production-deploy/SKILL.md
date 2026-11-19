---
name: lobby-production-deploy
description: >-
  Deploy metaverse-lobby (Cloudflare Worker + Pages) to production via GitHub Actions
  or lobby-provision-cloudflare.sh. Load when the user asks to deploy the lobby, update
  m.mmh-virtual.jp, wrangler secrets, or align sim .env with Worker.
---

# ロビー本番デプロイ（metaverse-lobby）

**標準手順:** GitHub Actions の **`Deploy metaverse-lobby (Worker + Pages)`**（`.github/workflows/deploy-metaverse-lobby.yml`）を **`main`** で実行する（`workflow_dispatch` または `metaverse-lobby/**` 等への push）。

補足ドキュメント: `docs/metaverse-lobby.md`  
sim 反映: `scripts/lobby-production-apply.sh`、`scripts/metasim-production-git-sync.sh`

---

## 1. GitHub Actions（推奨）

1. リポジトリ → **Actions** → **Deploy metaverse-lobby (Worker + Pages)** → **Run workflow**（branch: `main`）
2. 成功時: Worker + Pages 更新、Artifact **`lobby-secrets.env`**（sim 追記用・3 日）
3. sim 本番: `sudo /usr/local/bin/metasim-production-git-sync.sh`（コード）と、必要なら `.env` と Artifact の整合

**deploy ジョブが実際に走る条件**

- `CLOUDFLARE_API_TOKEN` が **Repository secret** にあること（無いと deploy は notice で **スキップ**、exit 0）
- `LOBBY_PRESENCE_SECRET` と `LOBBY_WORKER_SYNC_SECRET` が空でないこと（無いと **fail**）

---

## 2. GitHub 側の設定

### Repository secrets（運用で揃える 6 件）

| Secret | 用途（概要） | ワークフロー `env` | provision（GHA 経由時） |
|--------|----------------|-------------------|-------------------------|
| `CLOUDFLARE_API_TOKEN` | Wrangler / CF API | ✅ 必須（無いとスキップ） | 全体 |
| `CLOUDFLARE_ACCOUNT_ID` | アカウント ID | ✅ 渡す | `resolve_account_id`・デプロイ |
| `LOBBY_PRESENCE_SECRET` | presence Bearer | ✅ 必須ゲート | `wrangler secret put` |
| `LOBBY_WORKER_SYNC_SECRET` | カタログ sync Bearer | ✅ 必須ゲート | `wrangler secret put` |
| `LOBBY_ADMIN_PASSWORD` | 管理画面 Worker ログイン | ⚠️ **現行 YAML 未接続** | 環境変数が来たときのみ `wrangler secret put` |
| `LOBBY_SIM_SERVICE_TOKEN` | Worker → sim `/service/*` | ⚠️ **現行 YAML 未接続** | 環境変数が来たときのみ `wrangler secret put` |

**値は sim 本番** `/home/nagi/sim-server/meta-server-sim/.env` **と一致させる**（特に `LOBBY_PRESENCE_SECRET` / `LOBBY_WORKER_SYNC_SECRET` / `LOBBY_SIM_SERVICE_TOKEN` はローテ時に両側同時更新）。

`LOBBY_ADMIN_PASSWORD` は Worker のみ（sim `.env` には通常不要）。

### 任意 Secret

| Secret | いつ要るか |
|--------|------------|
| `LOBBY_WORKERS_DEV_SUBDOMAIN` | workers.dev サブドメインが **未登録**の初回のみ（workflow は `env` に渡す。登録済みなら省略可） |
| `GEMINI_TRANSLATION_API_KEY` | 管理画面お知らせの Gemini 自動翻訳（未設定時は原文のみ保存） |
| `LOBBY_JEV_API_KEY` | ロビー参加時表示名の Jev モデレーション（未設定時はスキップ）。代替: deploy 時 `JEV_API_KEY` / `TYPESAFE_API_KEY` |

### Repository variables（Secret ではない）

| Variable | 既定 |
|----------|------|
| `LOBBY_KV_NAMESPACE_ID` | 未設定時は `metaverse-lobby/wrangler.toml` の KV id |
| `LOBBY_CUSTOM_HOSTNAME` | 未設定時 `m.mmh-virtual.jp` |

Worker **[vars]**（`metaverse-lobby/wrangler.toml`、Secret ではない）: `GEMINI_TRANSLATION_MODEL` は空プレースホルダ（省略時 Worker コードの `gemini-3.1-flash-lite`）。表示名 Jev は `LOBBY_JEV_API_URL` / `LOBBY_JEV_MODEL` / `LOBBY_JEV_REJECT_THRESHOLD` / `LOBBY_DISPLAY_NAME_MOD_ENABLED`（詳細は `docs/metaverse-lobby-admin-integration.md`）。

---

## 3. ⚠️ `LOBBY_ADMIN_PASSWORD` / `LOBBY_SIM_SERVICE_TOKEN` のギャップ

`scripts/lobby-provision-cloudflare.sh` は両方を **環境変数が設定されていれば** `wrangler secret put` するが、**現行** `.github/workflows/deploy-metaverse-lobby.yml` の **Deploy lobby Worker** ステップは次しか `env` に渡していない:

- `CLOUDFLARE_*`, `LOBBY_PRESENCE_SECRET`, `LOBBY_WORKER_SYNC_SECRET`,（任意）`LOBBY_WORKERS_DEV_SUBDOMAIN`,（任意 secret）`GEMINI_TRANSLATION_API_KEY`,（var）`LOBBY_KV_NAMESPACE_ID`, `LOBBY_CUSTOM_HOSTNAME`

そのため GitHub に 6 件すべて登録していても、**GHA だけでは** `LOBBY_ADMIN_PASSWORD` と `LOBBY_SIM_SERVICE_TOKEN` は **Worker に載らない**。

**対処（どちらか）**

1. **ワークフロー修正** — `Deploy lobby Worker` の `env:` に  
   `LOBBY_ADMIN_PASSWORD: ${{ secrets.LOBBY_ADMIN_PASSWORD }}`  
   `LOBBY_SIM_SERVICE_TOKEN: ${{ secrets.LOBBY_SIM_SERVICE_TOKEN }}`  
   を追加してから Actions を再実行
2. **手動投入** — 権限のある環境で:

   ```bash
   cd metaverse-lobby
   export CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=…
   printf '%s' "$LOBBY_SIM_SERVICE_TOKEN" | npx wrangler secret put LOBBY_SIM_SERVICE_TOKEN
   printf '%s' "$LOBBY_ADMIN_PASSWORD" | npx wrangler secret put LOBBY_ADMIN_PASSWORD
   ```

   値は **sim 本番 `.env` の `LOBBY_SIM_SERVICE_TOKEN`** と **GitHub の `LOBBY_ADMIN_PASSWORD`** と一致させる。

管理画面ログイン・ユーザー API・パスワード再設定送信（Worker 経由）の検証前に、上記いずれかを必ず実施する。

---

## 4. 代替: 手元またはサーバーから provision 直叩き

GHA を使わない場合（または secrets を手元で渡す場合）:

```bash
export CLOUDFLARE_API_TOKEN=…          # Workers Scripts Edit + KV + Pages 等
export CLOUDFLARE_ACCOUNT_ID=…         # 推奨
export LOBBY_PRESENCE_SECRET=…         # sim .env と同一
export LOBBY_WORKER_SYNC_SECRET=…      # sim .env と同一
export LOBBY_SIM_SERVICE_TOKEN=…       # sim .env と同一
export LOBBY_ADMIN_PASSWORD=…          # 管理画面用
# 任意: LOBBY_CUSTOM_HOSTNAME, LOBBY_KV_NAMESPACE_ID, LOBBY_PAGES_PROJECT_NAME
bash scripts/lobby-provision-cloudflare.sh
```

初回のみシークレット自動生成するなら `LOBBY_ALLOW_SECRET_GENERATE=1`（**本番では sim と Worker を揃えて手動設定が原則**）。

出力 `lobby-secrets.env` を sim 本番 `.env` に追記（`LOBBY_PRESENCE_SECRET` 等）。**Resend**（`RESEND_*`）は sim `.env` のみ — GHA lobby ワークフローは参照しない。

本番 sim ホストでコード同期:

```bash
sudo /usr/local/bin/metasim-production-git-sync.sh
# または
sudo LOBBY_ENV_FILE=/path/to/lobby-secrets.env bash scripts/lobby-production-apply.sh
```

SSH: スキル [`meta-mmssh`](../meta-mmssh/SKILL.md)（`ssh-meta-production.sh` / `ssh-meta-sudo.sh`）。

---

## 5. sim 本番 `.env` との対応（`.env.example` 参照）

| 変数 | 主な載せ場所 |
|------|----------------|
| `LOBBY_PRESENCE_SECRET` | sim `.env` + Worker secret +（GHA）GitHub secret |
| `LOBBY_WORKER_SYNC_SECRET` / `LOBBY_WORKER_SYNC_URL` | sim `.env` + Worker secret（URL は sim のみ） |
| `LOBBY_SIM_SERVICE_TOKEN` | sim `.env` + Worker secret + GitHub secret（GHA 接続後） |
| `LOBBY_JWT_SECRET` | 任意: sim + Worker（ロビー利用者 JWT。GHA 未配線） |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | **sim `.env` のみ** |

デプロイ後の確認例:

- `https://m.mmh-virtual.jp/admin/` — 管理 UI
- `https://sim.mmh-virtual.jp/api/lobby/status`
- Bearer 付き `https://sim.mmh-virtual.jp/service/users/students`（sim 直）

---

## 6. エージェント向けチェックリスト

1. `main` に lobby 変更があるか / デプロイ必要か確認
2. GitHub secrets 6 件 +（必要なら）vars の説明をユーザーに合わせる
3. **Admin / SIM トークン**が Worker に載っているか（YAML 未接続なら手動 or workflow 修正案を出す）
4. GHA 実行結果（成功 / D1・KV・deploy ログ）を確認
5. sim 本番 sync・`.env` 一致・`metasim-server` 再起動
6. 秘密をログ・PR・チャットに出力しない