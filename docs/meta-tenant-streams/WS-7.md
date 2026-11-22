# WS-7: meta-server 固有機能の sim 化（不足分の新規実装）

## 目的

P-01 に無く meta-server にだけある機能のうち、**ワールド・アドオンで実際に使われているもの**を sim プラグインまたはテナント機能として実装する。使われていないものは「対象外」と文書化する。

## 担当 ToDo

T18–T23, T28, T21, T22

## 実測リスト（meta-server）

| 機能 | 実測 | 方針 |
|------|------|------|
| admin-reboot | addon_enabled=1 | sim に plugin 新規 or time-machine 連携で代替検討 |
| nfc-spawn | addon_enabled=1 | sim プラグイン新規（`tenants/.../data/nfc-instances` 参照あり） |
| qr-ar | ディレクトリ存在 | ワールド未参照なら Phase 2 |
| avator-scalable-animations | meta のみ | registry + clip 名で代替可能か調査 |
| instance / pre_xr | `/instance`, `/pre_xr` ルート | sim テナント URL で要否判断 |
| host-monitor | `/host-monitor` | 運用専用なら対象外 |
| Google Speech/Translate | package 依存 | チャット/字幕未使用なら **不要** |
| DB admin explorer | `/admin/database/*` | プラットフォーム admin に含めるか分割 |

## 所有範囲

- `addons/nfc-spawn/**`（新規、必要時）
- `addons/admin-reboot/**`（新規、必要時）
- `lib/**`（該当ルートのみ）
- `test/*`（該当）
- 計画書の「対象外」更新

**衝突回避:** WS-4 が触る `aircraft` / `xr` は本 WS では読むだけ

## 依存

- WS-4 のプラグイン一覧確定
- WS-1 の worlds（nfc 参照の有無を grep）

## 作業指示

### 共通制約

（計画書「共通制約」全文を遵守。）

### 手順

1. ブランチ `cursor/meta-tenant-ws7-native-7179`（機能ごとに PR 分割推奨）。
2. `/server_src/data/worlds.json` と `nfc-instances` を読み取り、必須機能を確定。
3. 必須のみ実装；任意は `docs/meta-server-tenant-migration-plan.md` に Phase 2 として記載。
4. 各機能: `plugin.json` + sim ローダー + 単体テスト。
5. **マージ・デプロイ禁止**。

### 完了条件

- 1 PR 以上（分割可）+ tests
- 対象外一覧が計画書に反映（別コミット可、WS-8 前に main へ）