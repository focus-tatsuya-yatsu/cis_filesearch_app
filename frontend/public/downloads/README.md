# CIS File Handler インストーラー配布ディレクトリ

このディレクトリには、NASファイル直接オープン機能のインストーラーパッケージを配置します。

## ファイル構成

```
downloads/
├── README.md                      # このファイル
└── CIS-FileHandler-Setup.zip      # インストーラーパッケージ（要作成）
```

## ZIPパッケージの作成方法

### 方法1: スクリプトを使用（推奨）

```bash
# プロジェクトルートで実行
npm run build:installer

# または直接スクリプトを実行
./scripts/build-installer.sh
```

### 方法2: 手動作成

1. `scripts/cis-file-handler/` ディレクトリ内のファイルを選択:
   - `インストール.bat`
   - `アンインストール.bat`
   - `setup.ps1`
   - `cis-open-handler.bat`
   - `README.md`

2. これらのファイルをZIP圧縮して `CIS-FileHandler-Setup.zip` として保存

3. このディレクトリ (`frontend/public/downloads/`) に配置

## 配布URL

ビルド後、以下のURLでダウンロード可能になります:

- 開発: `http://localhost:3000/downloads/CIS-FileHandler-Setup.zip`
- 本番: `https://[your-domain]/downloads/CIS-FileHandler-Setup.zip`

## 注意事項

- ZIPファイルはgitで管理しません（.gitignore）
- 本番デプロイ時は、ビルドスクリプトで自動生成されます
- 手動でZIPを作成する場合は、文字エンコーディングをUTF-8で保存してください
