# AWS Cognito セットアップ完了ガイド

**最速で環境構築を完了させるための統合ガイド**

---

## 🎯 このドキュメントの目的

AWS Cognitoの環境変数設定が必要になったユーザーが、**最短時間**で正しく設定を完了できるようにサポートします。

**対象者:**
- 初めてAWS Cognitoを設定する開発者
- エラーで困っている開発者
- 環境変数の設定方法を確認したい開発者

**所要時間:** 5分〜30分（経験により変動）

---

## 📚 利用可能なリソース

すべてのドキュメントは `/Users/tatsuya/focus_project/cis_filesearch_app/docs/security/` に格納されています。

### 1. **クイックセットアップスクリプト** ⚡
**ファイル:** `/frontend/setup-cognito.sh`

**使用タイミング:** 今すぐ設定を完了させたい

**手順:**
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
chmod +x setup-cognito.sh
./setup-cognito.sh
```

**特徴:**
- ✅ 対話形式で環境変数を入力
- ✅ 形式チェックを自動実行
- ✅ .env.localファイルを自動生成
- ✅ 所要時間: 3分

---

### 2. **クイックリファレンスカード** 📋
**ファイル:** `cognito-quick-reference.md`

**使用タイミング:** 手動で設定したい、または素早く値を確認したい

**内容:**
- 環境変数一覧とコピペ用テンプレート
- AWS Console取得パス（30秒でアクセス）
- よくあるエラーと3秒で解決する方法
- テストコマンド集

**印刷推奨:** A4サイズ1枚に収まるデザイン

---

### 3. **完全設定ガイド** 📖
**ファイル:** `aws-cognito-setup-guide.md`

**使用タイミング:** 詳細な手順を確認したい、AWS Consoleの操作方法を学びたい

**内容:**
- AWS Console完全ナビゲーション（スクリーンショット相当の詳細説明）
- User Pool新規作成手順
- App Client詳細設定
- 開発環境 vs 本番環境の設定
- Vercel環境変数設定
- 所要時間: 30分

**対象:**
- 初めてAWS Cognitoを使う
- User Poolを新規作成する必要がある
- すべての設定項目を理解したい

---

### 4. **トラブルシューティングフローチャート** 🐛
**ファイル:** `cognito-troubleshooting-flowchart.md`

**使用タイミング:** エラーが発生した、設定がうまくいかない

**内容:**
- エラーメッセージ別の診断フローチャート
- ステップバイステップのデバッグ手順
- よくある設定ミス一覧
- 緊急時のデバッグコマンド

**エラー例:**
- "Missing required environment variables"
- "Invalid User Pool ID format"
- "Domain should NOT include http://"
- "Invalid redirect_uri"
- CORS errors
- Token validation failures

---

### 5. **完全テストチェックリスト** 🧪
**ファイル:** `cognito-testing-checklist.md`

**使用タイミング:** 設定が完了した、すべての機能が正常に動作することを確認したい

**内容:**
- 30項目の包括的なテスト手順
- Phase別テスト（環境変数 → AWS Console → Hosted UI → トークン → サインアウト → Protected Route）
- 期待される結果と実際の動作の比較
- テスト結果レポートテンプレート

---

### 6. **認証フロー図解** 🔄
**ファイル:** `cognito-authentication-flow.md`

**使用タイミング:** OAuth 2.0 PKCEの仕組みを理解したい、セキュリティ特性を学びたい

**内容:**
- 完全な認証フローのシーケンス図
- 各ステップの詳細解説
- PKCEセキュリティ特性の説明
- トークンリフレッシュフロー
- サインアウトフロー

---

## 🚀 最速セットアップ（3ステップ）

### ステップ1: スクリプト実行

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
./setup-cognito.sh
```

**入力が必要な項目:**
1. User Pool ID（例: `ap-northeast-1_abc123XYZ`）
2. App Client ID（例: `7uvwxyz1234567890abcdefghijklmn`）
3. Cognito Domain（例: `filesearch.auth.ap-northeast-1.amazoncognito.com`）
4. App URL（例: `http://localhost:3000`）

**AWS Consoleでの取得方法:**
```
AWS Console → Cognito → User pools → [Your Pool]
1. Pool Id をコピー
2. App integration → Client ID をコピー
3. App integration → Domain をコピー
```

---

### ステップ2: Callback URLsの設定

```
AWS Console → Cognito → User pools → [Your Pool]
→ App integration → App client → Hosted UI

Callback URLs に追加:
  http://localhost:3000/auth/callback

Sign out URLs に追加:
  http://localhost:3000
```

**⚠️ 重要:** 末尾のスラッシュの有無を統一してください

---

### ステップ3: 開発サーバー起動と動作確認

```bash
yarn dev
```

**期待される出力:**
```
✅ Amplify環境変数の検証が完了しました
▲ Next.js 15.x.x
- Local:        http://localhost:3000
```

**ブラウザで確認:**
1. `http://localhost:3000` にアクセス
2. "Login" ボタンをクリック
3. Cognito Hosted UIが表示されればOK

---

## 📊 セットアップ状況別ガイド

### 状況1: まったく初めての設定

**推奨手順:**
1. **[完全設定ガイド](./aws-cognito-setup-guide.md)** を読む（30分）
2. **[セットアップスクリプト](../frontend/setup-cognito.sh)** を実行（3分）
3. **[テストチェックリスト](./cognito-testing-checklist.md)** で動作確認（20分）

**理由:** 全体像を理解してから設定することで、トラブルが起きても自己解決できる

---

### 状況2: 急いで設定したい（時間がない）

**推奨手順:**
1. **[クイックリファレンス](./cognito-quick-reference.md)** を開く（1分）
2. **[セットアップスクリプト](../frontend/setup-cognito.sh)** を実行（3分）
3. 開発サーバーを起動してログインテスト（1分）

**理由:** 最小限の時間で動作する環境を構築

---

### 状況3: エラーが発生した

**推奨手順:**
1. **[トラブルシューティングフローチャート](./cognito-troubleshooting-flowchart.md)** を開く
2. エラーメッセージを検索
3. 該当するセクションの解決策を実行

**よくあるエラー:**
- "Invalid User Pool ID format" → User Pool IDを**全文**コピー
- "Domain should NOT include http://" → `https://`を削除
- "Invalid redirect_uri" → Callback URLsを確認

---

### 状況4: テストを実行したい

**推奨手順:**
1. **[テストチェックリスト](./cognito-testing-checklist.md)** を開く
2. Phase 1から順番に実行
3. チェックマークをつけながら進める

**Phase一覧:**
- Phase 1: 環境変数の検証
- Phase 2: AWS Console設定の検証
- Phase 3: Cognito Hosted UIのテスト
- Phase 4: トークンの検証
- Phase 5: サインアウトフローのテスト
- Phase 6: Protected Routeのテスト

---

## 🔧 環境変数の形式ルール

### 必須の4つの環境変数

| 変数名 | 形式ルール | 正しい例 | 間違った例 |
|--------|-----------|----------|------------|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | `^[a-z]{2}-[a-z]+-\d+_[a-zA-Z0-9]+$` | `ap-northeast-1_abc123XYZ` | `ap-northeast-1` |
| `NEXT_PUBLIC_COGNITO_APP_CLIENT_ID` | （制約なし） | `7uvwxyz123...` | - |
| `NEXT_PUBLIC_COGNITO_DOMAIN` | プロトコル不要 | `filesearch.auth.ap-northeast-1.amazoncognito.com` | `https://filesearch.auth...` |
| `NEXT_PUBLIC_APP_URL` | `http://`または`https://`で始まる | `http://localhost:3000` | `localhost:3000` |

---

## ⚡ よくある質問（FAQ）

### Q1: .env.local ファイルはどこに作成する?
**A:** `/Users/tatsuya/focus_project/cis_filesearch_app/frontend/.env.local`

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
cp .env.local.example .env.local
# または
./setup-cognito.sh
```

---

### Q2: User Pool IDはどこで取得する?
**A:** AWS Console → Cognito → User pools → [Pool name] → Pool Id

**正しい形式:** `ap-northeast-1_abc123XYZ`（アンダースコア以降も含む）

---

### Q3: Cognito Domainに https:// を含めるべき?
**A:** **いいえ。ドメイン名のみを設定してください。**

```bash
✅ 正しい: filesearch.auth.ap-northeast-1.amazoncognito.com
❌ 間違い: https://filesearch.auth.ap-northeast-1.amazoncognito.com
```

---

### Q4: Callback URLsの設定がわからない
**A:** AWS Console → Cognito → User pools → App integration → App client → Hosted UI → Callback URLs

**開発環境:** `http://localhost:3000/auth/callback`
**本番環境:** `https://your-app.com/auth/callback`

**⚠️ 注意:** 完全一致が必要（末尾のスラッシュも含めて）

---

### Q5: エラーが出たらどうする?
**A:** [トラブルシューティングフローチャート](./cognito-troubleshooting-flowchart.md) を参照

**最も多いエラー TOP 3:**
1. "Invalid User Pool ID format" → Pool IDを**全文**コピー
2. "Domain should NOT include http://" → `https://`を削除
3. "Invalid redirect_uri" → Callback URLsを確認

---

### Q6: 開発サーバーが起動しない
**A:** 以下の順番で確認:

```bash
# 1. .env.local の存在確認
ls -la .env.local

# 2. 内容確認
cat .env.local

# 3. キャッシュクリア
rm -rf .next

# 4. 依存関係の再インストール
yarn install

# 5. 開発サーバー起動
yarn dev
```

---

## 🎓 学習リソース

### 認証の仕組みを理解したい
➡️ **[認証フロー図解](./cognito-authentication-flow.md)**
- OAuth 2.0 Authorization Code Grant with PKCE
- トークンの発行・検証フロー
- セキュリティ特性

### AWS Cognitoの公式ドキュメント
➡️ https://docs.aws.amazon.com/cognito/

### AWS Amplify v6の公式ドキュメント
➡️ https://docs.amplify.aws/

### Next.js環境変数の公式ドキュメント
➡️ https://nextjs.org/docs/app/building-your-application/configuring/environment-variables

---

## 📞 サポート

### ドキュメントで解決しない場合

**1. GitHub Issues**
プロジェクトのIssuesに詳細を報告してください

**2. プロジェクト管理者**
[担当者名] に連絡

**3. Slack**
#cis-filesearch-support チャンネル

---

## ✅ セットアップ完了チェックリスト

最終確認として、以下のチェックリストを実行してください:

```markdown
### 環境変数
- [ ] .env.local ファイルが存在する
- [ ] NEXT_PUBLIC_COGNITO_USER_POOL_ID が設定されている
- [ ] NEXT_PUBLIC_COGNITO_APP_CLIENT_ID が設定されている
- [ ] NEXT_PUBLIC_COGNITO_DOMAIN が設定されている（https://なし）
- [ ] NEXT_PUBLIC_APP_URL が設定されている（http/https付き）

### AWS Console設定
- [ ] User Poolが作成されている
- [ ] App Clientが作成されている
- [ ] Cognito Domainが設定されている
- [ ] Callback URLs に開発環境のURLが含まれている
- [ ] Sign out URLs に開発環境のURLが含まれている
- [ ] OAuth scopesに openid, email, profile が含まれている
- [ ] Authorization code grantが有効化されている
- [ ] Client secretが生成されていない（PKCE使用のため）

### 動作確認
- [ ] yarn dev でエラーが出ない
- [ ] "✅ Amplify環境変数の検証が完了しました" が表示される
- [ ] Hosted UIにアクセスできる
- [ ] サインアップができる
- [ ] サインインができる
- [ ] サインアウトができる
- [ ] Protected routeが正常に動作する
```

すべてにチェックが入れば、セットアップ完了です！ 🎉

---

## 🚀 次のステップ

セットアップが完了したら:

1. **機能開発を開始**
   - ユーザー認証が必要なページを作成
   - Protected Routeの実装
   - ユーザープロファイル管理

2. **本番環境の準備**
   - 本番用User Poolの作成
   - Vercel環境変数の設定
   - カスタムドメインの設定

3. **セキュリティ強化**
   - MFA（多要素認証）の有効化
   - パスワードポリシーの強化
   - ロールベースアクセス制御（RBAC）の実装

---

**セットアップ完了！Happy Coding! 🎉**

---

**最終更新日**: 2025-01-11
**ドキュメントバージョン**: 1.0.0
**メンテナー**: Backend Team
