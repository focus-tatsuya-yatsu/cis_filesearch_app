# DataSync 統合セットアップガイド

## 📋 Phase 5: DataSync連携設定

### 前提条件の確認

既に以下が完了していることを確認してください：

- ✅ DocuWorks Viewer Light インストール済み
- ✅ フォルダ構成作成済み (`C:\CIS-FileSearch\`)
- ✅ 変換スクリプト動作確認済み
- ✅ タスクスケジューラー設定済み
- ✅ DataSync が仮想マシンで動作中

---

## 🚀 セットアップ手順

### 1️⃣ AWS CLI の確認・設定

PowerShell を**管理者権限**で起動し、以下を実行：

```powershell
# AWS CLI バージョン確認
aws --version

# AWS 認証情報の確認
aws sts get-caller-identity
```

もし AWS CLI がインストールされていない場合：
1. https://aws.amazon.com/cli/ からダウンロード
2. インストール後、以下で設定：

```powershell
aws configure
# 以下を入力：
# AWS Access Key ID: [your-access-key]
# AWS Secret Access Key: [your-secret-key]
# Default region name: ap-northeast-1
# Default output format: json
```

### 2️⃣ 動作確認スクリプトの実行

```powershell
cd C:\CIS-FileSearch\scripts
.\verify-setup.ps1
```

すべての項目が緑色の ✓ になることを確認してください。

### 3️⃣ 統合サービスの起動

#### 方法A: 手動起動（テスト用）

```batch
C:\CIS-FileSearch\scripts\start-all-services.bat
```

これにより2つのサービスが起動します：
- **DocuWorks Converter**: incoming フォルダを監視
- **DataSync Monitor**: converted フォルダを監視してS3にアップロード

#### 方法B: タスクスケジューラーに登録（自動起動）

PowerShell を**管理者権限**で実行：

```powershell
# 既存のタスクを削除（もし存在する場合）
schtasks /delete /tn "CIS-FileSearch-Service" /f

# 新しいタスクをインポート
schtasks /create /xml "C:\CIS-FileSearch\scripts\CIS-FileSearch-Task.xml" /tn "CIS-FileSearch-Service"
```

### 4️⃣ 動作テスト

1. **テストファイルの配置**
   ```
   .xdw ファイルを C:\CIS-FileSearch\incoming\ にコピー
   ```

2. **処理の流れを確認**
   ```
   incoming → processing → converted → S3 → archive
   ```

3. **ログの確認**
   ```
   C:\CIS-FileSearch\logs\
   - docuworks-converter-YYYYMMDD.log
   - datasync-monitor-YYYYMMDD.log
   ```

4. **S3の確認**
   ```
   s3://cis-filesearch-s3-landing/docuworks-converted/YYYY/MM/DD/
   ```

---

## 📁 フォルダの役割

| フォルダ | 用途 | 監視サービス |
|---------|------|-------------|
| `incoming\` | .xdw ファイル配置場所 | DocuWorks Converter |
| `processing\` | 変換中の一時保存 | - |
| `converted\` | PDF変換完了ファイル | DataSync Monitor |
| `archive\` | S3アップロード済みファイル | - |
| `logs\` | 各種ログファイル | - |

---

## 🔧 トラブルシューティング

### 問題: DocuWorks ウィンドウが最前面に来ない

**解決方法**: PC がロックされていないこと、スクリーンセーバーが動作していないことを確認

### 問題: S3 にアップロードされない

**確認事項**:
1. AWS CLI の認証: `aws sts get-caller-identity`
2. S3 バケットへのアクセス: `aws s3 ls s3://cis-filesearch-s3-landing/`
3. ネットワーク接続
4. ログファイルのエラーメッセージ

### 問題: タスクが自動起動しない

**確認事項**:
1. タスクスケジューラーで「CIS-FileSearch-Service」の状態を確認
2. 「ユーザーがログオンしているときのみ実行する」が選択されていること
3. ユーザーアカウントのパスワードが設定されていること

---

## 📊 パフォーマンス調整

### 処理間隔の調整

`converter-task.ps1` の最後の行を編集：
```powershell
Start-Sleep -Seconds 10  # 10秒 → 5秒に変更で高速化
```

`datasync-monitor.ps1` の最後の行を編集：
```powershell
Start-Sleep -Seconds 10  # 10秒 → 5秒に変更で高速化
```

### 同時処理の制限

大量ファイル処理時は、以下を調整：
- DocuWorks の同時起動を避ける（現在の設定で問題なし）
- S3 アップロードのバッチサイズ調整

---

## ✅ セットアップ完了チェックリスト

- [ ] AWS CLI インストール・設定完了
- [ ] verify-setup.ps1 で全項目が緑色
- [ ] start-all-services.bat でサービス起動確認
- [ ] テストファイルで変換・アップロード確認
- [ ] タスクスケジューラーに登録
- [ ] PC 再起動後の自動起動確認

---

## 📞 サポート

問題が解決しない場合は、以下の情報を含めてお問い合わせください：

1. `verify-setup.ps1` の実行結果
2. ログファイルの内容（最新のエラー部分）
3. Windows イベントログのエラー
4. AWS CLI のバージョンと認証状態