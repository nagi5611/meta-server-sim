# meta-server → sim テナント `meta-server` 移行計画

**作成日:** 2026-11-22  
**対象:** 本番 meta-server（`META_SRC_DIRECTORY=/server_src`、`https://meta.mmh-virtual.jp/`）を sim テナントとして再現する。  
**原則:** すべて sim の形式・実装に合わせる。meta-server 独自の配信・認証・ストレージ経路は新テナントに残さない。

## 現状スナップショット（本 run 時点）

| 項目 | 状態 |
|------|------|
| エージェント作業ブランチ | `cursor/meta-server-tenant-7179`（`94f3573`、**コード変更なし**・ブランチ作成のみ） |
| 未マージ PR | 本 run では計画 PR のみ作成予定 |
| sim 本番 HEAD | `94f3573`（`/home/nagi/sim-server/meta-server-sim`） |
| sim ステージング HEAD | `2922a49`（`/home/nagi/sim-server/meta-server-sim-staging`、main より遅延） |
| `tenants/meta-server` | 本番・ステージングとも **未作成** |
| 本 run のサーバー変更・バックアップ | **なし**（SSH は読み取りのみ） |
| 稼働 DB（meta） | `/server_src/db/users.db` — students **0**, teachers **0** |
| モデル（実ディスク） | `/server_src/models` 約 **1577** ファイル；R2 `meta/models/` は別エージェント **bc-89ac0a70** がコピー中（**書き換え・削除禁止**） |
| meta 有効アドオン（`addons_registry.db`） | `admin-reboot`, `webxr-vr`, `meta-bench-r1`, `time-machine`, `nfc-spawn`（`aircraft` は **無効**） |

### インターフェース（全ストリーム共通・先に固定）

| 項目 | 値 |
|------|-----|
| **テナント ID** | `meta-server`（`validateTenantIdForCreate` 上問題なし） |
| **表示名** | `meta-server`（ロビー表示名は `lobby-catalog` で調整可） |
| **ワールド ID** | `lobby`, `main`, `school`（`/server_src/data/worlds.json`） |
| **アセット相対パス** | ワールド内 `path`: `models/...`（sim テナント URL 空間） |
| **R2 バケット** | 本番 sim `.env` の `R2_BUCKET_NAME`（バケット名は環境依存・本文に値を書かない） |
| **R2 テナントキー** | `{R2_KEY_PREFIX}/tenants/meta-server/{store}/{rel}`、既定 `metaverse/tenants/meta-server/...` |
| **R2 共有モデル（読み取り専用）** | `meta/models/...` — ミラー元として参照のみ |
| **ユーザー移行** | **行わない**（含む `/home/nagi/meta-server/data/users.db` の生徒 3 人） |

### 共通制約（全エージェント）

ジオラマは対象外。古い DB の生徒 3 人は移行しない。meta-server 本体（サービス・データ・`.env`・`nagi5611/meta-server` リポ）は**読むだけ**（停止・再起動・データ変更なし）。ステージング確認後に本番反映。P-01〜P-03 のデータに触らない。CSP 変更禁止（`unsafe-eval` 不可）。秘密は平文で残さない（変数名と値の SHA256 先頭 8 桁まで可）。ステージング stash `pre-vdb-volume-cloud-deploy` に触らない。Dependabot PR #53–#65 はマージしない。スコープ外のサービス再起動なし。R2 `meta/models/` は bc-89ac0a70 のコピー対象のため**書き換え・削除しない**。

---

## ToDo リスト（網羅）

| ID | 項目 | meta-server の現状（実測） | sim での置換先 | 本 run / 統合 |
|----|------|---------------------------|----------------|---------------|
| T01 | **テナント骨格** | 単一インスタンス、`/server_src` 直下に data/models/avatars | `tenants/meta-server/` + `tenant.json` | WS-1 |
| T02 | **ワールド data** | `/server_src/data/worlds.json`（3 ワールド、太鼓 `taiko` 等） | `tenants/meta-server/data/worlds.json` | WS-1 |
| T03 | **アバター registry** | `/server_src/avatars/_meta/avatars-registry.json`（v5, 1 体） | `tenants/meta-server/avatars/_meta/` + R2 `avatars/` | WS-1, WS-6 |
| T04 | **モデル配信** | `USE_S3_MODELS` + AWS + **CloudFront 署名 URL**（`POST /api/metaverse/sign-asset-urls`） | R2 + `/{tenant}/api/sign-asset-urls`、キー `metaverse/tenants/meta-server/models/` | WS-2, WS-6 |
| T05 | **R2 ミラー** | S3 `meta/models/` → R2 `meta/models/`（bc-89ac0a70） | R2 サーバーサイドコピー → テナントキー（`meta/models/` は不変） | WS-2 |
| T06 | **ローカル残アセット** | `env/default.hdr`、`images/`、`pdfs/`、プレハブ等 `/server_src` | テナントディレクトリ + `migrate-tenant-assets-to-r2.mjs` | WS-6 |
| T07 | **譜面（チャート）** | `charts.json` 約 90KB、`chart-bgm/` 約 151MiB、`ENABLE_CHART_FEATURES` | sim 側 **新規実装**（現在 `chartFeaturesEnabled: false` スタブ） | WS-3 |
| T08 | **譜面 API** | `GET/POST /api/charts`, ランキングメモリ保持 | テナントルーター `/:id/api/charts` | WS-3 |
| T09 | **ログイン・認証** | Cookie セッション、`/api/auth/student|teacher/login`、ゲスト名モデレーション | sim **プラットフォーム D1/SQLite** + `tenant-user-auth-routes`；テナントはゲスト/ロビー連携 | WS-5 |
| T10 | **DB 接続** | `/server_src/db/users.db`（空）、`user_sessions.db`（133 行）、`addons_registry.db` | sim `data/users.db` / D1（**ユーザーデータ移行なし**） | WS-5 |
| T11 | **アドオン有効化** | SQLite `addon_enabled`（上記 5 件） | `data/platform/tenant_plugins.db` の `tenant_plugin_enabled` | WS-4 |
| T12 | **飛行機** | legacy `addons/aircraft`（registry 上無効）+ `/lib/aircraft-server` 静的配信 | sim `addons/aircraft` プラグイン | WS-4 |
| T13 | **松山フライツ** | meta アドオン | sim `addons/matsuyama-flights` | WS-4 |
| T14 | **煙/VDB** | `smoke-view` + `play_vdb` | sim `addons/vdb-volume` | WS-4 |
| T15 | **WebXR** | `webxr-vr` | sim `addons/xr` | WS-4 |
| T16 | **タイムマシン** | S3 同期前提のバックアップ | sim `addons/time-machine`（R2/no-op CF） | WS-4 |
| T17 | **meta-bench-r1** | 有効 | sim 同プラグイン | WS-4 |
| T18 | **admin-reboot** | 有効 | sim **未同梱** → 新規移植 or スコープ判断 | WS-7 |
| T19 | **nfc-spawn** | 有効 | sim **未同梱** → sim プラグイン新規 | WS-7 |
| T20 | **qr-ar** | ディレクトリあり、registry 未確認 | sim **未同梱** → 新規 or ワールド未使用なら延期 | WS-7 |
| T21 | **avator-scalable-animations** | meta のみ | sim アバター registry で代替検討 | WS-1, WS-7 |
| T22 | **インスタンスビューア** | `/instance`, `/pre_xr` | sim テナント URL 体系へ **要否判断** | WS-7 |
| T23 | **host-monitor** | `/host-monitor` | sim **なし** → 運用外なら対象外 | WS-7 |
| T24 | **管理画面** | 単一 `/admin/*`（ワールド・モデル・チャート・DB 探索） | sim `/admin` + `/admin/tenants/meta-server/*` | WS-3, WS-6 |
| T25 | **Gemini / Jev** | `GEMINI_*`, `JEV_*` | sim 既存 `lib/chat-moderation-*`（テナントチャット） | WS-5 |
| T26 | **メール** | （meta package に明示メール SDK なし） | sim `RESEND_*`（プラットフォーム） | WS-5 |
| T27 | **WebRTC / TURN** | `CLOUDFLARE_TURN_*`, mediasoup ポート分割多数 | sim 既存 VC ポート・`MEDIASOUP_ANNOUNCED_IP` | WS-5（設定確認のみ） |
| T28 | **Google Speech/Translate** | meta `package.json` に依存 | sim **未依存** → テナントで未使用なら不要 | WS-7 |
| T29 | **lobby-catalog** | なし（単一ホスト） | `data/platform/lobby-catalog.json` + ロビー Worker 同期 | WS-1 |
| T30 | **統合・デプロイ** | — | マージ順・ステージング `2922a49` 差分・本番 pull・バックアップ | **WS-8** |
| T31 | **検証** | — | Playwright（新テナント + P-01〜P-03 回帰） | **WS-8** |

### meta-server 固有機能（実測ルート・存在確認）

| 機能 | 実測 | sim 相当 |
|------|------|----------|
| 譜面・太鼓・ランキング | `ENABLE_CHART_FEATURES`, `/api/charts*` | **新規実装**（WS-3） |
| CloudFront 署名配信 | `CLOUDFRONT_*`, `sign-asset-urls` | R2 署名（WS-6） |
| NFC スポーン | アドオン有効 | 新規プラグイン（WS-7） |
| QR AR | コードあり | 新規 or 延期（WS-7） |
| DB 管理 UI | `/admin/database/*` | 部分（platform）/ テナント DB 探索は要検討（WS-7） |
| 課題・授業 | 調査上 **専用ルートなし** | 不要 |
| ライブ配信専用 | mediasoup VC は共通 | sim 既存 |
| 外部ポータルテレポート | P-01 → meta（PR #72） | 既存；逆方向はロビー URL で対応 |

---

## ワークストリーム一覧

| WS | 名前 | 担当 ToDo | 依存 | 開始可否 |
|----|------|-----------|------|----------|
| [WS-1](meta-tenant-streams/WS-1.md) | テナント骨格・データ取込・lobby | T01,T02,T03,T29,T21 | なし（インターフェース確定済み） | **可** |
| [WS-2](meta-tenant-streams/WS-2.md) | R2 モデルミラー | T04,T05 | WS-1 の tenant ID；bc-89ac0a70 の進捗 | **可**（未完コピー時は完了分のみ） |
| [WS-3](meta-tenant-streams/WS-3.md) | 譜面（チャート）sim 実装 | T07,T08,T24 | WS-1 の data パス | **可** |
| [WS-4](meta-tenant-streams/WS-4.md) | アドオン・飛行機 | T11–T17 | WS-1 | **可** |
| [WS-5](meta-tenant-streams/WS-5.md) | 認証・DB・外部サービス | T09,T10,T25–T27 | なし | **可** |
| [WS-6](meta-tenant-streams/WS-6.md) | アセット配信・chart-bgm・avatars/env | T04,T06,T03 | WS-1, WS-3（chart-bgm store） | WS-1 後 |
| [WS-7](meta-tenant-streams/WS-7.md) | meta 固有機能の sim 化 | T18–T23,T28 | WS-4 と調整（nfc/qr） | **可**（並列調査） |
| [WS-8](meta-tenant-streams/WS-8.md) | **統合・デプロイ・検証** | T30,T31 | **全 WS の PR マージ後** | **最終** |

**ルール:** WS-1〜7 は **PR + テストまで**。マージ・SSH デプロイ・`systemctl restart` は **WS-8 のみ**。

### 推奨マージ順（WS-8 用メモ）

1. WS-5（設定ドキュメント・無害なフラグ）  
2. WS-3（チャート基盤）  
3. WS-6（R2 store 拡張・配信）  
4. WS-1（テナントデータ）  
5. WS-2（ミラースクリプト）  
6. WS-4（プラグイン）  
7. WS-7（固有機能・分割 PR 可）  

---

## 検証・ロールバック（WS-8 実施）

- **ステージング URL:** `https://staging.mmh-virtual.jp:3104/meta-server/`（要 lobby-catalog / 証明書確認）  
- **本番 URL:** `https://sim.mmh-virtual.jp/meta-server/`  
- **回帰:** P-01〜P-03 入場・既存プラグイン  
- **バックアップ:** デプロイ前に `tenants/`  tarball + `data/platform/tenant_plugins.db` + `lobby-catalog.json`  
- **ロールバック:** tarball 復元、`tenants/meta-server` 削除、lobby-catalog 巻き戻し、`metasim-*-server` 再起動（WS-8）

---

## 調査メモ（方式 → sim 置換・出典）

調査方法: 本番 SSH 読み取り（`meta.mmh-virtual.jp`）、`meta-server-sim` リポジトリ静的解析。秘密値は未取得・未記載。

| 領域 | meta-server | sim |
|------|-------------|-----|
| ストレージ | AWS S3 + CloudFront 署名 | R2 S3 API + `toR2Key` |
| 認証 | 単一 DB + cookie | D1 優先 + `data/users.db` |
| アドオン | `addons_registry.db` | `tenant_plugins.db` + `plugin.json` |
| マルチテナント | なし | `tenants/{id}/` |

関連ドキュメント: [r2-storage-analysis.md](./r2-storage-analysis.md), [tenant-plugins.md](./tenant-plugins.md)