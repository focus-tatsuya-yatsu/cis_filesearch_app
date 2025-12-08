# AWS DataSync Agent インストールガイド

**作成日**: 2025-01-17
**対象**: Week 2 Day 5-6
**所要時間**: 2-3時間
**前提条件**: VMware ESXi / Hyper-V / KVMのいずれか、NAS接続情報取得済み

---

## 📋 目次

1. [Agentインストール概要](#agentインストール概要)
2. [システム要件](#システム要件)
3. [インストール前チェックリスト](#インストール前チェックリスト)
4. [Agent OVAダウンロード](#agent-ovaダウンロード)
5. [VMware ESXiへのデプロイ](#vmware-esxiへのデプロイ)
6. [Hyper-Vへのデプロイ](#hyper-vへのデプロイ)
7. [Linux KVMへのデプロイ](#linux-kvmへのデプロイ)
8. [Agent初期設定](#agent初期設定)
9. [Agent Activation（AWSへの登録）](#agent-activationawsへの登録)
10. [接続テスト](#接続テスト)
11. [トラブルシューティング](#トラブルシューティング)

---

## Agentインストール概要

### DataSync Agentとは

**AWS DataSync Agent**は、オンプレミス環境に配置する仮想アプライアンス（VM）で、以下の役割を担います:

```
役割:
  1. NAS上のファイルをスキャン
  2. ファイルメタデータ（サイズ、タイムスタンプ、チェックサム）を収集
  3. AWS DataSyncサービスと通信し、転送指示を受け取る
  4. ファイルデータを圧縮・暗号化してS3へ転送
  5. 転送状況をCloudWatchに報告
```

### デプロイメントアーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│              オンプレミス環境（クライアント社内）                        │
│                                                                   │
│  ┌───────────────┐          ┌──────────────────────────────┐    │
│  │  NAS Server   │          │  DataSync Agent VM            │    │
│  │               │          │                                │    │
│  │  192.168.1.100│◄─────────┤  VMware ESXi / Hyper-V / KVM  │    │
│  │               │ SMB/NFS  │                                │    │
│  │  \\nas\share  │          │  eth0: 192.168.1.50 (Static)   │    │
│  └───────────────┘          │  Gateway: 192.168.1.1          │    │
│                              │  DNS: 8.8.8.8                  │    │
│                              └──────────────────────────────┘    │
│                                       │                          │
│                                       │ Port 443 (HTTPS)        │
└───────────────────────────────────────┼──────────────────────────┘
                                        │
                                        │ Internet
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                  AWS Cloud (ap-northeast-1)                      │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  AWS DataSync Service Endpoint                           │   │
│  │                                                            │   │
│  │  datasync.ap-northeast-1.amazonaws.com                    │   │
│  │  (TLS 1.3 Encrypted)                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## システム要件

### ハードウェア要件

#### 最小構成（小規模環境: ~100万ファイル、~1TB）

```
vCPU: 4コア
Memory: 16GB
Disk: 80GB
Network: 1Gbps
```

#### 推奨構成（CISプロジェクト: 500万ファイル、10TB）

```
vCPU: 8コア（推奨）
Memory: 32GB
Disk: 100GB（メタデータキャッシュ増加のため）
Network: 1Gbps以上（推奨: 10Gbps）
```

#### 大規模構成（1,000万ファイル以上、50TB以上）

```
vCPU: 16コア
Memory: 64GB
Disk: 200GB
Network: 10Gbps
```

### 仮想化プラットフォーム要件

| プラットフォーム | サポートバージョン | 備考 |
|---------------|------------------|------|
| VMware ESXi | 6.5 / 6.7 / 7.0 / 8.0 | 最も一般的、推奨 |
| Microsoft Hyper-V | 2012 R2 / 2016 / 2019 / 2022 | Windows Server環境 |
| Linux KVM | RHEL/CentOS 7以降、Ubuntu 16.04以降 | オープンソース環境 |

### ネットワーク要件

#### 必須ポート（アウトバウンド）

```
DataSync Agent → AWS:
  Port 443 (HTTPS)
    - datasync.ap-northeast-1.amazonaws.com
    - s3.ap-northeast-1.amazonaws.com (オプション)
    - activation-datasync.ap-northeast-1.amazonaws.com

DataSync Agent → NAS:
  SMBの場合:
    Port 445 (SMB)
    Port 139 (NetBIOS)（オプション）

  NFSの場合:
    Port 2049 (NFS)
    Port 111 (Portmapper)

初期設定時のみ:
  Port 80 (HTTP) - Agent Web Console（オンプレミス内のみ）
```

#### 帯域幅要件

```
最小: 100 Mbps
推奨: 1 Gbps
理想: 10 Gbps

CISプロジェクトの場合:
  - 初回10TB転送を48時間以内に完了したい
  - 必要帯域幅: 10TB / 48h = 208GB/h = 463Mbps
  → 1Gbps回線を推奨
```

---

## インストール前チェックリスト

### クライアント側で確認すること

```
ネットワーク環境:
  ✅ 仮想化基盤が稼働している（VMware/Hyper-V/KVM）
  ✅ 固定IPアドレスを1つ確保できる（例: 192.168.1.50）
  ✅ インターネットへのHTTPS (Port 443) アクセスが可能
  ✅ NASへのSMB/NFSアクセスが可能

リソース:
  ✅ vCPU 8コアを割り当て可能
  ✅ メモリ 32GBを割り当て可能
  ✅ ディスク 100GBを割り当て可能

認証情報:
  ✅ NASのIPアドレス/ホスト名を把握
  ✅ NASのユーザー名/パスワードを把握
  ✅ 同期対象フォルダパスを把握

AWS側:
  ✅ IAM Role作成済み（CIS-DataSync-Task-Execution-Role）
  ✅ S3バケット作成済み（cis-filesearch-landing）
  ✅ AWS CLI設定済み（AdministratorAccess profile）
```

---

## Agent OVAダウンロード

### Step 1: AWS Consoleにアクセス

```
1. AWSマネジメントコンソールにログイン
2. リージョンを「東京（ap-northeast-1）」に設定
3. サービス検索で「DataSync」と入力
4. DataSync Consoleを開く
```

### Step 2: Agent作成画面へ移動

```
左側メニュー:
  「Agents」をクリック → 「Create agent」ボタンをクリック
```

### Step 3: Hypervisor選択

```
Select hypervisor:
  ○ VMware ESXi       ← CISプロジェクト推奨
  ○ Microsoft Hyper-V
  ○ Linux KVM
```

### Step 4: OVAファイルダウンロード

```
「Download the agent」ボタンをクリック

ダウンロードされるファイル:
  - VMware: aws-datasync-<version>.ova (約600MB)
  - Hyper-V: aws-datasync-<version>.zip (約700MB)
  - KVM: aws-datasync-<version>.qcow2 (約600MB)

保存先: /tmp/aws-datasync-2.0.202501.0.ova (例)
```

### Step 5: Activation Keyの確認

```
後で使用するため、以下の情報をメモ:
  - Region: ap-northeast-1
  - VPC Endpoint (オプション): 使用しない場合は空欄
```

---

## VMware ESXiへのデプロイ

### Step 1: ESXi Web Clientにログイン

```
ブラウザで以下にアクセス:
  https://<ESXi-Server-IP>/ui

認証情報:
  - Username: root
  - Password: ********
```

### Step 2: OVAファイルのアップロード

```
1. 左側メニュー: 「仮想マシン」をクリック
2. 「仮想マシンの作成/登録」ボタンをクリック
3. 「OVFまたはOVAファイルから仮想マシンをデプロイ」を選択
4. 「次へ」をクリック
```

### Step 3: OVAファイル選択

```
1. 仮想マシン名を入力:
   名前: CIS-DataSync-Agent

2. 「ファイルを選択」ボタンをクリック
   ファイル: /tmp/aws-datasync-2.0.202501.0.ova

3. 「次へ」をクリック
```

### Step 4: ストレージ選択

```
デプロイ先のデータストアを選択:
  - 推奨: SSD搭載データストア（メタデータキャッシュ用）
  - 最小: 100GB空き容量

ディスクフォーマット:
  ○ シンプロビジョニング（推奨 - ディスク使用量を節約）
  ○ シックプロビジョニング

「次へ」をクリック
```

### Step 5: ネットワーク設定

```
ネットワークマッピング:
  Destination network: VM Network (またはNASと同じVLAN)

「次へ」をクリック
```

### Step 6: デプロイ実行

```
「完了」ボタンをクリック

デプロイ時間: 約5-10分
進捗確認: ESXi Console → Recent Tasks
```

### Step 7: VM設定のカスタマイズ

```
1. デプロイされたVM「CIS-DataSync-Agent」を右クリック
2. 「設定を編集」を選択

CPU:
  ✅ vCPU: 8コア（デフォルトは4コア）

メモリ:
  ✅ 32GB（デフォルトは16GB）

ネットワークアダプタ:
  ✅ アダプタタイプ: VMXNET3（推奨 - 高性能）

「保存」をクリック
```

### Step 8: VM起動

```
1. VM「CIS-DataSync-Agent」を右クリック
2. 「電源」→「パワーオン」を選択

起動時間: 約2-3分
起動確認: VMコンソールで「login:」プロンプトが表示される
```

---

## Hyper-Vへのデプロイ

### Step 1: ZIPファイル解凍

```powershell
# ダウンロードしたZIPファイルを解凍
Expand-Archive -Path "C:\Downloads\aws-datasync-2.0.202501.0.zip" `
  -DestinationPath "C:\DataSyncAgent"

# 解凍後のディレクトリ構成:
# C:\DataSyncAgent\
#   ├── Virtual Hard Disks\
#   │   └── aws-datasync.vhdx (約80GB)
#   └── Virtual Machines\
#       └── aws-datasync.xml
```

### Step 2: Hyper-V Managerを開く

```
1. Windowsキー + R
2. 「virtmgmt.msc」と入力してEnter
3. Hyper-V Managerが起動
```

### Step 3: 仮想マシンのインポート

```
1. 右クリック（サーバー名） → 「仮想マシンのインポート」
2. 「次へ」をクリック

フォルダーの場所:
  C:\DataSyncAgent\Virtual Machines

3. 「次へ」をクリック

インポートの種類:
  ○ 仮想マシンをコピーする（新しい一意なIDを作成する）

4. 「次へ」をクリック
```

### Step 4: VM設定のカスタマイズ

```
1. インポートされたVM「aws-datasync」を右クリック
2. 「設定」を選択

プロセッサ:
  ✅ 仮想プロセッサの数: 8

メモリ:
  ✅ 起動RAM: 32768 MB (32GB)
  ✅ 動的メモリを有効にする: オフ（推奨）

ネットワークアダプタ:
  ✅ 仮想スイッチ: External Network（NASと通信可能なスイッチ）

「OK」をクリック
```

### Step 5: VM起動

```
1. VM「aws-datasync」を右クリック
2. 「起動」を選択
3. 「接続」を選択してコンソールを開く

起動時間: 約2-3分
```

---

## Linux KVMへのデプロイ

### Step 1: QCOW2イメージのダウンロード

```bash
# ダウンロードディレクトリへ移動
cd /var/lib/libvirt/images

# AWS ConsoleからダウンロードしたQCOW2イメージをコピー
sudo cp /tmp/aws-datasync-2.0.202501.0.qcow2 ./datasync-agent.qcow2

# 権限設定
sudo chown qemu:qemu datasync-agent.qcow2
sudo chmod 644 datasync-agent.qcow2
```

### Step 2: VMの作成

```bash
# virt-installコマンドでVM作成
sudo virt-install \
  --name CIS-DataSync-Agent \
  --memory 32768 \
  --vcpus 8 \
  --disk path=/var/lib/libvirt/images/datasync-agent.qcow2,format=qcow2 \
  --import \
  --os-variant generic \
  --network bridge=br0 \
  --graphics none \
  --console pty,target_type=serial

# 起動時間: 約2-3分
```

### Step 3: VM起動確認

```bash
# VMステータス確認
sudo virsh list --all

# 出力例:
# Id   Name                 State
# ----------------------------------
# 1    CIS-DataSync-Agent   running

# VMコンソール接続（起動確認）
sudo virsh console CIS-DataSync-Agent

# Ctrl + ] でコンソールから抜ける
```

---

## Agent初期設定

### Step 1: VMコンソールへのログイン

```
VMコンソールで以下のプロンプトが表示される:

  AWS DataSync Agent Console
  login: admin
  Password: password

デフォルト認証情報:
  Username: admin
  Password: password
```

### Step 2: 初回パスワード変更

```
初回ログイン時に強制的にパスワード変更が求められます:

  Current password: password
  New password: <Strong-Password-123!>
  Confirm new password: <Strong-Password-123!>

✅ パスワードは必ず記録してください（AWS Secrets Managerに保存推奨）
```

### Step 3: ネットワーク設定

```
Agent Console Main Menu:
  1) Configure network
  2) Test network connectivity
  3) View system information
  4) Restart system
  5) Exit

選択: 1

ネットワーク設定メニュー:
  1) Configure static IP
  2) Configure DHCP
  3) Configure DNS
  4) Test network

選択: 1（固定IPを推奨）
```

#### 固定IP設定

```
IP Address: 192.168.1.50
Subnet Mask: 255.255.255.0
Default Gateway: 192.168.1.1

DNS Server 1: 8.8.8.8
DNS Server 2: 8.8.4.4（オプション）

設定を保存しますか？ (y/n): y

ネットワーク再起動中...
✅ ネットワーク設定が完了しました
```

### Step 4: ネットワーク接続テスト

```
Main Menu → 選択: 2 (Test network connectivity)

Test Menu:
  1) Ping gateway
  2) Ping DNS server
  3) Test HTTPS connectivity to AWS

選択: 3

Testing HTTPS connectivity to AWS DataSync endpoints...
  ✅ datasync.ap-northeast-1.amazonaws.com: SUCCESS
  ✅ activation-datasync.ap-northeast-1.amazonaws.com: SUCCESS

全てのテストが成功したことを確認
```

### Step 5: Agent Web Consoleへのアクセス

```
ブラウザで以下にアクセス:
  http://192.168.1.50/

DataSync Agent Web Console が表示される

ログイン:
  Username: admin
  Password: <Step 2で設定したパスワード>
```

---

## Agent Activation（AWSへの登録）

### Step 1: Activation Key取得

```
Agent Web Console にログイン後、以下の画面が表示される:

  Activation Key: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX

このActivation Keyをコピー
```

### Step 2: AWS Consoleでアクティベーション

```
1. AWS Console → DataSync → Agents → Create agent
2. 「Service endpoint」セクション:
     ○ Public service endpoints in <region>
     Region: Asia Pacific (Tokyo) ap-northeast-1

3. 「Agent activation」セクション:
     Activation key: <Agent Web Consoleでコピーしたキー>

4. 「Get key」ボタンをクリック
```

#### エラーが出た場合

```
Error: "Unable to activate agent. Connection timeout."

対処法:
  1. Agent VMがPort 443でAWSに接続できるか確認
     → ファイアウォール設定を確認

  2. Agent VMのDNS設定が正しいか確認
     → nslookup activation-datasync.ap-northeast-1.amazonaws.com

  3. Activation Keyの有効期限（30分）を確認
     → 期限切れの場合は、Agent Web Consoleで再取得
```

### Step 3: Agent情報の入力

```
Agent name: CIS-DataSync-Agent-NAS01

Tags (Optional):
  - Key: Project,     Value: CIS-FileSearch
  - Key: Component,   Value: DataSync-Agent
  - Key: Location,    Value: OnPremises
  - Key: NAS,         Value: NAS01
```

### Step 4: アクティベーション完了

```
「Create agent」ボタンをクリック

✅ 成功メッセージ:
  "Agent agent-0abc12345def67890 has been created successfully."

Agent ARNをメモ:
  arn:aws:datasync:ap-northeast-1:770923989980:agent/agent-0abc12345def67890
```

---

## 接続テスト

### Step 1: NASへの接続テスト（SMBの場合）

#### Agent VMコンソールから手動テスト

```bash
# Agent VMにSSH接続（またはVMコンソール）
ssh admin@192.168.1.50
Password: <設定したパスワード>

# SMB共有への接続テスト
smbclient -L //192.168.1.100 -U datasync_user

# パスワード入力
Password: ********

# 期待される出力:
Sharename       Type      Comment
---------       ----      -------
FileShare       Disk      Main file storage
IPC$            IPC       IPC Service

✅ 共有名「FileShare」が表示されることを確認
```

#### 特定フォルダへのアクセステスト

```bash
# 共有フォルダをマウント
sudo mount -t cifs //192.168.1.100/FileShare /mnt/test \
  -o username=datasync_user,password=<password>,domain=COMPANY

# ファイル一覧表示
ls -lh /mnt/test

# 期待される出力:
drwxr-xr-x  5 root root 4.0K Jan 15 10:30 Documents
drwxr-xr-x  3 root root 4.0K Jan 14 15:20 Images
drwxr-xr-x  2 root root 4.0K Jan 13 09:10 CAD

✅ フォルダ一覧が表示されることを確認

# アンマウント
sudo umount /mnt/test
```

### Step 2: NASへの接続テスト（NFSの場合）

```bash
# NFS Exportリスト確認
showmount -e 192.168.1.100

# 期待される出力:
Export list for 192.168.1.100:
/volume1/shared *

# NFSマウントテスト
sudo mount -t nfs 192.168.1.100:/volume1/shared /mnt/test

# ファイル一覧表示
ls -lh /mnt/test

# アンマウント
sudo umount /mnt/test
```

### Step 3: AWS接続テスト

```bash
# Agent VMから AWS DataSync Endpointへの接続確認
curl -v https://datasync.ap-northeast-1.amazonaws.com

# 期待される出力:
* Connected to datasync.ap-northeast-1.amazonaws.com (52.xxx.xxx.xxx) port 443
* SSL connection using TLSv1.3 / TLS_AES_128_GCM_SHA256
...
< HTTP/2 403
< content-type: application/x-amz-json-1.1

✅ TLS 1.3接続が成功していることを確認（403エラーは正常 - 認証なしのため）
```

### Step 4: AWS CLIで Agent情報確認

```bash
# ローカルPCから実行
aws datasync describe-agent \
  --agent-arn arn:aws:datasync:ap-northeast-1:770923989980:agent/agent-0abc12345def67890 \
  --profile AdministratorAccess-770923989980

# 期待される出力:
{
  "AgentArn": "arn:aws:datasync:ap-northeast-1:770923989980:agent/agent-0abc12345def67890",
  "Name": "CIS-DataSync-Agent-NAS01",
  "Status": "ONLINE",
  "LastConnectionTime": "2025-01-17T10:30:00+09:00",
  "CreationTime": "2025-01-17T09:45:00+09:00"
}

✅ Status: ONLINE であることを確認
```

---

## トラブルシューティング

### Issue 1: Agent Status が OFFLINE

**症状**:
```
aws datasync describe-agent の出力:
  "Status": "OFFLINE"
```

**原因と対処法**:

```
原因1: Agent VMがシャットダウンしている
  → VMware/Hyper-V/KVMコンソールでVMを起動

原因2: ネットワーク接続エラー
  → Agent VMから以下を確認:
    ping 8.8.8.8
    ping datasync.ap-northeast-1.amazonaws.com
  → ファイアウォール設定を確認（Port 443アウトバウンド）

原因3: Agent VMの時刻がズレている
  → Agent Console → System Information → Time を確認
  → NTPサーバー設定を追加:
    Main Menu → 1 (Configure network) → 5 (Configure NTP)
    NTP Server: pool.ntp.org
```

### Issue 2: Activation Key が無効

**症状**:
```
AWS Console で "Invalid activation key" エラー
```

**対処法**:

```
1. Activation Keyの有効期限は30分
   → 期限切れの場合は、Agent Web Console (http://192.168.1.50/) で再取得

2. リージョン不一致
   → AWS ConsoleとAgent Web Consoleで同じリージョン（ap-northeast-1）を選択

3. Agent VMの時刻がズレている
   → NTPサーバー設定を追加（上記参照）
```

### Issue 3: NAS接続エラー（SMB）

**症状**:
```
DataSync Location作成時に "Unable to connect to SMB server" エラー
```

**対処法**:

```
1. NASのIPアドレス/ホスト名が正しいか確認
   → Agent VMから ping 192.168.1.100

2. SMBポート（445）が開いているか確認
   → Agent VMから telnet 192.168.1.100 445

3. ユーザー名/パスワードが正しいか確認
   → Agent VMから手動マウントテスト（上記参照）

4. ドメイン名が正しいか確認
   → ワークグループの場合は「WORKGROUP」

5. SMBバージョン互換性
   → NASがSMB 2.1以上をサポートしているか確認
   → 古いSMB 1.0は非推奨（セキュリティリスク）
```

### Issue 4: NAS接続エラー（NFS）

**症状**:
```
DataSync Location作成時に "Unable to mount NFS export" エラー
```

**対処法**:

```
1. NFS Exportパスが正しいか確認
   → Agent VMから showmount -e 192.168.1.100

2. NFSポート（2049）が開いているか確認
   → Agent VMから telnet 192.168.1.100 2049

3. NAS側のExport設定を確認
   → Agent VMのIPアドレス（192.168.1.50）が許可されているか
   → /etc/exports（Linux NAS） or NAS Web Console

4. NFSバージョン互換性
   → NFSv3 / NFSv4 / NFSv4.1 いずれかをサポート
```

### Issue 5: Agent VMのパフォーマンス低下

**症状**:
```
DataSync転送速度が期待値（100Mbps以上）を大幅に下回る
```

**対処法**:

```
1. vCPU数を増やす
   → 最小4コア → 推奨8コア

2. メモリを増やす
   → 最小16GB → 推奨32GB

3. ネットワークアダプタを高性能なものに変更
   → VMware: VMXNET3
   → Hyper-V: Synthetic Network Adapter

4. ディスクI/Oを最適化
   → SSD搭載データストアに移動
   → シンプロビジョニング → シックプロビジョニング

5. ESXiホストのCPU/メモリリソース確認
   → 他VMとのリソース競合を回避
```

---

## セキュリティ強化

### SSH接続の有効化（オプション）

```bash
# Agent VMコンソールから設定
Main Menu → 6 (Configure SSH)

Enable SSH? (y/n): y

✅ SSH接続が有効化されました

# ローカルPCからSSH接続テスト
ssh admin@192.168.1.50
```

### ファイアウォール設定の確認

```bash
# Agent VMのファイアウォール設定確認
sudo iptables -L -n -v

# 必要なルール:
# - Port 443 アウトバウンド（AWS DataSync Endpoint）
# - Port 445 または Port 2049（NAS）
# - Port 80 インバウンド（Agent Web Console - オンプレミス内のみ）
```

---

## 完了確認チェックリスト

```
インストール:
  ✅ Agent VMをVMware/Hyper-V/KVMにデプロイ完了
  ✅ VM起動確認（Status: Running）

ネットワーク設定:
  ✅ 固定IPアドレス設定完了（例: 192.168.1.50）
  ✅ DNS設定完了（8.8.8.8）
  ✅ AWS DataSync Endpointへの接続成功（Port 443）

Activation:
  ✅ Activation Key取得
  ✅ AWS ConsoleでAgent登録完了
  ✅ Agent Status: ONLINE 確認

接続テスト:
  ✅ NASへのSMB/NFS接続成功
  ✅ 対象フォルダのファイル一覧取得成功
  ✅ AWS CLIでAgent情報取得成功

ドキュメント:
  ✅ Agent ARNを記録
  ✅ Agent VMのIPアドレスを記録
  ✅ adminパスワードをAWS Secrets Managerに保存
```

---

## 次のステップ

Agent VMのインストールと起動が完了したら、次のガイドへ進んでください:

```
✅ 04-datasync-agent-installation-guide.md ← 現在
⏳ 05-datasync-location-configuration-guide.md ← 次のステップ
   → DataSync Location（Source: NAS、Destination: S3）の設定
```

---

## 参考資料

- [AWS DataSync Agent Requirements](https://docs.aws.amazon.com/datasync/latest/userguide/agent-requirements.html)
- [Deploy your DataSync agent as a VMware virtual machine](https://docs.aws.amazon.com/datasync/latest/userguide/deploy-agents.html#create-agent-vm)
- [Activating your agent](https://docs.aws.amazon.com/datasync/latest/userguide/activate-agent.html)

---

**作成者**: CIS DevOps Team
**最終更新**: 2025-01-17
