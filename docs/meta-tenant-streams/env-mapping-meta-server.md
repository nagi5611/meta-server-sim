# meta-server → sim 環境変数マッピング（WS-5）

**テナント ID:** `meta-server`  
**対象 ToDo:** T09, T10, T25, T26, T27  
**原則:** meta-server 単一 DB / Cookie セッションは採用しない。ユーザーデータは移行しない（本番 `/server_src/db/users.db` は students 0 / teachers 0。古い `data/users.db` の生徒 3 人も移行しない）。D1 の既存ユーザーは変更しない。

## 認証・DB（運用メモ）

| 項目 | meta-server（本番・調査） | sim（テナント `meta-server` 向け） |
|------|---------------------------|--------------------------------------|
| ユーザー DB | `/server_src/db/users.db`（空） | プラットフォーム D1 優先 + `USERS_DB_PATH`（既定 `data/users.db`） |
| セッション | `user_sessions.db`（Cookie） | `metaverse_socket_auth` Cookie（JWT 系 HMAC）+ ロビー JWT / `lobbyUserRef` |
| ログイン API | `POST /api/auth/student\|teacher/login` | 同名ルート（`lib/tenant-user-auth-routes.js`）。**空 DB ではローカル teacher/student ログインは実質不可** |
| ゲスト | ゲスト名 + モデレーション | `ensureGuestHttpAuthForClientConfig`（ゲスト token）+ `POST /{tenant}/api/moderate-display-name` |
| **推奨入場** | 単一ホスト直アクセス | **ロビー経由**（Google OAuth / ゲスト表示名）→ テレポート or `entryUrl` で `/meta-server/` |

ローカル開発でテナントのみ試す場合はゲスト Cookie 自動発行で R2 署名・Socket 入場が可能。本番 `meta-server` テナントは他テナント（P-01 等）と同じロビー連携を前提とする。

## 環境変数マッピング表

**凡例:** sim 列が「不要」= テナント `meta-server` では設定不要。「WS-6」= アセット配信ストリームで扱う。「—」= 同名または同等の sim 側キーで足りる。

| meta-server（想定 / 調査） | sim 置換先 | 備考 |
|----------------------------|------------|------|
| （Cookie セッション秘密） | `SOCKET_AUTH_SECRET` | HMAC 用。本番は長い固定値必須（`.env.example` 参照） |
| `GEMINI_API_KEY` | `GEMINI_API_KEY` | テナントチャット・表示名の Gemini 段（`getPlatformEnv`） |
| `GEMINI_MODEL` | `GEMINI_MODEL` | 既定 `gemini-3.1-flash-lite`（sim 既存方針） |
| `JEV_API_KEY` | `TYPESAFE_API_KEY` または `JEV_API_KEY` | チャット Jev ゲート（`lib/chat-moderation-config.js`） |
| `JEV_*`（個別） | `CHAT_MOD_JEV_*` | 下表の細目。meta の単一 `JEV_` 名は sim では `CHAT_MOD_` 接頭辞 |
| （チャット閾値等） | `CHAT_MOD_JEV_REJECT_THRESHOLD` ほか | 未設定時は threshold が NaN → チャット送信時に設定エラー（意図的） |
| `CHAT_MOD_PIPELINE` | 同名（既定 `jev-gemini`） | `gemini-only` で Jev スキップ可 |
| `CLOUDFLARE_TURN_API_TOKEN` | 同名 | VC TURN（`lib/tenant-mediasoup-core.js`） |
| `CLOUDFLARE_TURN_KEY_ID` | 同名 | 同上 |
| mediasoup 公開 IP 系 | `MEDIASOUP_ANNOUNCED_IP` | 本番未設定時は VC 警告ログ |
| （meta 固有 RTC ポート分割） | `VC_RTC_*`, `VIDEO_VC_RTC_*` | sim 既定レンジで統一 |
| （Resend なし） | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | **ロビー**のパスワード再設定・ban 通知（テナント内チャットとは別） |
| `USE_S3_MODELS`, `CLOUDFRONT_*`, `AWS_*` | **不要**（WS-6） | R2 + `/{tenant}/api/sign-asset-urls` |
| `ENABLE_CHART_FEATURES` 等 | WS-3 | 譜面 API は別ストリーム |
| Google STT / Translate 依存 | **不要**（テナント未使用時） | sim はプラットフォーム字幕用に別キー（`.env.example` 末尾） |
| ロビー OAuth | **sim 本体不要** | Worker 側 `GOOGLE_*`（`.env.example` コメント） |
| ロビー表示名 Gemini | Worker: `GEMINI_TRANSLATION_*` | sim テナント: ゲスト表示名は `DISPLAY_NAME_JEV_*` + `GEMINI_*` |
| `D1_*` / Cloudflare API | `CLOUDFLARE_API_TOKEN`, `D1_DATABASE_ID`, `CLOUDFLARE_ACCOUNT_ID` | プラットフォーム users のみ。テナントデータベースではない |
| `USERS_DB_PATH` | 同名 | D1 不可時フォールバック |
| `ACTIVITY_WEBHOOK_URL` 等 | 同名 | Discord（任意） |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 同名 | プラットフォーム `/admin`（テナント別は URL パス） |
| `TENANT_SOCKET_SECRET` | 同名 or `tenant.json` の `socketSecret` | 任意 join 制限 |
| `LOBBY_*`（sim 既存） | 同名 | `meta-server` テナントの catalog / presence 連携（WS-1 T29） |

### meta `JEV_*` → sim `CHAT_MOD_JEV_*` 細目

| meta-server（一般的な名前） | sim |
|----------------------------|-----|
| （Typesafe / Jev API キー） | `TYPESAFE_API_KEY` または `JEV_API_KEY` |
| （モデル） | `CHAT_MOD_JEV_MODEL`（既定 `jev-latest`） |
| （API URL） | `CHAT_MOD_JEV_API_URL` |
| （拒否閾値 0–1） | `CHAT_MOD_JEV_REJECT_THRESHOLD` |
| （タイムアウト ms） | `CHAT_MOD_JEV_TIMEOUT_MS` |
| （ポリシーテキスト） | `CHAT_MOD_JEV_POLICY_TEXT`（チャット） / `DISPLAY_NAME_JEV_POLICY_TEXT`（表示名） |
| （拒否判定質問） | `CHAT_MOD_JEV_REJECT_QUESTION` / `DISPLAY_NAME_JEV_REJECT_QUESTION` |
| Jev 有効フラグ | `CHAT_MOD_JEV_ENABLED`（既定有効） |

ゲスト表示名は meta の `guest/username-moderate` に相当する機能が sim では `lib/display-name-moderation-policy.js` + ロビー Worker 側モデレーションに分割されている。

## 秘密の取り扱い

本ドキュメントおよび PR には**秘密値を記載しない**。本番 `.env` は調査 run では cursor SSH から読み取れず（`/home/nagi/meta-server/.env` は権限外）、SHA256 先頭の実測値は未掲載。WS-8 で sim 本番 `.env` を更新する際は、既存 metasim の `GEMINI_*` / `TYPESAFE_*` / `CLOUDFLARE_TURN_*` を流用し、meta-server テナント専用の重複キーは原則作らない。

## コード差分（WS-5）

- **変更なし（現状で足りる）:** `lib/tenant-user-auth-routes.js`（ログイン API 互換）、`lib/tenant-chat-socket.js`（Gemini/Jev）、`lib/tenant-mediasoup-core.js`（TURN）
- **本 PR:** 本マッピング、`.env.example` 追記、`test/tenant-auth-guest.test.js` 追加、`lib/platform-env-schema.js` に参照コメント

## 参照

- 計画: `docs/meta-server-tenant-migration-plan.md`（ブランチ `cursor/meta-server-tenant-7179`）
- WS-5 指示: `docs/meta-tenant-streams/WS-5.md`（同上）