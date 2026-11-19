# メタバースロビー管理パネル（Pages）— HTML 移植とバックエンド連携

`design_handoff_metaverse-admin` を **`metaverse-lobby/public/admin/`** に移植済み。UI は **`/admin/api/*` → Worker → sim service** に接続（#1–#13、#15 実装。#14 メールは UI スタブのみ）。

| URL（想定） | 内容 |
|-------------|------|
| `https://m.mmh-virtual.jp/` | 公開ロビー（既存） |
| `https://m.mmh-virtual.jp/admin/` | 新デザイン管理パネル（モック） |
| `https://sim.mmh-virtual.jp/admin/` | 既存 sim プラットフォーム管理（Tenant / env / fleet 等） |

---

## 移植ファイル

```
metaverse-lobby/public/admin/
  index.html    # ゲート + シェル
  admin.css
  store.js      # モックデータ（localStorage）
  ui.js         # グラフ・プレビュー再現
  panel.js      # 画面ロジック
```

デザイン参照: リポジトリ外 `/uploads/design_handoff_metaverse-admin_*.zip`

---

## データモデル差分（ハンドオフ ↔ 現行 sim）

| ハンドオフ `World` | 現行 `lobby-catalog.json` / Worker | ギャップ |
|--------------------|-------------------------------------|--------|
| `status`: open / event / maint | `maintenance` + Worker `status` (online/live/maint/degraded) | **event**・**診断中**の明示フィールドなし |
| `audience`: all / signed / admin | なし | **新規**（公開範囲フィルタ） |
| `url` | `entryUrl` | 名前違いのみ |
| `code` | `joinCode` | 名前違いのみ |
| `thumb` | `thumbnailUrl` | 同名 |
| `cap` | `capacity` | 同名 |
| `players` | Worker が `presenceUrl` から集計 | 一覧 API に含む |
| 24h / 7d 系列 | Worker `series`（24点） | **7日 API なし**、履歴ストアなし |

| ハンドオフ `User` | 現行 sim | ギャップ |
|-------------------|----------|--------|
| online / banned / role | D1 students/teachers のみ（admin 経由 CRUD） | **BAN・オンライン・参加履歴なし** |
| history[] | なし | **新規** |
| handle / email | 一部のみ | ロビー認証は未連携 |

---

## 結合が必要な仕組み一覧

工数: **S**（〜2人日） / **M**（〜1週間） / **L**（複数サブシステム）  
難易度: **低** / **中** / **高**

| # | 領域 | 必要なもの | 現状 | 対応策 | 工数 | 難易度 |
|---|------|------------|------|--------|------|--------|
| 1 | **認証** | `/admin/*` の管理者保護 | Pages は静的のみ。ゲートはモック | **A)** Cloudflare Access on `m.mmh-virtual.jp/admin*` **B)** Worker で Basic 検証 **C)** sim へリバースプロキシ | S | 低 |
| 2 | **管理 API 経路** | ブラウザ → sim の `admin/lobby-catalog` 等 | オリジン分離（m. vs sim.） | Pages Functions **`/admin/api/*` → sim** プロキシ + クレデンシャル（Cookie / Bearer） | M | 中 |
| 3 | **カタログ CRUD** | REST: 一覧・詳細・作成・更新・削除 | `GET/PUT /admin/lobby-catalog`、Tenant 連動 upsert | スキーマ拡張（`audience`, `status: live/event`）+ **DELETE 行** + 保存時 **Worker sync** | M | 中 |
| 4 | **Worker 同期** | 保存・削除後の push | `POST /admin/lobby-catalog/sync` あり | 管理 UI から自動 sync（既存ルート再利用） | S | 低 |
| 5 | **公開範囲** | `audience` でロビー表示制御 | なし | カタログにフィールド追加 → Worker `GET /api/metaverses` で **viewer コンテキスト**（guest / signed / admin）フィルタ | M | 中 |
| 6 | **ロビー認証連携** | サインイン済み判定 | ロビーは `localStorage` デモ | sim D1 または JWT 発行 → **`m.` ロビーと管理の同一 identity** | L | 高 |
| 7 | **稼働グラフ（24h）** | サーバー×時間バケットの同時接続 | Worker KV の `series`（24点・リアルタイム寄り） | **A)** 短期: Worker API 拡張で現 `series` を返す **B)** 長期: DO/Cron で **1h バケットを D1/KV に蓄積** | M〜L | 中〜高 |
| 8 | **稼働グラフ（7d）** | 日次バケット | なし | 上記蓄積レイヤ必須 + `GET /api/admin/metrics?range=7d` | L | 高 |
| 9 | **サマリー KPI** | 合計オンライン・ピーク・稼働数 | `GET /api/metaverses` + presence | 管理専用 **`GET /api/admin/overview`**（集計は Worker または sim） | M | 中 |
| 10 | **ユーザー一覧** | ページング・検索 | `GET /admin/users/students|teachers`（sim・Basic） | 管理 UI 用 **BFF** が sim を集約。ロール・メールをハンドオフ形にマップ | M | 中 |
| 11 | **BAN / ロール** | banned フラグ・admin 付与 | なし | D1 カラム or `user_flags` テーブル + **`PATCH /admin/users/:id`** + 監査ログ | L | 高 |
| 12 | **接続切断** | オンライン socket kill | tenant socket のみ内部 | **`POST /admin/users/:id/kick`**（platform が tenant 横断で socket 特定） | M | 中 |
| 13 | **参加履歴** | 全ユーザー合算ログ | なし | join 時に **イベントログ**（D1/KV）: user, world, at, dur, ok | L | 高 |
| 14 | **パスワード再設定** | Resend メール | **実装済** | sim `RESEND_*` + `/reset-password.html` | S | 低 |
| 15 | **プレビュー** | 公開ロビーと同一コンポーネント | `ui.js` が HTML 複製 | **共有モジュール化**（`lobby.css` + 小さな `preview.js`）で乖離防止 | M | 中 |
| 16 | **サムネアップロード** | URL 入力のみ（設計） | 同左 | **実装済**: Worker R2 `lobby-thumbnails`（`LOBBY_ASSETS`）+ `POST /api/admin/upload/thumbnail`（最大10MB）、公開 `GET /api/assets/thumbnails/*`、UI は D&D + ファイル選択 | M | 中 |
| 17 | **監査ログ** | BAN・削除・権限変更 | なし | `lobby_audit_log`（who, what, target, at） | M | 中 |

---

## 推奨実装フェーズ

### フェーズ 1 — 見た目＋カタログ（最短で価値）

1. Cloudflare Access または Basic で `/admin/` 保護  
2. `panel.js` の `store` を **sim `PUT/GET /admin/lobby-catalog`** に差し替え（CSRF + Basic は BFF 経由）  
3. 保存時 Worker sync  
4. `audience` / `status` フィールドを JSON スキーマに追加  

### フェーズ 2 — 運用メトリクス

5. Worker か sim で overview API（現行 presence を利用）  
6. 24h グラフは Worker `series` を接続（モック `hourly()` 削除）

### フェーズ 3 — ユーザー・履歴

7. D1 拡張 + ユーザー BFF  
8. 参加ログパイプライン（ロビー join → sim/Worker ログ）

---

## 既存 sim 管理との住み分け

| 操作 | 推奨画面 |
|------|----------|
| Tenant 作成・ワールド中身・FDS | `sim.mmh-virtual.jp/admin/`（既存） |
| ロビー掲載・サムネ・参加コード・公開範囲・ロビー向けプレビュー | `m.mmh-virtual.jp/admin/`（本パネル） |
| systemd / .env / fleet | sim 管理 → ネットワーク／Fleet タブ（現状のまま） |

---

## お知らせの自動翻訳（Gemini）

管理画面でお知らせを作成・更新すると、Cloudflare Worker が **Gemini 3.1 Flash Lite**（API モデル ID: `gemini-3.1-flash-lite`、任意で Worker **var** `GEMINI_TRANSLATION_MODEL`）を呼び出し、管理者が選んだ原文ロケールから **ja / zh-CN / zh-TW / en** へ翻訳して D1 の `i18n_json` に保存します。公開 `GET /api/announcements` はクライアントの UI ロケール（`?locale=` または `Accept-Language`）に合わせた `title` / `body` を返します。

| 変数 | 用途 |
|------|------|
| `GEMINI_TRANSLATION_API_KEY` | Wrangler シークレット（未設定時は翻訳をスキップし、原文のみ保存・後方互換） |
| `GEMINI_TRANSLATION_MODEL` | `wrangler.toml` [vars]（空のときコード既定 `gemini-3.1-flash-lite`） |

本番デプロイ: GitHub Actions **Deploy metaverse-lobby** のリポジトリシークレット `GEMINI_TRANSLATION_API_KEY`、または `scripts/lobby-provision-cloudflare.sh` 実行時に同変数を渡すと `wrangler secret put GEMINI_TRANSLATION_API_KEY` されます。API キーはログに出力しません。sim 本番のチャット検閲用 `GEMINI_API_KEY` とは別名です。

---

## ローカル確認

```bash
cd metaverse-lobby/public
python3 -m http.server 8765
# http://127.0.0.1:8765/admin/  （store は localStorage）
```

本番反映は **Deploy metaverse-lobby (Worker + Pages)** ワークフローで `public/admin/` が含まれる。