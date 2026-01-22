# CIS File Handler - NAS ファイル直接オープン機能

CIS File Search アプリケーションから、NAS 上のファイルを直接開くためのツールです。

## 簡単インストール（一般ユーザー向け）

### インストール方法

**`インストール.bat` をダブルクリックするだけ！**

```
1. このフォルダを開く
2. 「インストール.bat」をダブルクリック
3. 完了メッセージが表示されたら終了
```

### アンインストール方法

**`アンインストール.bat` をダブルクリック**

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

---

## IT管理者向け情報

### ファイル構成

```
scripts/cis-file-handler/
├── インストール.bat      ← ユーザー用（ダブルクリック）
├── アンインストール.bat  ← ユーザー用（ダブルクリック）
├── install.ps1           ← PowerShellスクリプト
├── uninstall.ps1         ← PowerShellスクリプト
├── cis-open-handler.bat  ← プロトコルハンドラー本体
└── README.md             ← このファイル
```

### 一括配布（GPO等）

```powershell
# サイレントインストール
powershell -ExecutionPolicy Bypass -File "\\share\cis-file-handler\install.ps1"
```

### 技術仕様

- プロトコル: `cis-open://`
- レジストリ: `HKCU\Software\Classes\cis-open`
- セキュリティ: ts-server3/5/6/7 のみアクセス許可

### トラブルシューティング

```powershell
# インストール確認
Get-ItemProperty "HKCU:\Software\Classes\cis-open" -ErrorAction SilentlyContinue

# テスト
Start-Process "cis-open://\\ts-server3\test"
```
