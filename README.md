# 📡 IT Info Hub — AI技術ニュースダッシュボード

IT技術情報を 9 つの主要ソースから自動収集し、**Gemini 2.5 Flash-Lite** で本文解析・スコアリング・自動要約を行い、Notion風の PWA ダッシュボードで閲覧できるサーバーレスシステムです。

## ✨ 主な機能

### 収集・解析（バックエンド）
| 機能 | 説明 |
|------|------|
| **マルチソース収集** | Hacker News, Zenn, Qiita, Reddit, はてなブックマーク, Publickey, Dev.to, GitHub Blog, arXiv cs.AI |
| **本文ベースのAI解析** | 記事本文を取得し、Gemini 2.5 Flash-Lite で3行要約・タグ・カテゴリ・重要度スコア（0〜100）を生成 |
| **バッチ解析** | 6記事を1リクエストでバッチ処理し、APIレート制限（15 RPM）との衝突を回避 |
| **英語記事の日本語化** | 英語タイトル・要約を自動で自然な日本語に翻訳 |
| **HOT検知** | 複数ソースに出現する注目記事を自動検知しスコア加点（+20点） |
| **関連記事グルーピング** | 埋め込みベクトル（`gemini-embedding-001`）のコサイン類似度で同一話題の記事を自動グループ化 |
| **重複除去** | URL正規化で同一記事の重複を自動排除 |
| **自動テスト** | GitHub Actions 実行時に `pytest` によるユニットテストを自動稼働 |
| **週間ダイジェスト** | 毎週日曜に1週間の総括をAI生成（`digest.json` + Discord投稿） |
| **RSSフィード出力** | スコア上位20件を `feed.xml`（RSS 2.0）として自動配信 |
| **マルチ通知** | スコア80+の高重要度記事を Discord / Slack / LINE に自動投稿 |
| **アーカイブローテーション** | 180日を超えた古い日次アーカイブを自動削除 |

### 閲覧（フロントエンド PWA）
| 機能 | 説明 |
|------|------|
| **検索 & フィルタ** | テキスト検索、タグ・カテゴリ・ソース絞り込み、全アーカイブ横断検索（🌐） |
| **並び替え** | スコア順 / 新着順 / ソース順 |
| **お気に入り・既読管理** | ★登録、既読記事の自動淡色表示、未読のみフィルタ |
| **キーワード購読** | 登録キーワードにマッチする記事を 📌 でハイライト・絞り込み |
| **トレンド統計** | 直近30日の記事数推移・頻出タグTOP10・ソース別平均スコアを SVG チャート表示 |
| **週間ダイジェスト表示** | AIが生成した週次総括をフロントエンドバナー表示 |
| **新着通知** | ページ表示時に未通知の高スコア記事をブラウザ通知（オプトイン） |
| **設定の書き出し/読み込み** | お気に入り・キーワード・既読設定を Base64 コードで他ブラウザへ移行 |
| **ダークモード** | OS設定連動 ＋ 手動トグル切り替え |
| **アーカイブ** | 過去データをプルダウンで切替閲覧 |
| **PWA対応** | Service Worker（Network First）によるオフライン閲覧・アプリ利用対応 |

## 🚀 セットアップ & デプロイ

### 1. リポジトリ作成 & プッシュ
```bash
git init
git add .
git commit -m "feat: 初期構築"
git remote add origin https://github.com/tomoya0323/IT-News.git
git push -u origin main
```

### 2. GitHub Secrets 設定
リポジトリの **Settings → Secrets and variables → Actions** で以下を設定します:

| Secret名 | 必須 | 説明 |
|-----------|------|------|
| `GEMINI_API_KEY` | ✅ | Google AI Studio で取得した Gemini API キー |
| `DISCORD_WEBHOOK_URL` | — | Discord チャンネルの Webhook URL（高スコア通知・失敗時アラート用） |
| `SLACK_WEBHOOK_URL` | — | Slack Incoming Webhook URL |
| `LINE_CHANNEL_ACCESS_TOKEN` | — | LINE Messaging API のチャネルアクセストークン（broadcast 送信） |

### 3. GitHub Pages 有効化
リポジトリの **Settings → Pages → Build and deployment → Source** で **GitHub Actions** を選択。
`update.yml` ワークフローにより、自動的にデプロイが行われます。

### 4. ローカル実行・テスト
```bash
# 依存ライブラリのインストール
pip install -r requirements.txt

# ユニットテストの実行
pytest test_gather.py

# データ収集 & 解析の実行
export GEMINI_API_KEY="your-api-key"
python gather.py                 # FORCE_DIGEST=1 を付けると週間ダイジェストも強制生成

# ローカルWebサーバーでフロントエンド動作確認
python -m http.server 8000
# http://localhost:8000 で確認
```

## 📁 ファイル構成
```
├── gather.py                  # バックエンド（収集・本文取得・解析・グルーピング・保存・通知）
├── test_gather.py             # ユニットテスト（パース処理・レスポンス抽出の検証）
├── index.html                 # フロントエンド（PWA SPA、バニラJS）
├── manifest.json              # PWA マニフェスト
├── sw.js                      # Service Worker（キャッシュ・オフライン対応）
├── requirements.txt           # Python 依存パッケージ（feedparser, requests, pytest）
├── data.json                  # 最新の収集データ（自動生成・スコア降順）
├── feed.xml                   # RSS 2.0 フィード（スコア上位20件・自動生成）
├── digest.json                # 週間ダイジェスト（毎週日曜に自動生成）
├── models.json                # Gemini 利用可能モデル一覧スナップショット（自動取得）
├── archive/                   # 日付別アーカイブ（自動生成・180日保持）
│   ├── index.json             # アーカイブ一覧
│   └── YYYY-MM-DD.json
├── docs/
│   └── SPEC.md                # 詳細仕様書（v2.0）
├── .github/workflows/
│   └── update.yml             # GitHub Actions 定期実行 & Pages デプロイ
└── README.md                  # 本ファイル
```

## ⏰ 自動実行スケジュール
- **毎日 午前7時（JST / UTC 22:00）** に GitHub Actions が自動実行。
- 実行フロー:
  1. `pytest test_gather.py` でユニットテストを実行
  2. `gather.py` で 9 ソースから収集・Gemini バッチ解析・スコアリング
  3. 利用可能モデル一覧 (`models.json`) を取得
  4. 生成データ (`data.json`, `archive/`, `feed.xml` 等) を Git コミット & プッシュ
  5. GitHub Pages への自動デプロイ
  6. 実行失敗時は Discord Webhook へ失敗アラートを通知
- **毎週日曜** は週間ダイジェスト (`digest.json`) を自動生成し Discord へ投稿。
- **手動実行**: GitHub の Actions タブ → `IT Info Collector - 定期実行` → `Run workflow`

## 🌐 デプロイ互換性
- **GitHub Pages**: GitHub Actions 連携による即時自動デプロイ（推奨）
- **Vercel / Cloudflare Pages / Netlify**: リポジトリ連携で静的ホスティング可能（ビルドステップ不要）

## 📜 ライセンス
MIT

