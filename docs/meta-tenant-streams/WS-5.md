# WS-5: 認証・DB・外部サービス（sim 既存の利用）

## 目的

meta-server の cookie/単一 DB モデルを **採用せず**、sim の D1/SQLite・テナントゲスト認証・既存 Gemini/Jev/TURN 設定でテナント `meta-server` を運用できるよう、差分と必要 env を文書化し、不足があれば**最小コード**で補う。ユーザーデータ移行は行わない。

## 担当 ToDo

T09, T10, T25, T26, T27

## 所有範囲

- `docs/meta-tenant-streams/env-mapping-meta-server.md`（新規）
- `.env.example`（変数名のみ追記、値なし）
- `lib/tenant-user-auth-routes.js`（変更は必要時のみ）
- `lib/platform-env-schema.js`（説明コメント）
- `test/tenant-auth-guest.test.js`（既存拡張可）

**触ってはいけない:** `/server_src/db/users.db` の書き込み、D1 本番データの破壊的変更

## 調査結果（実測）

| 項目 | meta-server | sim |
|------|-------------|-----|
| 稼働 users | `/server_src/db/users.db` students 0 / teachers 0 | D1 + `data/users.db` |
| セッション | `user_sessions.db` 133 行 | sim ロビー JWT / socket auth |
| ログイン API | `/api/auth/student|teacher/login` | テナントルーター同名あり |
| ゲスト | `guest/username-moderate` | ゲスト token + 表示名モデレーション |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | 同名利用 |
| Jev | `JEV_*` | `CHAT_MOD_JEV_*` 等 |
| TURN | `CLOUDFLARE_TURN_*` | 同名 |
| メール | meta package に Resend なし | `RESEND_*` |
| AWS/CloudFront | `USE_S3_MODELS`, `CLOUDFRONT_*` | **使用しない**（WS-2/6） |

## 作業指示

### 共通制約

（計画書「共通制約」全文を遵守。古い DB 生徒 3 人移行禁止。）

### 手順

1. ブランチ `cursor/meta-tenant-ws5-auth-env-7179`。
2. env マッピング表: meta 変数名 → sim 変数名 / 「不要」/ 「WS-6」。
3. テナント `meta-server` は **ロビー経由入場**を推奨とする運用メモ（ローカル teacher login は空 DB のためスコープ外でも可）。
4. コード変更は「ゲスト入場」「chat moderation が meta-server テナントで動く」に足りない場合のみ。
5. 単体テスト追加。
6. **デプロイなし**。

### 完了条件

- PR（ドキュメント + 必要最小コード）
- マッピング表に秘密値なし