# 管理サーバー（metaverse-simulation-manager）

シミュレーション本体のプロセス起動・停止・コンソールログ監視は、兄弟ディレクトリの **metaverse-simulation-manager** で行います。

```bash
cd ../metaverse-simulation-manager
cp .env.example .env
npm install
npm start
```

`http://127.0.0.1:3010` を開き、UI から起動コマンドを選んで本体を起動してください。Tenant 設定や環境変数は従来どおり本体の `/admin.html` です。

詳細: [`../metaverse-simulation-manager/README.md`](../metaverse-simulation-manager/README.md)
