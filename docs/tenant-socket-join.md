# テナント Socket join シークレット（任意）

テナント別 Socket.io への接続を、共有シークレットまたはテナント単位のシークレットで制限できます。**未設定のときは従来どおり制限なし**（ゲスト入場・E2E・既存デプロイへの破壊的変更はありません）。

## 設定

| 方法 | 優先度 | 説明 |
|------|--------|------|
| `tenants/<id>/tenant.json` の `socketSecret` | 高 | そのテナントのみ |
| 環境変数 `TENANT_SOCKET_SECRET` | 低 | 全テナント共通（`socketSecret` 未設定の tenant に適用） |

例（テナント単位）:

```json
{
  "id": "P-01",
  "displayName": "Demo",
  "enabled": true,
  "socketSecret": "your-long-random-string"
}
```

例（プラットフォーム共通）:

```bash
TENANT_SOCKET_SECRET=your-long-random-string
```

管理パネルの環境変数 UI からも `TENANT_SOCKET_SECRET` を設定できます（`.env` 同名キーがある場合は `.env` が優先）。

## クライアント

ブラウザ（`tenant-socket-io-shim.js`）は次の順で join トークンを `handshake.auth.joinToken` に載せます。

1. 呼び出し側が `io(url, { auth: { joinToken } })` で明示指定
2. URL クエリ `?join=` または `?socketSecret=`（値は `sessionStorage` に保存され再接続でも再利用）
3. 上記以外 → シークレット未送信（サーバーでシークレット必須なら接続拒否）

ゲストプレイ: シークレットを知っているユーザーは通常どおり表示名を `Guest` にしたり任意名で入場できます。制限は「Socket に繋がれるか」だけです。

共有用 URL 例: `https://example.com/P-01/?join=your-long-random-string`

## 管理画面からの入場

管理パネル経由のメタバース入場ワンタイム `adminToken` は、join シークレットが有効でも **接続を許可** します（`peekAdminToken`）。運用者はシークレットを配布せずに入場できます。

## サーバー拒否時

ミドルウェアで不一致の場合、Socket.io は `connect_error`（メッセージ `socket_join_forbidden`）で切断されます。

## E2E / 自動テスト

`TENANT_SOCKET_SECRET` を有効にした環境で Playwright や Node クライアントを使う場合:

- 環境変数 `E2E_TENANT_SOCKET_JOIN` に同じ値を渡す、または
- `e2e/helpers/tenant-socket.mjs` は `TENANT_SOCKET_SECRET` を自動で auth に載せます
