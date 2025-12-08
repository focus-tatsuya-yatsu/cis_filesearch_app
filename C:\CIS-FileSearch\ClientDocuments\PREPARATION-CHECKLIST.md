# 📋 DataSync Agent 準備チェックリスト

## 専用PCでの事前準備（オフィスで実施可能）

### ✅ Phase 1: ソフトウェア準備（約30分）

- [ ] **VMware Player インストール**
  - URL: https://www.vmware.com/products/workstation-player.html
  - サイズ: 約150MB
  - インストール時間: 10分

- [ ] **DataSync Agent OVA ダウンロード**
  - URL: https://aws-datasync-downloads.s3.amazonaws.com/VMware/latest/AWS-DataSync-Agent.ova
  - サイズ: 約500MB
  - ダウンロード時間: 5-10分（回線による）

- [ ] **VMware仮想マシン作成**
  ```
  1. VMware Player起動
  2. 「仮想マシンを開く」
  3. OVAファイル選択
  4. 設定確認:
     - メモリ: 16GB
     - CPU: 4コア
     - ディスク: 80GB
  ```

### ✅ Phase 2: ネットワーク設定確認（約10分）

- [ ] **インターネット接続確認**
  ```powershell
  ping 8.8.8.8
  nslookup datasync.ap-northeast-1.amazonaws.com
  ```

- [ ] **AWS接続確認**
  ```powershell
  aws s3 ls s3://cis-filesearch-s3-landing/
  ```

- [ ] **帯域幅テスト**
  ```powershell
  # Speedtest CLIまたはブラウザで確認
  # https://www.speedtest.net/
  ```

### ✅ Phase 3: ドキュメント準備（約5分）

- [ ] **クライアント向け資料を印刷/PDF化**
  - CLIENT-INSTALLATION-GUIDE.txt
  - SIMPLE-EXPLANATION.md
  - このチェックリスト

- [ ] **設定情報をメモ**
  ```
  S3バケット名: cis-filesearch-s3-landing
  リージョン: ap-northeast-1
  転送予定: 8TB
  推定時間: 11日
  ```

## クライアント先での作業（訪問時）

### ✅ Phase 4: 設置作業（約1時間）

- [ ] **専用PCの設置**
  - NASと同一ネットワーク接続
  - 電源確保（UPS推奨）
  - 通気性の良い場所

- [ ] **ネットワーク接続**
  ```powershell
  # NAS接続確認
  ping 192.168.1.212
  ping 192.168.1.214
  ping 192.168.1.217
  ping 192.168.1.218
  ```

- [ ] **VMware Agent起動**
  ```
  1. VMware Player起動
  2. DataSync Agent VM起動
  3. IPアドレスをメモ（例: 192.168.1.100）
  ```

### ✅ Phase 5: Agent有効化（約15分）

- [ ] **Webブラウザでアクティベーション**
  ```
  1. http://[Agent-IP]/ にアクセス
  2. リージョン選択: ap-northeast-1
  3. エンドポイント: Public
  4. Activation Keyをコピー
  ```

- [ ] **AWS側で登録**
  ```bash
  # CloudShellで実行
  aws datasync create-agent \
    --agent-name "CIS-Client-NAS-Agent" \
    --activation-key [コピーしたキー] \
    --region ap-northeast-1
  ```

- [ ] **Agent ARNを記録**
  ```
  ARN: arn:aws:datasync:ap-northeast-1:xxxxx:agent/agent-xxxxx
  ```

### ✅ Phase 6: DataSyncタスク作成（約15分）

- [ ] **create-task.sh実行**
  - Agent ARNを更新
  - SMB認証情報を設定
  - CloudShellで実行

- [ ] **タスク実行テスト**
  ```bash
  # 小さなテストファイルで確認
  aws datasync start-task-execution \
    --task-arn [作成されたARN] \
    --includes "Pattern=/test.txt"
  ```

### ✅ Phase 7: 初回同期開始（約5分）

- [ ] **フル同期の開始**
  ```bash
  aws datasync start-task-execution \
    --task-arn [Task-ARN]
  ```

- [ ] **CloudWatch監視設定**
  - ダッシュボード作成
  - アラート設定
  - 進捗確認方法の説明

## 完了確認

### ✅ 最終チェック

- [ ] Agent: 稼働中
- [ ] タスク: 実行中
- [ ] 転送: 開始確認
- [ ] 監視: CloudWatch表示
- [ ] クライアント: 操作説明完了

## 📞 トラブルシューティング連絡先

問題発生時の確認事項：
1. Agent IPアドレス
2. エラーメッセージ
3. CloudWatchログ
4. ネットワーク接続状態

---

**推定作業時間**:
- 事前準備: 45分（オフィス）
- 現地作業: 2時間（クライアント先）

**初回同期完了**: 約11日後