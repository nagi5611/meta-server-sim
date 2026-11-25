# Handoff: アドオン管理（マルチテナント・メタバース管理パネル）

## Overview

「みんなでメタ」のテナント管理コンソールに **アドオン管理** 画面を追加した設計です。

管理者がメタバースサーバー（＝テナント）ごとに各種アドオン（機能拡張）の **有効 / 無効** を切り替えます。有効化したアドオンはそのサーバー配下の全ワールドに反映され、依存関係（例：ワールド間ポータルはアバター同期が必要）を満たさない場合は有効化できません。

- 対象: 管理者（全体管理者 / テナント管理者）
- 単位: **メタバースサーバー（テナント）ごと**。同一アドオンでもサーバーごとに独立した状態を持つ
- 既存ナビゲーション「ダッシュボード / ステータス / 通信ログ / ワールド編集」と並列に「アドオン管理」を追加

## About the Design Files

このバンドル内の HTML / CSS / JS は **HTML で作られたデザインリファレンス（プロトタイプ）** です。見た目と挙動の意図を示すものであり、プロダクションコードとしてそのままコピーするものではありません。

作業内容は、**これらのデザインを対象コードベースの既存環境（React / Vue / SwiftUI / Flutter / ネイティブ等）で、その慣習・ライブラリ・コンポーネントを使って再実装すること** です。既存の環境が無い場合は、プロジェクトに最適なフレームワークを選んで実装してください。

プロトタイプは素の JS（IIFE + テンプレート文字列）で描画しており、状態は `window.MT.state` に集約しています。実装時はこれを各フレームワークの状態管理に置き換えてください。

## Fidelity

**High-fidelity（hifi）**。最終的な色・タイポグラフィ・余白・インタラクションまで確定しています。既存コードベースのライブラリとパターンを用いて、**ピクセル単位で再現** してください。

数値はすべて実測ベースです。下記「Design Tokens」「Screens / Views」の値が仕様の正です。

---

## Screens / Views

### 1. ログインゲート（既存画面・変更なし）

- **Purpose**: 管理者認証。プロトタイプでは `admin / admin1234` で通過（実装時は既存の認証基盤に接続）
- **Layout**: 全画面 `min-height:100dvh` 中央寄せ。フォーム幅 `min(348px, 100%)`
- 認証後は左サイドバー + メインのシェルへ遷移

### 2. シェル（サイドバー / トップバー）

**サイドバー** 幅 `248px`（CSS 変数 `--side-w`）、白背景 `#fff`、右に `1px solid #e2e5ea`、`position: sticky; top: 0; height: 100dvh`、`padding: 14px 10px 10px`。

上から順に:

| 要素 | 仕様 |
|---|---|
| ブランド | ロゴ 26×26 円形（`assets/icon-192.png`）+ 「みんなでメタ」13px/700 + 「CONSOLE」10.5px uppercase 字間 .04em 色 `#8a92a1`。下余白 14px |
| テナント切替ボタン | 幅 100%、`padding:8px 9px`、`border:1px solid #c9ced6`、`border-radius:7px`。左に 26×26 角丸5px の墨ベタ（`#101624`）に組織名の頭文字を白 11px/700。右に 12px chevron（`#8a92a1`） |
| ナビ「ダッシュボード」 | 単独グループ |
| グループラベル「テナント」 | 10px/700 字間 .09em 色 `#a4abb8`、`padding:12px 9px 5px`、右端に現在テナント名（10px / 500 / `#b6bcc7`） |
| テナント配下ナビ | **ステータス / 通信ログ / ワールド編集 / アドオン管理** の4項目（この順） |
| グループラベル「管理」 | 上と同じ体裁 |
| 管理ナビ | 監査ログ・権限 |
| フッター | 24px 円形アバター「N」+ `nagi` 12px/700 + `全体管理者` 10.5px + 右に「ログアウト」11px |

ナビ項目の仕様: 幅 100%、`padding:7px 9px`、`border-radius:6px`、`gap:9px`、12.5px/600、色 `#5e6778`、アイコン 15×15（stroke 1.7、opacity .8）。
- hover: 背景 `#f8f9fb`、文字 `#101624`
- **active（現在地）**: 背景 `#fdf0e3`（= `rgba(243,128,32,.1)` を白に合成した近似。実装では `var(--color-primary-soft)`）、文字 `#d96a0c`
- テナント未選択時は `opacity: .45` でゴースト表示

「アドオン管理」のアイコンは **3つの角丸四角（2×2 グリッドの3つ）+ 右上に＋** の線画。SVG パス（24×24 viewBox, `fill:none`, `stroke:currentColor`, `stroke-width:1.7`, `stroke-linecap/linejoin:round`）:

```
<rect x="3.5" y="3.5" width="7" height="7" rx="1.3"/>
<rect x="3.5" y="13.5" width="7" height="7" rx="1.3"/>
<rect x="13.5" y="13.5" width="7" height="7" rx="1.3"/>
<path d="M17 4v6.4M13.8 7.2h6.4"/>
```

**トップバー** 高さ `52px`、背景 `rgba(245,246,248,.92)` + `backdrop-filter: blur(8px)`、下に `1px solid #e2e5ea`、`padding: 0 28px`、`position: sticky; top:0; z-index:30`。
左から: パンくず（`管理 / 全テナント / みんなでメタ / アドオン管理`、12px、区切り `#c4cad4`、末尾のみ 600/`#101624`）→ 縦罫 1×16px → 稼働ピル（高さ 24px、`border-radius:13px`、白抜き 11.5px/600、先頭に 6px ドット `#1f9d55` が 2.4s で明滅）→ 右端に「参加者ページ」リンク。

### 3. アドオン管理（メイン画面・本設計の中心）

**ページコンテナ**: `max-width: 1180px`、`padding: 26px 28px 80px`（`<=900px` で `20px 16px 64px`）。

#### 3-1. ヘッダー

- キッカー `アドオン · 松山南高校`（11px/600, 字間 .05em, 色 `#8a92a1`, 下余白 5px）
- `h1` **アドオン管理** — 23px / 700 / `letter-spacing:-.018em` / `line-height:1.25` / `#101624`
- サブ `メタバースサーバー <b>みんなでメタ</b> に導入するアドオンを選びます。有効にした機能は、そのサーバーの全ワールドに反映されます。` — 12.5px / `#5e6778` / 上余白 5px。サーバー名のみ 600 / `#101624`
- 右アクション（`gap:8px`）:
  - 「構成を書き出す」`btn btn-line btn-sm`（白背景 / 枠 `#c9ced6` / 12px dl アイコン）
  - 「アドオンを追加」`btn btn-primary btn-sm`（背景 `#f38020` / 白 / 12px + アイコン）
- ヘッダー下余白 20px

> 注: 画面遷移でサーバーを切り替える UI（サーバーカードのストリップ）とサマリ4項目は、レビューで **不要として削除済み**。サーバー切替はサイドバーのテナント切替のみ。

#### 3-2. 絞り込みバー

`display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:0 0 16px`。

- **カテゴリセグメント**（`.seg`）: 背景 `#eceef2`、`padding:2px`、`border-radius:7px`、`gap:2px`
  - ボタン高さ 26px、`padding:0 9px`、`border-radius:5px`、11.5px/600、色 `#5e6778`
  - 選択時: 白背景 + `box-shadow:0 1px 1px rgba(16,22,36,.08)` + 文字 `#101624`
  - ラベル: `すべて` / `ワールド拡張` / `コミュニケーション` / `アクセスと安全` / `分析・運用` / `イベント`
- **状態セグメント**（同スタイル、左に 8px 追加マージン）: `全件` / `有効` / `無効`
- **検索**（右端、`margin-left:auto`）: 幅 240px、高さ 30px、`border-radius:6px`、枠 `#c9ced6`、左に 13×13 虫めがね（`#8a92a1`、`padding-left:28px`）、placeholder `アドオン名・提供元で検索`、12.5px

#### 3-3. カテゴリ見出し

`display:flex; align-items:baseline; gap:8px; margin-bottom:7px; white-space:nowrap`。

- カテゴリ名 13px/700 `#101624`
- 英語ラベル（`WORLD` / `COMM` / `GUARD` / `INSIGHT` / `EVENT`）— 9.5px mono、字間 .1em、色 `#b6bcc7`
- 右端 `4 / 4 有効` — 11px、現在数は 700 `#5e6778`、分母 `#8a92a1`

カテゴリブロックの下余白 20px。各行は白カード（`.sheet`: `border:1px solid #e2e5ea; border-radius:8px; background:#fff`）内に並び、行間は `1px solid #e2e5ea`。

#### 3-4. アドオン行（最重要コンポーネント）

グリッド: `grid-template-columns: 104px 30px minmax(0,1fr) auto 26px; gap: 0 12px; padding: 11px 14px; align-items:center`。

| # | 要素 | 仕様 |
|---|---|---|
| 1 | **有効/無効トグル** | 幅104pxの列。`display:inline-flex; gap:8px; height:22px`。スイッチ本体 34×18px `border-radius:9px`、ノブ 14×14px 白（`top/left:2px`）+ `box-shadow:0 1px 2px rgba(16,22,36,.28)`。トラックOFF `#dfe3e9` / ON `#f38020`。ノブ移動 `translateX(16px)`。ラベル「有効」（ON時 700 `#d96a0c`）/「無効」（700 `#8a92a1`）、10.5px。遷移 `.16s cubic-bezier(.2,.8,.2,1)`。hover: トラック `#cdd3dc`（ON時 `#d96a0c`）。disabled: `opacity:.4; cursor:not-allowed` |
| 2 | **アイコン** | 30×30px、`border-radius:6px`、枠 `#e2e5ea`。OFF: 背景 `#f8f9fb` / 線 `#5e6778`、`opacity:.45`。ON: 背景 `rgba(243,128,32,.1)` / 枠 `rgba(243,128,32,.35)` / 線 `#d96a0c`。中身 15×15 線画アイコン |
| 3 | **名前 + 説明**（クリックで詳細展開） | 名前 12.5px/600 `#101624`、`gap:6px` でバッジ並置。説明 11px `#8a92a1`、1行でクランプ（`-webkit-line-clamp:1`）。OFF時: 名前 `#5e6778` / 説明 `#a3aab6`。hover時: 名前 `#d96a0c` |
| 4 | **メタ** | `3 ワールド` `840 回/分` を `gap:12px` で横並び、10.5px、数値のみ 600 `#5e6778`、他 `#8a92a1`、tabular-nums。`<=760px` で非表示 |
| 5 | **シェブロン** | 22×22、`border-radius:4px`、色 `#b6bcc7`、13×13。hover: 背景 `#eceef2` / 色 `#101624`。展開時 `rotate(180deg)` |

行 hover: 背景 `#f8f9fb`。

**バッジ**
- 「更新あり」— 9.5px/700、`line-height:15px`、`padding:0 5px`、`border-radius:3px`、背景 `#fff7ed`、枠 `1px solid #fbc998`、文字 `#9a4a07`
- 「◯◯ が必要」— 同サイズ、背景 `#eceef2`、文字 `#5e6778`、枠なし

**詳細パネル**（シェブロンで開閉、行の直下に全幅で挿入）
- `grid-column: 1 / -1; margin-top:10px; padding:12px 14px`
- `display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:14px 26px`
- 背景 `#f8f9fb`、枠 `1px solid #e2e5ea`、`border-radius:6px`
- 出現アニメ `0.16s`：`opacity 0→1` + `translateY(-3px)→0`
- 6セル（順序固定）:
  1. **バージョン** — `4.2.0`（mono 11px）。更新がある場合 `tag warn`「最新 3.4.1」を併記
  2. **提供** — `公式` / `コミュニティ`
  3. **最終変更** — `11/20 10:12 ・ haru`
  4. **権限** — `voice:join` `rtc:signal` を `tag`（10.5px/600, line-height 17px, padding 0 5px, `border-radius:4px`, 背景 `#eceef2`, 色 `#5e6778`）で並べる
  5. **依存** — OK: 背景 `#f0f8f3` / 文字 `#166534`、不足: 背景 `#fdf2f2` / 文字 `#c62828`。`border-radius:4px; padding:0 6px; white-space:nowrap`
  6. **適用中のワールド** — `tag primary`（背景 `rgba(243,128,32,.1)`, 文字 `#d96a0c`）。無効時は `未適用（無効）` を `#8a92a1` で
- 各セルのラベルは 9.5px/700、字間 .06em、uppercase、`#a4abb8`、下余白 3px。値は 11.5px、`line-height:1.7`、`#101624`

#### 3-5. フッター

`margin-top:12px; padding:10px 14px; border:1px solid #e2e5ea; border-radius:8px; background:#fff`、`display:flex; gap:16px; font-size:10.5px; color:#8a92a1`、各項目 `white-space:nowrap`。

内容: `変更はすぐに反映され、監査ログに記録されます` ／ `sp`（flex:1）／ `サーバー みんなでメタ` ／ `最終更新 11/25 19:10`。強調は 600 / `#5e6778`。

#### 3-6. 空状態

絞り込みで0件のとき: 白カード内に `padding:34px 14px; text-align:center; color:#8a92a1; font-size:12.5px` で `条件に一致するアドオンはありません`。

---

## Interactions & Behavior

### 有効化 / 無効化（トグル）

**OFF → ON**
1. 依存アドオンがすべて ON か検証。不足があれば **何もしない**（スイッチは disabled で押せない設計。programmatic 呼び出し時はトーストで通知）
2. サーバーが `offline` の場合、有効化できない → トースト `停止中のサーバーではアドオンを有効にできません`
3. `on = true`、`updated = "たった今"`、`by = 現在のユーザー`
4. トースト `◯◯ を有効にしました（みんなでメタ）`
5. 一覧を再描画（カテゴリ見出しの「n / m 有効」が即時更新）

**ON → OFF**
1. `on = false` に更新
2. **このアドオンに依存している ON のアドオンを連鎖的に OFF**（再帰的に1段ずつ。実装は全アドオンの `dep` を走査して1パス）
3. トースト:
   - 依存あり: `◯◯ を無効化しました。依存する N 件も停止しました`
   - 依存なし: `◯◯ を無効にしました（みんなでメタ）`
4. 再描画。連鎖停止された側のトグルは disabled になり「◯◯ が必要」バッジ表示

**disabled の条件**: `on === false` かつ `dep` のいずれかが OFF。

### 依存関係（シードデータ）

```
世界間ポータル  ← アバター同期
空間ボイス      ← アバター同期
Discord 連携    ← テキストチャット
自動翻訳        ← テキストチャット
発言モデレーション ← テキストチャット
混雑ヒートマップ ← 行動ログ収集
ステージ配信    ← 空間ボイス
```

### 絞り込み

- カテゴリ: 完全一致でフィルタ。`all` は全件
- 状態: `on` / `off` / `all`
- 検索: `name + desc + vendor` の小文字部分一致。入力中は再描画後に **フォーカスとキャレット位置を復元**
- いずれも AND 条件。0件時は空状態

### 詳細展開

- 同時に1件のみ開ける（`openId` 単一値。同じ行を再度押すと閉じる）
- シェブロンと名前ブロックの両方がトリガー

### トランジション

| 対象 | 時間 / イージング |
|---|---|
| トグル トラック色 | `.16s` |
| トグル ノブ移動 | `.16s cubic-bezier(.2,.8,.2,1)` |
| シェブロン回転 | `.14s cubic-bezier(.2,.8,.2,1)` |
| 行 hover 背景 | `.12s` |
| 詳細パネル出現 | `.16s cubic-bezier(.2,.8,.2,1)` |

### トースト

画面下部中央（`bottom:22px`）、背景 `#101624`、白、12.5px、`padding:8px 14px`、`border-radius:6px`。`opacity 0→1` + `translate(-50%, 6px)→translate(-50%, 0)`、`.2s`。2200ms 後に自動で消える。

### レスポンシブ

- `<=1080px`: 詳細パネルを 2 カラムに
- `<=900px`: サイドバーが上部の横スクロールバーに変化（`height:auto; flex-direction:row`）、ブランド名とグループラベルを非表示
- `<=760px`: 行グリッドを `66px 26px minmax(0,1fr) 24px` に（メタ列を削除）、詳細パネルを 1 カラム、検索を全幅に
- `<=640px`: ヘッダーを縦積み、`padding:16px 12px 56px`

---

## State Management

```ts
// 画面ローカル
type AddonFilter = { cat: string | "all"; state: "all" | "on" | "off"; q: string };
type AddonUI = { openId: string | null; filter: AddonFilter };

// サーバー（テナント）ごとの導入状態 — サーバーID をキーに保持
type AddonInstall = {
  installs: Record<string /* addonId */, {
    on: boolean;
    worlds: string[];      // 適用先ワールドID
    ver: string;           // 導入済みバージョン
    calls: number;         // 呼び出し回数/分
    lat: number;           // ms
    errs: number;
    updated: string;
    by: string;
  }>;
};
type AddonState = Record<string /* tenantId */, AddonInstall["installs"]>;
```

- 状態は **テナント単位で独立**。切替時に再計算せず、テナントごとのマップをそのまま参照
- 初期値はシード（下記「シードデータ」）から決定論的に生成。リロードで同一状態に戻る
- 永続化する場合: `PUT /tenants/:tenantId/addons/:addonId` に `{ enabled: boolean }`、監査ログへ記録（`addon.enable` / `addon.disable` アクション）
- 実装時はサーバー応答を楽観更新し、失敗時にロールバック + エラートーストにするのが望ましい

### データ取得要件

- アドオンカタログ（16件、全テナント共通）
- テナントごとの導入状態（`on`, `worlds`, `ver`, `calls`, `lat`, `errs`, `updated`, `by`）
- テナント一覧（切替用）、テナントの稼働状態（`offline` 判定）

---

## シードデータ（アドオンカタログ）

| id | 名前 | カテゴリ | 提供 | ver | 依存 | 権限 |
|---|---|---|---|---|---|---|
| avatar-sync | アバター同期 | world | 公式 | 3.4.1 | — | avatar:sync, presence:read |
| gltf-import | GLTF インポータ | world | 公式 | 2.1.0 | — | asset:write |
| portal-link | ワールド間ポータル | world | 公式 | 1.8.3 | avatar-sync | world:write, session:transfer |
| board-notice | ワールド内掲示板 | world | 公式 | 2.0.4 | — | board:write |
| voice-spatial | 空間ボイス | comm | 公式 | 4.2.0 | avatar-sync | voice:join, rtc:signal |
| chat-text | テキストチャット | comm | 公式 | 1.6.2 | — | chat:write, chat:moderate |
| discord-bridge | Discord 連携 | comm | コミュニティ | 0.9.7 | chat-text | webhook:post, chat:read |
| translate-auto | 自動翻訳 | comm | コミュニティ | 1.2.5 | chat-text | text:translate |
| access-gate | 入室ゲート | guard | 公式 | 3.0.2 | — | session:gate |
| sso-google | Google Workspace SSO | guard | 公式 | 2.3.0 | — | auth:sso, member:read |
| moderation | 発言モデレーション | guard | 公式 | 1.4.0 | chat-text | chat:read, member:mute |
| anti-grief | 荒らし対策 | guard | コミュニティ | 0.8.1 | — | object:watch, member:limit |
| analytics | 行動ログ収集 | insight | 公式 | 2.7.1 | — | telemetry:read |
| heatmap | 混雑ヒートマップ | insight | 公式 | 1.1.0 | analytics | telemetry:read |
| stage-stream | ステージ配信 | event | 公式 | 3.1.4 | voice-spatial | rtc:publish |
| scheduler | イベントスケジューラ | event | コミュニティ | 1.0.0 | — | world:state |

**カテゴリ表示名**: world=ワールド拡張/WORLD、comm=コミュニケーション/COMM、guard=アクセスと安全/GUARD、insight=分析・運用/INSIGHT、event=イベント/EVENT。

**説明文**（`mt-data.js` の `ADDONS[].desc` に全文あり。そのまま使用）。

---

## Design Tokens

### Colors

```css
--color-primary:        #f38020;
--color-primary-dark:   #d96a0c;
--color-primary-soft:   rgba(243,128,32,.1);
--color-primary-line:   rgba(243,128,32,.35);

--color-bg:             #f5f6f8;
--color-surface:        #fff;
--color-surface-muted:  #f8f9fb;
--color-border:         #e2e5ea;
--color-border-strong:  #c9ced6;
--color-track:          #eceef2;
--color-heading:        #101624;
--color-text:           #1d2433;
--color-text-muted:     #5e6778;
--color-text-faint:     #8a92a1;

/* semantic */
--color-warn-bg:   #fff7ed;
--color-warn-line: #fbc998;
--color-warn-ink:  #9a4a07;
--ok:              #1f9d55;
--ok-soft:         #f0f8f3;
--danger:          #c62828;
--danger-soft:     #fdf2f2;
```

トグルOFFのトラックのみ `#dfe3e9`（hover `#cdd3dc`）。

### Typography

- ファミリー: `'Inter','Noto Sans JP','Hiragino Sans','Hiragino Kaku Gothic ProN',sans-serif`
- mono: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`
- `font-feature-settings: "palt" 1`（本文）、数値は `tabular-nums`
- スケール（この画面で使用）:

| 用途 | size / weight / line-height |
|---|---|
| ページ見出し | 23 / 700 / 1.25 / `-.018em` |
| カテゴリ見出し | 13 / 700 |
| アドオン名 | 12.5 / 600 / 1.4 |
| 本文・サブ | 12.5 / 400 / 1.6 |
| 説明 | 11 / 400 / 1.5 |
| メタ・フッター | 10.5 |
| バッジ | 9.5 / 700 |
| 英語ラベル | 9.5 mono / 字間 .1em |
| ボタン | 12.5（`btn-sm`）/ 600 |

### Spacing

`4 / 8 / 10 / 12 / 14 / 16 / 20 / 26 / 28` px を使用。行 `padding: 11px 14px`、カテゴリ間 `20px`、ヘッダー下 `20px`、ページ `26px 28px 80px`。

### Radius / Shadow

```
--r: 8px（カード）
ボタン/入力: 6px   セグメント: 7px（内側ボタン 5px）
タグ: 4px   バッジ: 3px   トグル: 9px（ノブ円形）
詳細パネル: 6px   アイコン容器: 6px
shadow（セグメント選択）: 0 1px 1px rgba(16,22,36,.08)
shadow（トグルノブ）    : 0 1px 2px rgba(16,22,36,.28)
```
影はほぼ使わない。区切りは 1px 罫線で表現するのがこのプロダクトの視覚言語。

---

## Assets

- `assets/icon-192.png` — 「みんなでメタ」ロゴ（円形 26×26 で表示）
- アイコンはすべてインライン SVG 線画（24×24 viewBox、`fill:none`、`stroke:currentColor`、`stroke-width:1.7`、round cap/join）。`mt-ui.js` の `P` オブジェクトに全パス定義あり。アドオン用に追加したのは `modules`（ナビ用）, `chat`, `mic`, `chart`, `calendar`, `link`, `translate`
- 外部画像・フォントファイルは未使用（Google Fonts を CSS `@import` で読み込み）

---

## Files

| ファイル | 役割 |
|---|---|
| `index.html` | プロトタイプ本体。ログイン → シェル → 各画面。`MT_TWEAKS` の JSON ブロックを含む |
| `colors_and_type.css` | デザイントークン（色・タイポ・余白・easing） |
| `mt.css` | シェル / 各画面の共通スタイル |
| `mt-addons.css` | **アドオン管理画面のスタイル（本設計の中心）** |
| `mt-addons.js` | **アドオン管理ビュー + トグル／依存ロジック** |
| `mt-data.js` | モックデータ。`ADDONS` / `ADDON_CATS` / `addonsOf()` を参照 |
| `mt-app.js` | ルーティング、イベント委譲、トースト、ナビ定義 |
| `mt-ui.js` | `esc` / `icon()` / チャート等の描画ヘルパー、アイコンパス定義 |
| `mt-views.js` | ダッシュボード / ステータス / 通信ログ / 監査 / サーバー選択の各ビュー |
| `mt-editor.css` / `mt-editor.js` / `mt-editor-state.js` / `mt-world.js` | ワールド編集（Three.js）画面。アドオン管理とは独立 |
| `tweaks_panel.jsx` | プロトタイプ用の Tweaks パネル（実装不要） |
| `vendor/*` | Three.js と周辺（ワールド編集画面用） |

**実装時の参照順**: `colors_and_type.css` → `mt-addons.css` → `mt-addons.js`（構造とロジック）→ `mt-data.js`（データ形状）。シェルやナビは `mt.css` と `mt-app.js`。

## 実装チェックリスト

- [ ] ナビ「テナント」グループに ステータス / 通信ログ / ワールド編集 / **アドオン管理** をこの順で配置
- [ ] サーバー（テナント）切替でアドオンの状態が切り替わる
- [ ] トグルで有効/無効が即時反映され、カテゴリ見出しの「n / m 有効」も更新
- [ ] 依存不足のアドオンはトグルが disabled + 「◯◯ が必要」バッジ
- [ ] 親を無効化すると子も連鎖停止し、その旨をトーストで通知
- [ ] 停止中サーバーでは有効化できない
- [ ] カテゴリ / 有効・無効 / 検索の AND 絞り込み、0件時の空状態
- [ ] シェブロンで詳細（バージョン・提供・最終変更・権限・依存・適用ワールド）が1件だけ開く
- [ ] 768px 以下でメタ列が消え、詳細が1カラムになる
