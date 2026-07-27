# IT Info Hub — 仕様書

- **バージョン**: 2.0（2026-07-05 全面アップデート）
- **リポジトリ**: https://github.com/tomoya0323/IT-News
- **ライセンス**: MIT

> v1.0 で挙げた「重要な問題」7件はすべて解決済み、「拡張案」A/B/C 全14件は実装済み。
> 経緯は本書末尾の「v1.0 からの変更点」を参照。

---

## 1. 概要

IT 技術ニュースを 9 ソースから毎日自動収集し、記事本文を取得したうえで **Gemini 2.5 Flash-Lite** により要約・翻訳・タグ付け・カテゴリ分類・重要度スコアリングを行い、静的サイト（PWA）として GitHub Pages 上で閲覧できるシステム。高スコア記事は Discord / Slack / LINE に自動通知され、収集結果は RSS フィードとしても配信される。毎週日曜には 1 週間の総括（週間ダイジェスト）を AI 生成する。

サーバーレス構成であり、実行基盤は GitHub Actions、配信は GitHub Pages のみで完結する。データベースは持たず、JSON ファイルを Git リポジトリにコミットすることで永続化する。

## 2. システム構成

```
┌──────────────────────────────────────────────────────────────┐
│ GitHub Actions (.github/workflows/update.yml)                 │
│   毎日 UTC 22:00（JST 07:00）+ workflow_dispatch              │
│                                                               │
│  gather.py                                                    │
│   1. 収集       Hacker News API + RSS×8                       │
│   2. 重複除去   URL正規化                                      │
│   3. 本文取得   並列8ワーカーで記事HTMLを取得しテキスト抽出      │
│   4. AI解析     Gemini バッチ解析（6記事/リクエスト）            │
│                 要約・翻訳・タグ・カテゴリ・スコア               │
│   5. HOT検知    複数ソース出現で +20                            │
│   6. 関連記事   埋め込みベクトルで同一話題をグルーピング          │
│   7. 保存       data.json / archive/ / feed.xml               │
│                 （180日超のアーカイブは自動削除）                │
│   8. 週間ダイジェスト（日曜のみ）→ digest.json                  │
│   9. 通知       Discord / Slack / LINE（score >= 80）          │
│                                                               │
│  → git commit & push（github-actions[bot]）                   │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ GitHub Pages（静的配信）                                       │
│  index.html（SPA / PWA） + sw.js + manifest.json + feed.xml   │
│  fetch: data.json / digest.json / archive/*.json              │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
              ブラウザ（PWA） / RSSリーダー
```

## 3. ファイル構成

| パス | 役割 |
|---|---|
| `gather.py` | バックエンド一式（収集・本文取得・解析・グルーピング・保存・通知） |
| `index.html` | フロントエンド SPA（HTML/CSS/JS 単一ファイル、フレームワークなし） |
| `sw.js` | Service Worker（HTML/JSON は Network First、静的アセットは Cache First） |
| `manifest.json` | PWA マニフェスト |
| `requirements.txt` | Python 依存（feedparser, requests） |
| `data.json` | 最新の収集結果（自動生成・コミット、スキーマ v2） |
| `feed.xml` | RSS 2.0 フィード（スコア上位20件、自動生成） |
| `digest.json` | 週間ダイジェスト（毎週日曜に自動生成） |
| `archive/YYYY-MM-DD.json` | 日次アーカイブ（自動生成、180日で自動削除） |
| `archive/index.json` | アーカイブファイル名一覧（降順） |
| `models.json` | Gemini の利用可能モデル一覧スナップショット（CI で取得） |
| `.github/workflows/update.yml` | 定期実行ワークフロー |
| `docs/SPEC.md` | 本仕様書 |

## 4. バックエンド仕様（gather.py）

### 4.1 データソース

| ソース | 取得方法 | 件数 |
|---|---|---|
| Hacker News | Firebase API（topstories → item） | 上位 8 件 |
| Zenn | `https://zenn.dev/feed` | 5 件 |
| Qiita | 人気記事 Atom フィード | 5 件 |
| Reddit | `r/technology` RSS | 5 件 |
| はてなブックマーク | ホットエントリー（IT）RSS | 5 件 |
| Publickey | `https://www.publickey1.jp/atom.xml` | 5 件 |
| Dev.to | `https://dev.to/feed` | 5 件 |
| GitHub Blog | `https://github.blog/feed/` | 5 件 |
| arXiv cs.AI | `https://rss.arxiv.org/rss/cs.AI` | 5 件（※土日は配信なし＝0件） |

- HTTP は共通で User-Agent `IT-Info-Collector/1.0 (GitHub Actions Bot)`、タイムアウト 15 秒。
- 取得失敗はソース単位でスキップ（他ソースには影響しない）。
- `published` は `feedparser` の `published_parsed` / `updated_parsed` から **ISO8601 (UTC) に正規化**。パース不能な場合のみ生文字列。

### 4.2 重複除去

`normalize_url()` で `scheme://netloc/path`（クエリ・フラグメント除去、小文字化、末尾 `/` 除去）に正規化し、最初に出現した記事を保持する。

### 4.3 記事本文の取得

- `ThreadPoolExecutor`（8 ワーカー）で全記事の URL を並列取得（タイムアウト 10 秒）。
- HTML から `<script>/<style>/<nav>` 等を除去し、`<p>` ブロックを優先して本文テキストを抽出（依存パッケージなしの簡易抽出）。先頭 1,500 文字を解析に使用。
- 取得失敗時はタイトルベース解析にフォールバック（処理は止まらない）。

### 4.4 Gemini バッチ解析

- **モデル**: `gemini-2.5-flash-lite`（REST API、`responseMimeType: application/json`、temperature 0.2）
- **6 記事を 1 リクエストにまとめて解析**。約 45 記事でもリクエスト数は 8 回程度となり、無料枠 15 RPM と衝突しない（v1.0 では 1 記事 1 リクエストでエラー率 54% に達していた）。
- 出力（記事ごと）: `id` / `title`（英語なら日本語訳）/ `summary`（3 行）/ `tags`（3 個）/ `category`（固定リストから 1 つ）/ `score`（0–100、クランプ済み）/ `score_reason`
- カテゴリ固定リスト: AI・機械学習 / Web・フロントエンド / バックエンド・インフラ / セキュリティ / プログラミング言語 / モバイル / ハードウェア・ガジェット / ビジネス・業界動向 / その他
- **解析状態は `analysis_status` フィールド**（`ok` / `error` / `skipped`）で管理（文字列マッチによる判定は廃止）。
- レート制限対策: リクエスト間 4 秒、429/5xx は指数バックオフ（上限 30 秒）で最大 3 回リトライ。
- 全体タイムアウト 480 秒。超過分は `analysis_status: "skipped"` で埋める。

### 4.5 HOT スコアリング

正規化 URL が複数ソースに出現した記事に `is_hot: true` を付与し、スコアに +20（上限 100）。

### 4.6 関連記事グルーピング

- `gemini-embedding-001`（`batchEmbedContents`、256 次元）でタイトル＋要約の埋め込みを一括取得し、コサイン類似度 ≥ 0.82 のペアを Union-Find でグループ化。
- グループ（2 件以上）に属する記事へ `topic_group`（int）と `topic_size` を付与。
- 埋め込み取得に失敗した場合はタイトルトークンの Jaccard 係数（≥ 0.5）にフォールバック。

### 4.7 出力スキーマ（v2）

`data.json` / `archive/YYYY-MM-DD.json`（同一内容、スコア降順ソート済み）:

```jsonc
{
  "schema_version": 2,
  "generated_at": "2026-07-05T07:58:33+09:00",
  "total_count": 45,
  "success_count": 43,
  "error_count": 2,            // analysis_status が error/skipped の合計
  "gemini_model": "gemini-2.5-flash-lite",
  "articles": [
    {
      "title": "…",             // 日本語化済みタイトル
      "url": "…",
      "source": "Hacker News",
      "published": "…",         // ISO8601 (UTC) に正規化済み
      "hn_score": 48,           // HN のみ
      "hn_comments": 4,         // HN のみ
      "summary": "1行目\n2行目\n3行目",
      "tags": ["AI", "LLM", "GPT"],
      "category": "AI・機械学習",
      "score": 85,              // 0-100
      "score_reason": "…",
      "analysis_status": "ok",  // ok | error | skipped
      "is_hot": false,
      "topic_group": 1,         // 関連記事グループID（グループ所属時のみ）
      "topic_size": 3           // グループ内の記事数（同上）
    }
  ]
}
```

フロントエンドは旧スキーマ（v1: `analysis_status`/`category` なし）のアーカイブも文字列マッチへのフォールバックで表示できる。

### 4.8 RSS フィード出力（feed.xml）

スコア上位 20 件を RSS 2.0 として出力。タイトル・リンク・要約（スコア付き）・pubDate を含み、全テキストは XML エスケープ済み。`index.html` の `<link rel="alternate">` からも参照される。

### 4.9 週間ダイジェスト（digest.json）

- **毎週日曜（JST）** に生成（ローカル検証用に `FORCE_DIGEST=1` で強制実行可）。
- 直近 7 日分のアーカイブ＋当日分をマージ・重複除去し、スコア 70 以上の上位 25 件を Gemini に渡して総括を生成。
- 出力: `overview`（3〜4 文の総括）/ `trends`（3〜5 個）/ `highlights`（5 件、選定理由付き）/ 期間・件数メタデータ。
- Discord にも同内容を embed 投稿。

### 4.10 通知（Discord / Slack / LINE）

score ≥ 80 の上位 10 件を対象に、設定済みのチャネルすべてへ送信:

| チャネル | 環境変数 | 形式 |
|---|---|---|
| Discord | `DISCORD_WEBHOOK_URL` | embeds（スコアで色分け: 90+ 赤 / 80+ 金） |
| Slack | `SLACK_WEBHOOK_URL` | Block Kit（mrkdwn セクション） |
| LINE | `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API broadcast（テキスト、上位 5 件）※LINE Notify は 2025 年 3 月終了のため Messaging API を使用 |

### 4.11 アーカイブローテーション

`archive/YYYY-MM-DD.json` のうち 180 日より古いものを毎回削除し、`index.json` を再生成する。

## 5. フロントエンド仕様（index.html）

依存フレームワークなしの Vanilla JS SPA。Google Fonts のみ外部依存。

### 5.1 セキュリティ（XSS 対策）

- 記事データ由来の全テキスト（タイトル・要約・タグ・カテゴリ・スコア理由・ソース名）は `esc()` で HTML エスケープしてから挿入。
- URL は `safeUrl()` で `http(s)://` 以外を `#` に置換。
- イベントハンドラは URL 等を DOM 属性に埋め込まず、描画済み配列のインデックス（`data-idx`）参照で解決。
- 設定パネル・ダイジェスト・タブ等の動的 UI は `textContent` / `createElement` で構築。

### 5.2 機能一覧

| 機能 | 実装 |
|---|---|
| 記事カード | スコアバッジ、金/銀ボーダー、HOT・解析エラー・未解析・📌・🔗関連 バッジ、カテゴリ、3行要約、タグ、ソース、公開日、スコア理由 |
| ソースタブ | **データから動的生成**（件数順、件数バッジ付き）。ソース追加は gather.py の 1 行変更で反映 |
| 並び替え | スコア順 / 新着順（正規化済み published）/ ソース順 |
| カテゴリフィルタ | プルダウン（件数付き、データから動的生成） |
| テキスト検索 | タイトル・要約・タグの部分一致 |
| 全期間検索（🌐） | 全アーカイブを遅延読み込み・URL で重複除去してマージした横断データセットに切替 |
| タグ / 関連グループ絞り込み | クリックで絞り込み、ツールバーのチップから解除 |
| お気に入り | ★トグル + お気に入りのみ表示（フィルタ ON 時は日付をまたいで全アーカイブ横断のデータから表示） |
| 既読管理 | 記事リンククリックで既読記録（上限3,000件）、既読カードは淡色表示、「未読のみ」フィルタ |
| キーワード購読 | 設定パネルで最大20個登録。マッチ記事に 📌 バッジ＋右ボーダー、「📌 注目」フィルタ |
| トレンド統計 | 直近30日のアーカイブから ①日別記事数（折れ線）②頻出タグ TOP10（横棒）③ソース別平均スコア（横棒）を SVG 描画。ホバーツールチップ付き、ライト/ダーク両対応 |
| 週間ダイジェスト | digest.json（8日以内のもの）をバナー表示。総括・トレンドチップ・ハイライト5件 |
| 新着通知 | オプトイン（Notification API）。ページ表示時に未通知の高スコア記事（80+）をブラウザ通知 ※静的ホスティングのため Push サーバーは持たず、「開いた時に通知」方式 |
| 設定の書き出し/読み込み | お気に入り・キーワード・既読を Base64 コードでエクスポート/インポート（マージ方式） |
| テーマ | OS 連動 + 手動トグル、チャートも追随 |
| アーカイブ切替 | プルダウンで過去日データ読み込み（旧スキーマ互換） |

### 5.3 localStorage キー

| キー | 内容 |
|---|---|
| `itinfohub_favorites` | お気に入り URL の配列 |
| `itinfohub_theme` | `"light"` / `"dark"` |
| `itinfohub_read` | 既読 URL の配列（上限 3,000） |
| `itinfohub_keywords` | 購読キーワードの配列（上限 20） |
| `itinfohub_notify` | 通知オプトイン（bool） |
| `itinfohub_notified` | 通知済み URL の配列（上限 500） |

### 5.4 PWA / Service Worker

- キャッシュ名 `itinfohub-v3`。
- **HTML（ナビゲーション）・JSON・XML**: Network First — フロント更新・データ更新が即時反映され、オフライン時のみキャッシュを返す。
- その他静的アセット: Cache First。

## 6. CI/CD（.github/workflows/update.yml）

- トリガー: cron `0 22 * * *`（JST 07:00）+ `workflow_dispatch`
- `timeout-minutes: 12`、Python 3.12、pip キャッシュあり。
- 手順: checkout → `gather.py` 実行 → `models.json` 取得 → `data.json` / `archive/` / `models.json` / `feed.xml` /（存在すれば）`digest.json` を自動コミット & push → 失敗時 Discord アラート。
- Secrets: `GEMINI_API_KEY`（必須）, `DISCORD_WEBHOOK_URL` / `SLACK_WEBHOOK_URL` / `LINE_CHANNEL_ACCESS_TOKEN`（任意）

## 7. 残存する制約

1. **要約の正確性**: 本文抽出は簡易実装（`<p>` タグベース）のため、SPA サイトやペイウォール記事では本文が取れずタイトルベース解析になる。
2. **プッシュ通知**: 静的ホスティングのみで購読管理サーバーがないため、Web Push（閉じていても届く通知）は不可。「ページを開いた時に新着を通知」する方式で代替。
3. **全期間検索の転送量**: アーカイブ全件（100 ファイル超）を初回にダウンロードするため、モバイル回線では数 MB の転送が発生する。
4. **お気に入り同期**: 自動同期ではなく、コードの手動コピーによる移行方式。

---

# v1.0 からの変更点

## 解決した重要な問題（v1.0 §7）

| # | 問題 | 対応 |
|---|---|---|
| 1 | 解析エラー率 54%（レート制限との衝突） | ✅ バッチ解析（6記事/リクエスト）でリクエスト数を約 1/6 に削減 |
| 2 | XSS 耐性なし（innerHTML 無エスケープ挿入） | ✅ 全テキストのエスケープ + URL サニタイズ + インデックス参照ハンドラ |
| 3 | エラー判定が日本語文字列マッチ | ✅ `analysis_status` フィールドに統一（旧データはフォールバックで互換） |
| 4 | 要約が本文を見ていない | ✅ 並列本文取得 + 本文ベース解析 |
| 5 | アーカイブの無限増加 | ✅ 180日ローテーション |
| 6 | フロント更新の遅延（SW Cache First） | ✅ HTML/JSON/XML を Network First 化（キャッシュ v3） |
| 7 | published の形式不統一 | ✅ ISO8601 (UTC) に正規化（新着順ソートの基盤） |

## 実装した拡張案（v1.0 提案の A/B/C 全14件）

| # | 拡張 | 実装 |
|---|---|---|
| A-1 | 記事本文の取得と要約精度向上 | ✅ §4.3 |
| A-2 | ソース追加 | ✅ Publickey / Dev.to / GitHub Blog / arXiv cs.AI（＋HN を8件に増量） |
| A-3 | カテゴリ自動分類 | ✅ §4.4 + カテゴリフィルタ |
| A-4 | 週間ダイジェスト | ✅ §4.9 + フロントバナー |
| A-5 | セマンティック関連記事グルーピング | ✅ §4.6 + 🔗関連バッジ |
| B-1 | ソート切替 | ✅ スコア/新着/ソース順 |
| B-2 | 既読管理 | ✅ 既読淡色化 + 未読のみフィルタ |
| B-3 | キーワード購読 | ✅ 📌 ハイライト + 注目フィルタ |
| B-4 | トレンド統計ダッシュボード | ✅ SVG チャート3種（30日分） |
| B-5 | アーカイブ横断検索 | ✅ 🌐 全期間検索 |
| B-6 | 通知 | ✅ ローカル通知方式（制約は §7-2 参照） |
| C-1 | RSS フィード出力 | ✅ feed.xml |
| C-2 | Slack / LINE 通知 | ✅ Slack Webhook + LINE Messaging API |
| C-3 | お気に入りの同期 | ✅ 設定の書き出し/読み込み（Base64 コード） |
