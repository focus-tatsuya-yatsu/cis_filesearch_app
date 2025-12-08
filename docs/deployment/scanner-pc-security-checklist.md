# 🔒 Windows スキャナーPC セキュリティチェックリスト

**最終更新**: 2025-11-12
**対象**: Windows 11 Pro スキャナーPC
**重要度**: 本番環境デプロイ前に必須

このチェックリストは、セキュリティ専門家の評価に基づき、初心者でも実行可能な対策を優先度別に整理しています。

---

## 📋 優先度別対策サマリー

| 優先度 | 項目数 | 対応期限 | 推定工数 |
|--------|--------|---------|---------|
| 🔴 **Critical (P0)** | 3項目 | 即日 | 2時間 |
| 🟠 **High (P1)** | 3項目 | 今週 | 7時間 |
| 🟡 **Medium (P2)** | 3項目 | 今月 | 10時間 |
| 🔵 **Low (P3)** | 2項目 | 四半期 | 5時間 |

**総投資**: 約24時間（初期）+ 月2時間（メンテナンス）
**期待ROI**: 1,000倍以上（GDPR罰金€2,000万回避）

---

## 🚨 Critical (P0) - 即日対応必須

### C-1: AWS認証情報の平文保存排除

**⚠️ CVSS Score: 9.1 (Critical)**
**リスク**: `.env`ファイルにAWS鍵が平文保存 → データ漏洩、GDPR違反

#### 現状の問題
```env
# ❌ 危険: .envに平文で保存
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCY...
```

#### 対策手順（15分）

**ステップ1: AWS CLIで認証情報を暗号化保存**
```powershell
# PowerShell起動
aws configure

# プロンプトに従って入力:
AWS Access Key ID: [IAMで取得したキー]
AWS Secret Access Key: [IAMで取得したシークレット]
Default region: ap-northeast-1
Default output format: json
```

**ステップ2: .envからAWS認証情報を削除**
```env
# ✅ 安全: AWS認証情報は記載しない
AWS_REGION=ap-northeast-1
# AWS_ACCESS_KEY_ID=  ← 削除またはコメントアウト
# AWS_SECRET_ACCESS_KEY=  ← 削除またはコメントアウト
```

**ステップ3: 接続テスト**
```powershell
aws s3 ls
# バケット一覧が表示されればOK
```

#### 成功基準
- [ ] `.env`ファイルにAWS認証情報が存在しない
- [ ] `aws s3 ls`でバケット一覧表示
- [ ] `C:\Users\<ユーザー名>\.aws\credentials`に暗号化保存

---

### C-2: .envファイルのアクセス権限制限

**⚠️ CVSS Score: 8.1 (High)**
**リスク**: 全ユーザーから読み取り可能 → 情報漏洩

#### 対策手順（5分）

```powershell
# 管理者権限でPowerShell起動
cd C:\CIS\file-scanner

# 継承を無効化し、現在のユーザーのみ読み取り許可
icacls .env /inheritance:r
icacls .env /grant:r "$env:USERNAME:(R)"
icacls .env /grant:r "SYSTEM:(F)"
icacls .env /grant:r "Administrators:(F)"

# 確認
icacls .env
```

#### 成功基準
- [ ] `.env`のアクセス許可が制限されている
- [ ] 一般ユーザーからアクセスできない
- [ ] `icacls .env`で権限確認

---

### C-3: NAS認証情報の安全な保存

**⚠️ CVSS Score: 8.8 (High)**
**リスク**: SMB/CIFS認証情報が平文保存 → NAS侵害

#### 対策手順（10分）

**方法1: Windows認証情報マネージャー使用（推奨）**
```powershell
# PowerShell起動

# 認証情報を保存
cmdkey /add:nas-server.company.local /user:DOMAIN\scanner-service /pass:YourPassword

# ネットワークドライブマッピング（認証情報は自動取得）
net use Z: \\nas-server.company.local\share /persistent:yes

# 確認
dir Z:\
```

**方法2: .envファイルから認証情報削除**
```env
# ✅ 安全: NASパスのみ記載、認証情報は記載しない
NAS_MOUNT_PATH=Z:\
NAS_PROTOCOL=mounted
# NAS_USERNAME=  ← 削除
# NAS_PASSWORD=  ← 削除
```

#### 成功基準
- [ ] `.env`にNAS認証情報が存在しない
- [ ] Windows認証情報マネージャーに保存済み
- [ ] `dir Z:\`でNASファイル表示

---

### ✅ Critical (P0) 完了チェック

すべて完了したら次に進んでください：

- [ ] C-1: AWS認証情報をAWS CLIに移行完了
- [ ] C-2: .envファイルのアクセス権限制限完了
- [ ] C-3: NAS認証情報をWindows認証情報マネージャーに移行完了
- [ ] 30分クイックウィン対策（後述）実行完了

---

## 🟠 High (P1) - 今週中対応

### H-1: 専用サービスアカウントの作成

**⚠️ CVSS Score: 7.5 (High)**
**リスク**: 管理者アカウントで実行 → 権限昇格攻撃のリスク

**所要時間**: 2時間

#### 対策手順

**ステップ1: 専用ユーザーアカウント作成**
```powershell
# 管理者権限でPowerShell起動

# パスワード入力
$password = Read-Host "FileScannerServiceのパスワードを入力" -AsSecureString

# ローカルユーザー作成
New-LocalUser -Name "FileScannerService" `
              -Password $password `
              -Description "CIS File Scanner専用サービスアカウント" `
              -PasswordNeverExpires `
              -UserMayNotChangePassword

# Usersグループに追加（Administratorsには追加しない）
Add-LocalGroupMember -Group "Users" -Member "FileScannerService"
```

**ステップ2: フォルダアクセス権限設定**
```powershell
# スキャナーディレクトリへの読み取り・実行許可
icacls C:\CIS\file-scanner /grant "FileScannerService:(OI)(CI)RX"

# データベースディレクトリへの変更許可
icacls C:\CIS\file-scanner\data /grant "FileScannerService:(OI)(CI)M"

# ログディレクトリへの変更許可
icacls C:\CIS\file-scanner\logs /grant "FileScannerService:(OI)(CI)M"
```

**ステップ3: Windowsサービス化（NSSM使用）**
```powershell
# NSSMダウンロード: https://nssm.cc/download
# 展開後、管理者権限でPowerShell起動

cd C:\nssm\win64

# サービスインストール
.\nssm.exe install CISFileScanner "C:\Program Files\nodejs\node.exe" "C:\CIS\file-scanner\dist\index.js"
.\nssm.exe set CISFileScanner AppDirectory "C:\CIS\file-scanner"
.\nssm.exe set CISFileScanner ObjectName ".\FileScannerService" "パスワード"
.\nssm.exe set CISFileScanner Start SERVICE_AUTO_START
.\nssm.exe set CISFileScanner AppStdout "C:\CIS\file-scanner\logs\service-stdout.log"
.\nssm.exe set CISFileScanner AppStderr "C:\CIS\file-scanner\logs\service-stderr.log"

# サービス開始
.\nssm.exe start CISFileScanner

# 状態確認
.\nssm.exe status CISFileScanner
```

#### 成功基準
- [ ] FileScannerServiceアカウント作成完了
- [ ] フォルダアクセス権限設定完了
- [ ] Windowsサービス化完了
- [ ] サービスが正常起動

---

### H-2: SQLiteデータベースの暗号化

**⚠️ CVSS Score: 7.2 (High)**
**リスク**: データベースが平文保存 → ファイルパス・メタデータの露出

**所要時間**: 3時間

#### 対策手順

**ステップ1: SQLCipherパッケージ導入**
```bash
# Git Bash起動
cd /c/CIS/file-scanner

# SQLCipher追加
yarn add @journeyapps/sqlcipher
```

**ステップ2: データベース接続コード修正**

`src/services/DatabaseManager.ts`を編集:
```typescript
// 変更前
import sqlite3Import from 'sqlite3';

// 変更後
import sqlite3Import from '@journeyapps/sqlcipher';
```

同ファイルの`initialize()`メソッドに暗号化設定追加:
```typescript
// this.db = new sqlite3.Database(...) の直後に追加
const dbKey = process.env.DB_ENCRYPTION_KEY || 'default-key-change-this';
await this.run(`PRAGMA key = '${dbKey}'`);
await this.run('PRAGMA cipher_page_size = 4096');
await this.run('PRAGMA kdf_iter = 256000');
```

**ステップ3: 暗号化キー生成・保存**
```powershell
# PowerShell起動

# ランダムキー生成
$key = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
Write-Host "Generated Key: $key"

# Windows認証情報マネージャーに保存
cmdkey /generic:CISFileScanner_DBKey /user:encryption /pass:$key
```

**ステップ4: .env設定**
```env
# .envに追加（キー自体は書かない）
# DB_ENCRYPTION_KEY=  ← 空のまま（認証情報マネージャーから取得）
```

**ステップ5: 再ビルド＆テスト**
```bash
# Git Bash起動
cd /c/CIS/file-scanner

yarn build
DRY_RUN=true node dist/index.js scan
```

#### 成功基準
- [ ] SQLCipherパッケージ導入完了
- [ ] データベース接続コード修正完了
- [ ] 暗号化キー生成・保存完了
- [ ] ドライラン成功

---

### H-3: ファイアウォールルール設定

**⚠️ CVSS Score: 6.8 (Medium-High)**
**リスク**: デフォルトルールのみ → 不要な通信の許可

**所要時間**: 1時間

#### 対策手順

```powershell
# 管理者権限でPowerShell起動

# 1. デフォルトポリシー変更（受信:拒否、送信:許可）
Set-NetFirewallProfile -Profile Domain,Public,Private -DefaultInboundAction Block -DefaultOutboundAction Allow

# 2. AWS S3/SQS向け送信許可
New-NetFirewallRule -DisplayName "CIS Scanner - AWS HTTPS" `
                    -Direction Outbound `
                    -Program "C:\Program Files\nodejs\node.exe" `
                    -Protocol TCP `
                    -RemotePort 443 `
                    -Action Allow

# 3. NAS SMB通信許可（特定IPのみ）
$nasIP = "192.168.1.100"  # 実際のNAS IPに変更
New-NetFirewallRule -DisplayName "CIS Scanner - NAS Access" `
                    -Direction Outbound `
                    -Protocol TCP `
                    -RemoteAddress $nasIP `
                    -RemotePort 445,139 `
                    -Action Allow

# 4. ファイアウォールログ有効化
Set-NetFirewallProfile -Profile Domain,Public,Private -LogAllowed True -LogBlocked True -LogFileName "%systemroot%\system32\LogFiles\Firewall\pfirewall.log"

# 5. 確認
Get-NetFirewallRule -DisplayName "CIS Scanner*"
```

#### 成功基準
- [ ] デフォルトポリシー設定完了
- [ ] AWS向けルール作成完了
- [ ] NAS向けルール作成完了
- [ ] ファイアウォールログ有効化

---

### ✅ High (P1) 完了チェック

- [ ] H-1: 専用サービスアカウント作成＆サービス化完了
- [ ] H-2: SQLiteデータベース暗号化完了
- [ ] H-3: ファイアウォールルール設定完了

---

## 🟡 Medium (P2) - 今月中対応

### M-1: セキュリティログと監視の実装

**⚠️ CVSS Score: 5.9 (Medium)**
**所要時間**: 4時間

#### 概要
- Windowsイベントログへの統合
- セキュリティイベントの記録
- 監視スクリプトの作成

詳細は[完全版ガイド](./windows-scanner-pc-setup-guide.md#ステップ5-2-進捗モニタリング)参照

---

### M-2: バックアップと災害復旧計画

**⚠️ CVSS Score: 5.5 (Medium)**
**所要時間**: 2時間

#### 対策手順

**自動バックアップスクリプト作成**
```powershell
# C:\Scripts\backup-scanner-data.ps1 作成
$backupRoot = "C:\Backups\CISScanner"
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupPath = "$backupRoot\$timestamp"

New-Item -ItemType Directory -Path $backupPath -Force

# データベースバックアップ
Copy-Item "C:\CIS\file-scanner\data\*.db" $backupPath
Copy-Item "C:\CIS\file-scanner\.env" $backupPath

# 7日以上前のバックアップ削除
Get-ChildItem $backupRoot -Directory |
  Where-Object { $_.CreationTime -lt (Get-Date).AddDays(-7) } |
  Remove-Item -Recurse -Force
```

**タスクスケジューラ登録**
```powershell
# 毎日3:00 AMに実行
schtasks /create /tn "CIS Scanner Backup" /tr "powershell.exe -File C:\Scripts\backup-scanner-data.ps1" /sc daily /st 03:00
```

#### 成功基準
- [ ] バックアップスクリプト作成完了
- [ ] タスクスケジューラ登録完了
- [ ] 手動実行テスト成功

---

### M-3: ネットワーク分離

**⚠️ CVSS Score: 5.3 (Medium)**
**所要時間**: 4時間（VPN設定）/ 1日（VLAN分離）

#### 推奨事項

**VPN経由のAWS接続**
- AWS VPN Clientインストール
- 企業ネットワークとAWS VPCの安全な接続

**VLAN分離（長期計画）**
- スキャナーPC専用VLAN作成
- NASとインターネットゲートウェイのみアクセス可能

詳細はネットワーク管理者と相談

---

### ✅ Medium (P2) 完了チェック

- [ ] M-1: セキュリティログ実装完了
- [ ] M-2: バックアップスクリプト作成完了
- [ ] M-3: ネットワーク分離計画策定

---

## 🔵 Low (P3) - 四半期対応

### L-1: セキュリティ更新の自動化

**所要時間**: 1時間

```powershell
# Windows Update自動インストール有効化
Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" -Name "AUOptions" -Value 4

# Node.js依存関係の脆弱性スキャン（週次実行）
# package.jsonに追加
"scripts": {
  "security-audit": "yarn audit --level high",
  "update-deps": "yarn upgrade-interactive --latest"
}
```

---

### L-2: 侵入検知システム（IDS）

**所要時間**: 4時間

- Windows Defender for Endpoint有効化
- ネットワーク監視ツール導入検討

---

## ⚡ 30分クイックウィン対策（即座に実行可能）

初心者でも今すぐできる基本的なセキュリティ向上策:

### 1. AWS認証情報の安全化（15分）
```powershell
winget install Amazon.AWSCLI
aws configure
# .envからAWS_ACCESS_KEY_ID/SECRET削除
```

### 2. .envファイルの保護（5分）
```powershell
cd C:\CIS\file-scanner
icacls .env /inheritance:r
icacls .env /grant:r "$env:USERNAME:(R)"
```

### 3. Windows Defenderの確認（2分）
```powershell
Get-MpComputerStatus
# RealTimeProtectionEnabled が True であることを確認
```

### 4. ファイアウォールログの有効化（3分）
```powershell
Set-NetFirewallProfile -All -LogBlocked True -LogAllowed True
```

### 5. 定期再起動の設定（5分）
```powershell
# 毎週日曜日の午前3時に再起動
schtasks /create /tn "Weekly Security Reboot" /tr "shutdown /r /f" /sc weekly /d SUN /st 03:00
```

**合計**: 30分でCritical対策の基礎が完了

---

## 📊 コンプライアンス評価

### GDPR（一般データ保護規則）

| 要件 | 条項 | 対策 | 状態 |
|-----|------|------|------|
| データ暗号化 | Article 32 | H-2: SQLite暗号化 | P1 |
| アクセス制御 | Article 32 | C-2, H-1: 権限制限 | P0-P1 |
| ログ記録 | Article 30 | M-1: セキュリティログ | P2 |
| 侵害通知 | Article 33 | M-1: 監視・アラート | P2 |

**推定罰金リスク**: 未対応の場合 €2,000万 または グローバル売上高の4%

---

### SOC 2（Trust Services Criteria）

| コントロール | 対策 | 優先度 |
|------------|------|--------|
| CC6.1 論理的アクセス制御 | H-1: サービスアカウント | P1 |
| CC6.6 暗号化 | C-1, H-2: 認証情報・DB暗号化 | P0-P1 |
| CC7.2 システム監視 | M-1: セキュリティログ | P2 |
| CC9.2 ベンダー管理 | C-1: AWS認証情報管理 | P0 |

---

## 🗓️ 実装スケジュール

### Week 1: Critical対応
- **Day 1-2**: C-1（AWS認証情報）+ C-2（.env権限）
- **Day 3-4**: C-3（NAS認証情報）
- **Day 5**: セキュリティテスト・検証

### Week 2: High Priority対応
- **Day 1-2**: H-1（サービスアカウント）
- **Day 3-4**: H-2（SQLite暗号化）
- **Day 5**: H-3（ファイアウォール）

### Week 3-4: Medium Priority対応
- M-1（セキュリティログ）
- M-2（バックアップ）
- M-3（ネットワーク分離検討）

### Month 2: Low Priority対応
- L-1（自動更新）
- L-2（IDS検討）

---

## 📞 インシデント対応手順

### セキュリティインシデント発生時

**1. 即座の隔離（5分以内）**
```powershell
# ネットワーク切断
Disable-NetAdapter -Name "Ethernet"

# スキャナーサービス停止
Stop-Service CISFileScanner
```

**2. 証拠保全（15分以内）**
```powershell
$incidentID = "INC-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$evidencePath = "C:\Evidence\$incidentID"
New-Item -ItemType Directory -Path $evidencePath

Copy-Item "C:\CIS\file-scanner\logs\*" $evidencePath
Get-EventLog -LogName Application -Source "CIS File Scanner" -Newest 1000 | Export-Csv "$evidencePath\eventlog.csv"
```

**3. 通知（30分以内）**
- セキュリティ責任者に連絡
- 必要に応じてDPO（データ保護責任者）に通知
- GDPR違反の可能性 → 72時間以内に監督機関に報告

---

## ✅ 最終確認チェックリスト

### デプロイ前セキュリティチェック

#### 認証・認可
- [ ] AWS認証情報が.envに平文保存されていない
- [ ] AWS CLIまたは認証情報マネージャー使用
- [ ] NAS認証情報がスクリプトに平文保存されていない
- [ ] 専用サービスアカウント作成済み
- [ ] サービスアカウントは最小権限のみ

#### データ保護
- [ ] SQLiteデータベースが暗号化されている
- [ ] .envファイルのアクセス権限制限済み
- [ ] ログファイルに機密情報が含まれていない
- [ ] NAS通信がSMB暗号化使用
- [ ] AWS通信がTLS 1.3使用

#### ネットワークセキュリティ
- [ ] Windows Firewall有効
- [ ] 送信先ホワイトリスト設定済み
- [ ] 不要なポートがブロックされている
- [ ] VPN接続設定済み（該当する場合）

#### 監視・ログ
- [ ] セキュリティイベントログ有効
- [ ] Windows Event Log統合
- [ ] ログ保持期間90日以上
- [ ] アラート通知設定済み

#### バックアップ・復旧
- [ ] データベース自動バックアップ設定済み
- [ ] バックアップ暗号化
- [ ] 復旧手順文書化
- [ ] 復旧テスト実施済み

---

## 📚 参考資料

### Microsoft公式ドキュメント
- [Windows 11セキュリティベストプラクティス](https://learn.microsoft.com/ja-jp/windows/security/)
- [Windows認証情報マネージャー](https://learn.microsoft.com/ja-jp/windows/security/identity-protection/credential-guard/)

### AWS公式ドキュメント
- [AWS認証情報のベストプラクティス](https://docs.aws.amazon.com/ja_jp/general/latest/gr/aws-access-keys-best-practices.html)
- [AWS SDK認証情報チェーン](https://docs.aws.amazon.com/ja_jp/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html)

### コンプライアンス
- [GDPR公式サイト](https://gdpr-info.eu/)
- [SOC 2コントロール](https://www.aicpa.org/topic/audit-assurance/audit-and-assurance-greater-than-soc-2)

---

## 🎯 次のステップ

このチェックリストを完了した後:

1. **即日対応（今日中）**: Critical (C-1, C-2, C-3) + 30分クイックウィン
2. **今週中**: High Priority (H-1, H-2, H-3)
3. **今月中**: Medium Priority (M-1, M-2, M-3)
4. **継続的改善**: Low Priority + 四半期ごとのセキュリティレビュー

---

**重要**: セキュリティは継続的なプロセスです。四半期ごとにこのチェックリストを見直し、新たな脅威に対応してください。

お疲れ様でした！🔒
