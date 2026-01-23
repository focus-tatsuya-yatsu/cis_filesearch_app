# CIS File Handler - NAS ファイル直接オープン機能

CIS File Search アプリケーションから、NAS 上のファイルを直接開くためのツールです。

## バージョン

**v2.0** - セキュリティ強化版

## 簡単インストール（一般ユーザー向け）

### インストール方法

**`インストール.bat` をダブルクリックするだけ！**

```
1. このフォルダを開く
2. 「インストール.bat」をダブルクリック
3. 完了メッセージが表示されたら終了
4. ※このフォルダは削除しても大丈夫です（ローカルにコピーされます）
```

### アンインストール方法

**`アンインストール.bat` をダブルクリック**

または、Windowsの「アプリと機能」からは表示されませんので、
このバッチファイルを使用してください。

---

## 使い方

1. CIS File Search で検索を実行
2. 検索結果の右側にある **緑色のフォルダアイコン** をクリック
3. Windows Explorer でファイルが開きます

### ボタンの説明

| アイコン | 色 | 機能 |
|---------|-----|------|
| 👁️ 目 | 青 | プレビュー（ブラウザで表示）|
| 📂 フォルダ | 緑 | ファイルを開く（Explorer）|
| ⬇️ 矢印 | 青 | ダウンロード |

---

## 動作条件

- Windows 10 / Windows 11
- NAS（ts-server3/5/6/7）にネットワーク接続されていること
  - 社内ネットワーク または VPN接続が必要

---

## よくある質問

### Q: 在宅勤務でも使えますか？

**A: VPN接続していれば使えます。**

VPN未接続の場合は、「ダウンロード」または「プレビュー」機能をご利用ください。

### Q: インストールしたのに動かない

**A: 以下をご確認ください：**

1. NASに接続できるネットワークにいますか？
2. ブラウザを再起動してみてください
3. IT管理者にお問い合わせください

### Q: Macでも使えますか？

**A: 現在はWindows専用です。**

Macユーザーは「パスをコピー」→「Finderで開く」をご利用ください。

### Q: インストール後、このフォルダは削除していいですか？

**A: はい、削除して大丈夫です。**

インストール時にファイルがローカル（`%LOCALAPPDATA%\CIS\FileHandler`）にコピーされます。

---

## IT管理者向け情報

### ファイル構成

```
scripts/cis-file-handler/
├── インストール.bat      ← ユーザー用（ダブルクリック）
├── アンインストール.bat  ← ユーザー用（ダブルクリック）
├── setup.ps1             ← 自己完結型インストーラー（推奨）
├── install.ps1           ← レガシーインストーラー
├── uninstall.ps1         ← レガシーアンインストーラー
├── cis-open-handler.bat  ← プロトコルハンドラー本体
└── README.md             ← このファイル
```

### 一括配布（GPO等）

```powershell
# サイレントインストール
powershell -ExecutionPolicy Bypass -File "\\share\cis-file-handler\setup.ps1" -Silent

# サイレントアンインストール
powershell -ExecutionPolicy Bypass -File "\\share\cis-file-handler\setup.ps1" -Uninstall -Silent
```

### 技術仕様

- プロトコル: `cis-open://`
- レジストリ: `HKCU\Software\Classes\cis-open`
- インストール先: `%LOCALAPPDATA%\CIS\FileHandler`
- セキュリティ: ts-server3/5/6/7 のみアクセス許可

### セキュリティ対策（v2.0）

このバージョンでは以下のセキュリティ対策が実装されています：

1. **コマンドインジェクション防止**
   - シェルメタ文字（`& | < > ^ ! ; \` $ ( )`）をブロック

2. **パストラバーサル防止**
   - `..` を含むパスをブロック
   - 二重エンコーディング攻撃を防止

3. **厳格なサーバーホワイトリスト**
   - ts-server3, ts-server5, ts-server6, ts-server7 のみ許可
   - 正規表現パターンではなく完全一致で検証

4. **パス形式検証**
   - UNCパス（`\\server\share`）形式のみ許可

### トラブルシューティング

```powershell
# インストール確認
Get-ItemProperty "HKCU:\Software\Classes\cis-open" -ErrorAction SilentlyContinue

# ハンドラーファイルの確認
Test-Path "$env:LOCALAPPDATA\CIS\FileHandler\cis-open-handler.bat"

# テスト
Start-Process "cis-open://\\ts-server3\test"

# バージョン確認
Get-Content "$env:LOCALAPPDATA\CIS\FileHandler\version.txt"
```

### ログ確認

デバッグが必要な場合は、`cis-open-handler.bat` の以下の行のコメントを解除：

```batch
REM echo Received URL: %url% >> "%TEMP%\cis-open-handler.log"
```

ログは `%TEMP%\cis-open-handler.log` に出力されます。

---

## 変更履歴

### v2.0 (2025-01)
- セキュリティ強化
  - コマンドインジェクション対策
  - パストラバーサル対策
  - 厳格なサーバーホワイトリスト
- 自己完結型インストーラー（setup.ps1）追加
- ローカルコピー機能（元フォルダ削除可能に）
- バージョン情報ファイル生成

### v1.0 (2024-12)
- 初版リリース
