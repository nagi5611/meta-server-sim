# WS-7: meta-server 固有機能の sim 化（完了メモ）

## 実装済み（本 PR）

| 機能 | meta 実測 | sim |
|------|-----------|-----|
| **nfc-spawn** | `addon_enabled=1` | `addons/nfc-spawn` テナントプラグイン |
| **admin-reboot** | `addon_enabled=1` | `addons/admin-reboot`（テナントプラグイン再読込のみ） |
| **qr-ar** | コードあり | 既存 `addons/arxr`（WS-4/本 WS で追加実装なし） |

## 対象外（根拠）

| 機能 | 根拠 |
|------|------|
| **host-monitor** | meta に `public/host-monitor.html` + ルートあり。**運用専用**（テナント機能ではない）。sim は `admin-api-fetch` のパスのみ。**Fleet ops / プラットフォーム監視は WS-8 外の運用範囲**。 |
| **pre_xr** | meta `public/pre_xr/` は WebXR 開発ハーネス。本番ワールド・registry から参照なし。sim は `addons/xr` で本番相当をカバー。 |
| **avator-scalable-animations** | meta のみの addon。テナント `avatars-registry` + 既存 clip 名で代替（WS-1）。専用 addon 移植はデータ上必須ではない。 |
| **Google Speech/Translate** | meta `package.json` 依存あり。チャット/字幕パイプラインで sim 既存 Gemini/Jev を使用しており、テナント機能としての GCP Speech 呼び出し実測なし。 |
| **DB admin explorer** | meta `/admin/database/*` は単一ホスト向け。sim は `/admin` プラットフォーム + `/admin/tenants/:id/*`。汎用 SQL 探索はスコープ外（秘密・他テナント境界リスク）。 |
| **global `/instance` ルート** | sim では `/:tenantId/instance/` にスコープ（テナント境界）。 |

## WS-8 デプロイ手順（メモ）

1. 本 PR マージ後、`data/platform/tenant_plugins.db` でテナント `meta-server` に `nfc-spawn` / `admin-reboot` を enable。
2. `POST /admin/tenant/meta-server/plugins/reload` または admin-reboot UI「プラグイン再読込」。
3. ステージングで `/:tenantId/?spawn=...` と `/admin/tenants/:tenantId/addons/nfc-spawn/` を確認。
4. **systemctl / restart.sh は WS-8 のみ**（admin-reboot からは不可）。