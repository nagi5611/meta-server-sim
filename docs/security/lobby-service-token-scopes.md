# Worker → sim `/service` Bearer スコープ

## 概要

`lib/lobby-service-auth.js` が `/service/*` の Bearer 認証を担当します。

- 比較は `crypto.timingSafeEqual`（長さ不一致時は即失敗）
- **後方互換**: `LOBBY_SIM_SERVICE_TOKEN` のみ設定のとき、従来どおり全ルートにアクセス可
- **ローテーション**: 各トークンに対応する `*_PREVIOUS` で新旧2本を同時受理
- **スコープ**（任意）: 漏洩時の blast radius 削減

## スコープとルート

| スコープ | 環境変数 | 主なルート |
| --- | --- | --- |
| `read` | `LOBBY_SIM_SERVICE_TOKEN_READ` | GET catalog / users / presence / favorites |
| `user_write` | `LOBBY_SIM_SERVICE_TOKEN_USER_WRITE` | PATCH users, password-reset, profile, favorites 更新 |
| `catalog_write` | `LOBBY_SIM_SERVICE_TOKEN_CATALOG_WRITE` | PUT catalog, POST catalog/sync |
| `auth` | `LOBBY_SIM_SERVICE_TOKEN_AUTH` | Google OAuth peek/complete, admin-login |
| `kick` | `LOBBY_SIM_SERVICE_TOKEN_KICK` | POST `/service/lobby/kick` |

`LOBBY_SIM_SERVICE_TOKEN`（および `LOBBY_SIM_SERVICE_TOKEN_PREVIOUS`）は上記すべてを許可します。

## オーナー作業（段階的移行）

1. **現状維持**: 何もしなければ `LOBBY_SIM_SERVICE_TOKEN` だけで本番は今まで通り動作します。
2. **ローテーションのみ**: 新トークンを `LOBBY_SIM_SERVICE_TOKEN` に、旧を `LOBBY_SIM_SERVICE_TOKEN_PREVIOUS` に設定。Worker secret と sim `.env` を同時更新後、`PREVIOUS` を削除。
3. **スコープ分離（推奨・任意）**: スコープごとに別のランダム文字列を生成し、sim `.env` に設定。Worker 側は現行 `fetchSim` が単一 `LOBBY_SIM_SERVICE_TOKEN` のため、**Worker コード拡張まで**は本番でも `LOBBY_SIM_SERVICE_TOKEN` を残すか、手動で各呼び出しに適切な Bearer を渡す必要があります（将来 Worker がスコープ別 secret を使う前提の sim 側準備）。
4. スコープ用変数を設定した状態で legacy フルトークンを使い続けると、sim ログに1回限りの警告が出ます。

トークン値はリポジトリ・issue に書かないでください。