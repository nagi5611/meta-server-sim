# WS-8: 統合・デプロイ・検証（唯一のマージ/本番権限）

## 目的

WS-1〜7 の PR を順にマージし、ステージング（HEAD `2922a49` から追従）→ Playwright → 本番 sim へ反映する。**他ストリームは本 WS 以外デプロイしない。**

## 担当 ToDo

T30, T31

## 所有範囲

- 全ブランチのマージ（GitHub）
- SSH: `/home/nagi/sim-server/meta-server-sim-staging`, `meta-server-sim`（`nagi` ユーザー、`metasim-staging-server` / `metasim-server`）
- `e2e/meta-server-tenant.spec.js`, `scripts/staging-meta-portal-e2e.mjs` 拡張
- `/opt/cursor/artifacts/` 証跡
- バックアップパス記録

**禁止:** meta-server.service 操作、P-01〜P-03 データ変更、stash 操作、Dependabot #53–65 マージ

## 依存

**すべての WS PR が Ready for review の後**

## ステージング差分（実測 2026-11-22）

| 環境 | HEAD | 備考 |
|------|------|------|
| 本番 sim | `94f3573` | main と一致 |
| ステージング | `2922a49` | main より古い。統合時に **staging を main へ fast-forward または merge** してから機能 PR を載せる |
| stash | `pre-vdb-volume-cloud-deploy` | **触らない** |

## 推奨マージ順

WS-5 → WS-3 → WS-6 → WS-1 → WS-2 → WS-4 → WS-7（複数 PR は依存順）

## デプロイ手順（概要）

### 共通制約

（計画書「共通制約」全文を遵守。）

1. **バックアップ**（staging → prod それぞれ）  
   - `tar czf /home/nagi/backups/metasim-tenants-$(date -u +%Y%m%dT%H%MZ).tgz tenants`  
   - `cp data/platform/lobby-catalog.json data/platform/tenant_plugins.db` 同梱
2. Staging: `git pull` → `npm ci` → `npm run build` → `systemctl restart metasim-staging-server`（**許可された sim ユニットのみ**）
3. サーバー実行（WS-2 ミラー、WS-6 sync、WS-4 enable plugins）— `.env` は既存 R2 資格情報
4. Playwright:
   - `meta-server` 入場 URL が **staging ホスト**であることを `*.url.txt` に保存
   - ワールド・モデル・有効プラグイン表示
   - P-01〜P-03 回帰（`staging-meta-portal-e2e.mjs` + tenant smoke）
5. 本番: 同手順 `metasim-server`、バックアップ後
6. 報告: テナント ID、URL、モデル件数、未完了理由、ロールバック手順

## インターフェース検収

- [ ] `GET /meta-server/api/worlds` が 3 ワールド
- [ ] R2 モデル: 代表 `models/monument.glb` が 200
- [ ] `chartFeaturesEnabled` が期待どおり（太鼓オブジェクト）
- [ ] プラグイン HTTP ヘルス（matsuyama, vdb-volume 等）
- [ ] lobby-catalog に `meta-server` エントリ

## 完了条件

- 本番・ステージング検証スクリーンショット
- main 上のマージ SHA 一覧
- ユーザー向け日本語報告（結論先頭）