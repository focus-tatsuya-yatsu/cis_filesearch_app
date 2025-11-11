# コンプライアンス考慮事項

## 概要

CIS File Search Applicationにおける法規制遵守とコンプライアンス要件を網羅的に解説します。クライアント側認証（AWS Cognito OAuth 2.0 PKCE）の使用に伴う法的考慮事項を中心に、GDPR、CCPA、個人情報保護法などへの対応方針を示します。

---

## 1. GDPR (General Data Protection Regulation) 対応

### 📋 GDPR適用範囲の確認

**適用される条件**:
- ✅ EU居住者のデータを処理する
- ✅ EU内で商品・サービスを提供する
- ✅ EU居住者の行動を監視する

**CIS File Searchでの適用**:
```typescript
// 判定基準
interface GDPRScope {
  hasEUUsers: boolean;         // EU在住ユーザーが存在するか
  offersServiceToEU: boolean;  // EUでサービス提供しているか
  monitorsEUBehavior: boolean; // EUユーザーの行動を追跡するか
}

const isGDPRApplicable = (scope: GDPRScope): boolean => {
  return scope.hasEUUsers || scope.offersServiceToEU || scope.monitorsEUBehavior;
};
```

### 🔐 個人データの定義

**Cognitoで収集する個人データ**:

| データ項目 | GDPR分類 | 法的根拠 |
|-----------|---------|---------|
| メールアドレス | 個人データ | 正当な利益（Legitimate Interest） |
| 氏名 | 個人データ | 正当な利益 |
| IPアドレス | 個人データ | 正当な利益 |
| ログイン履歴 | 個人データ | 正当な利益 |
| デバイス情報 | 個人データ | 正当な利益 |
| 検索履歴 | 個人データ | 同意（Consent） |

### ✅ GDPR主要条項への対応

#### Article 6: 処理の合法性

**実装例**:

```typescript
// components/Auth/ConsentManager.tsx

import { FC, useState } from 'react';

interface ConsentOptions {
  essential: boolean;           // 必須（サービス提供に不可欠）
  analytics: boolean;           // 分析（オプション）
  searchHistory: boolean;       // 検索履歴保存（オプション）
  marketingCommunications: boolean; // マーケティング（オプション）
}

export const ConsentManager: FC = () => {
  const [consent, setConsent] = useState<ConsentOptions>({
    essential: true,  // 常にtrue（拒否不可）
    analytics: false,
    searchHistory: false,
    marketingCommunications: false,
  });

  const handleSaveConsent = async () => {
    // Cognitoカスタム属性に保存
    await updateUserAttributes({
      'custom:consent_analytics': consent.analytics.toString(),
      'custom:consent_search_history': consent.searchHistory.toString(),
      'custom:consent_marketing': consent.marketingCommunications.toString(),
      'custom:consent_timestamp': new Date().toISOString(),
    });

    // ログ記録（監査証跡）
    await logConsentChange({
      userId: currentUser.id,
      consentOptions: consent,
      timestamp: new Date(),
      ipAddress: getClientIP(),
    });
  };

  return (
    <div className="consent-manager">
      <h2>Cookie と データ処理の同意</h2>

      {/* 必須Cookie（拒否不可） */}
      <label>
        <input type="checkbox" checked={consent.essential} disabled />
        必須Cookie（サービス提供に不可欠）
      </label>

      {/* オプションのCookie */}
      <label>
        <input
          type="checkbox"
          checked={consent.analytics}
          onChange={(e) => setConsent({ ...consent, analytics: e.target.checked })}
        />
        分析Cookie（サービス改善のため）
      </label>

      <label>
        <input
          type="checkbox"
          checked={consent.searchHistory}
          onChange={(e) => setConsent({ ...consent, searchHistory: e.target.checked })}
        />
        検索履歴の保存（パーソナライズのため）
      </label>

      <button onClick={handleSaveConsent}>保存</button>
    </div>
  );
};
```

#### Article 15: アクセス権（Right to Access）

**実装**: ユーザーが自身のデータをダウンロードできる機能

```typescript
// lib/gdpr/data-export.ts

export const exportUserData = async (userId: string) => {
  // 1. Cognitoユーザー属性を取得
  const userAttributes = await fetchUserAttributes();

  // 2. ログイン履歴を取得
  const loginHistory = await getLoginHistory(userId);

  // 3. 検索履歴を取得
  const searchHistory = await getSearchHistory(userId);

  // 4. JSON形式で出力
  const userData = {
    personalInformation: {
      email: userAttributes.email,
      name: userAttributes.name,
      createdAt: userAttributes.created_at,
    },
    loginHistory: loginHistory.map(log => ({
      timestamp: log.timestamp,
      ipAddress: anonymizeIP(log.ipAddress), // 最後のオクテットをマスク
      userAgent: log.userAgent,
    })),
    searchHistory: searchHistory.map(search => ({
      query: search.query,
      timestamp: search.timestamp,
      resultsCount: search.resultsCount,
    })),
    exportedAt: new Date().toISOString(),
  };

  // 5. ダウンロード用のBlobを生成
  const blob = new Blob([JSON.stringify(userData, null, 2)], {
    type: 'application/json',
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `user-data-${userId}-${Date.now()}.json`;
  link.click();

  // 監査ログに記録
  await logDataExport({
    userId,
    timestamp: new Date(),
    ipAddress: getClientIP(),
  });
};
```

#### Article 17: 削除権（Right to Erasure / Right to be Forgotten）

**実装**: ユーザーアカウントとデータの完全削除

```typescript
// lib/gdpr/data-erasure.ts

export const deleteUserAccount = async (userId: string) => {
  try {
    // 1. ユーザーに最終確認
    const confirmed = confirm(
      'アカウントを削除すると、すべてのデータが永久に削除されます。この操作は取り消せません。続けますか？'
    );

    if (!confirmed) return;

    // 2. Cognitoユーザーを削除
    await deleteUser();

    // 3. 関連データを削除
    await Promise.all([
      deleteLoginHistory(userId),
      deleteSearchHistory(userId),
      deleteUserPreferences(userId),
      deleteAuditLogs(userId), // 法的保持期間を過ぎたもののみ
    ]);

    // 4. S3バケットからユーザーファイルを削除
    await deleteS3UserFiles(userId);

    // 5. 削除ログを記録（匿名化されたID）
    await logAccountDeletion({
      anonymizedUserId: hashUserId(userId),
      timestamp: new Date(),
      reason: 'user_request',
    });

    // 6. ログアウトとリダイレクト
    await signOut();
    window.location.href = '/account-deleted';
  } catch (error) {
    console.error('Account deletion failed:', error);
    throw new Error('アカウント削除に失敗しました。サポートにお問い合わせください。');
  }
};
```

#### Article 20: データポータビリティ権

**実装**: 機械可読形式でのデータ提供

```typescript
// データエクスポート形式の選択
export const exportUserDataInFormat = async (
  userId: string,
  format: 'json' | 'csv' | 'xml'
) => {
  const userData = await collectUserData(userId);

  switch (format) {
    case 'json':
      return exportAsJSON(userData);
    case 'csv':
      return exportAsCSV(userData);
    case 'xml':
      return exportAsXML(userData);
    default:
      throw new Error('Unsupported format');
  }
};
```

### 🛡️ データ保持とセキュリティ

#### AWS Cognitoでのデータ保持設定

```hcl
# cognito-data-retention.tf

resource "aws_cognito_user_pool" "main" {
  # ... other settings ...

  # ユーザーが削除されたときの処理
  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  # Lambda Triggerでデータ削除を自動化
  lambda_config {
    pre_token_generation = aws_lambda_function.pre_token_generation.arn
    user_migration       = aws_lambda_function.user_migration.arn

    # ユーザー削除時のクリーンアップ
    custom_message = aws_lambda_function.custom_message.arn
  }
}

# DynamoDB TTL for automatic data deletion
resource "aws_dynamodb_table" "user_activity" {
  name           = "UserActivity"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "userId"
  range_key      = "timestamp"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "N"
  }

  # 自動削除（90日後）
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}
```

---

## 2. CCPA (California Consumer Privacy Act) 対応

### 📋 CCPA適用範囲

**適用される条件**:
- カリフォルニア州居住者にサービス提供
- 年間総収益が$25M以上
- 年間50,000人以上の消費者データを処理
- データ販売から収益の50%以上を得ている

### ✅ CCPA消費者権利への対応

#### 1. 知る権利（Right to Know）

```typescript
// pages/privacy/ccpa-request.tsx

export const CCPADataRequest: FC = () => {
  const handleDataRequest = async () => {
    // 収集されているデータカテゴリを表示
    const dataCategories = [
      '識別子（名前、メールアドレス、IPアドレス）',
      'インターネット活動情報（検索履歴、ログイン履歴）',
      'デバイス情報（ブラウザ、OS、デバイスID）',
    ];

    // データの使用目的を表示
    const businessPurposes = [
      'サービス提供',
      'セキュリティとフリーボード対策',
      'パフォーマンス分析',
    ];

    // データ共有先を表示
    const thirdParties = [
      'AWS (ホスティングプロバイダー)',
      'なし（データ販売は行っていません）',
    ];

    return {
      dataCategories,
      businessPurposes,
      thirdParties,
    };
  };

  return (
    <div>
      <h1>CCPAデータリクエスト</h1>
      <button onClick={handleDataRequest}>データ情報を表示</button>
    </div>
  );
};
```

#### 2. 削除権（Right to Delete）

GDPRのArticle 17実装と同じ（上記参照）

#### 3. オプトアウト権（Right to Opt-Out of Sale）

```typescript
// components/Privacy/DoNotSellMyInfo.tsx

export const DoNotSellMyInfo: FC = () => {
  return (
    <div className="ccpa-opt-out">
      <h2>個人情報の販売拒否</h2>
      <p>
        当社は個人情報を第三者に販売しておりません。
        したがって、オプトアウトの必要はありません。
      </p>
      <p>
        データ共有先: AWS（インフラストラクチャプロバイダー）のみ
      </p>
    </div>
  );
};
```

---

## 3. 日本の個人情報保護法対応

### 📋 個人情報保護法の要件

#### 個人データの定義

**法律上の個人情報**:
- 氏名
- メールアドレス
- IPアドレス（識別可能な場合）
- Cookie ID（個人と紐づく場合）

#### 取得時の通知義務

```typescript
// components/Auth/PrivacyNotice.tsx

export const PrivacyNotice: FC = () => {
  return (
    <div className="privacy-notice">
      <h2>個人情報の取扱いについて</h2>

      <section>
        <h3>1. 取得する個人情報の項目</h3>
        <ul>
          <li>氏名</li>
          <li>メールアドレス</li>
          <li>IPアドレス</li>
          <li>ログイン履歴</li>
          <li>検索履歴（同意いただいた場合）</li>
        </ul>
      </section>

      <section>
        <h3>2. 利用目的</h3>
        <ul>
          <li>サービスの提供</li>
          <li>ユーザー認証</li>
          <li>セキュリティ対策</li>
          <li>サービス改善のための分析</li>
        </ul>
      </section>

      <section>
        <h3>3. 第三者提供</h3>
        <p>
          以下の場合を除き、第三者への提供は行いません:
        </p>
        <ul>
          <li>法令に基づく場合</li>
          <li>ユーザーの同意がある場合</li>
          <li>サービス提供に必要な業務委託先（AWS）</li>
        </ul>
      </section>

      <section>
        <h3>4. 開示・訂正・削除の請求</h3>
        <p>
          ご自身の個人情報について、開示・訂正・削除を希望される場合は、
          アカウント設定画面からいつでも行えます。
        </p>
      </section>

      <section>
        <h3>5. お問い合わせ窓口</h3>
        <p>
          個人情報保護管理者: privacy@example.com
        </p>
      </section>
    </div>
  );
};
```

### 🔐 安全管理措置

**技術的安全管理措置**:

```typescript
// lib/security/data-protection.ts

export const securityMeasures = {
  // 1. アクセス制御
  accessControl: {
    authentication: 'AWS Cognito OAuth 2.0 PKCE',
    authorization: 'Role-Based Access Control (RBAC)',
    mfa: 'Optional (recommended for high-risk accounts)',
  },

  // 2. アクセス者の識別と認証
  identification: {
    uniqueUserId: 'Cognito User Sub',
    sessionManagement: 'JWT with 60-minute expiration',
    deviceTracking: 'Enabled',
  },

  // 3. 外部からの不正アクセス防止
  externalAccessPrevention: {
    firewall: 'AWS WAF',
    ddosProtection: 'AWS Shield',
    intrusionDetection: 'AWS GuardDuty',
  },

  // 4. 情報システムの使用に伴う漏えい等の防止
  leakagePrevention: {
    encryption: {
      inTransit: 'TLS 1.3',
      atRest: 'AES-256',
    },
    logging: 'CloudWatch Logs',
    monitoring: 'CloudWatch Alarms',
  },
};
```

---

## 4. データ処理記録（Records of Processing Activities）

### 📊 データ処理台帳の作成

```typescript
// docs/compliance/ropa-template.ts

interface ProcessingActivity {
  id: string;
  name: string;
  controller: string;
  purpose: string[];
  legalBasis: string;
  dataSubjects: string[];
  personalDataCategories: string[];
  recipients: string[];
  internationalTransfers: boolean;
  retentionPeriod: string;
  securityMeasures: string[];
}

const processingActivities: ProcessingActivity[] = [
  {
    id: 'PA-001',
    name: 'ユーザー認証',
    controller: 'CIS File Search Application',
    purpose: [
      'ユーザー認証',
      'アクセス制御',
      'セキュリティ保護',
    ],
    legalBasis: 'Legitimate Interest (正当な利益)',
    dataSubjects: ['登録ユーザー'],
    personalDataCategories: [
      'メールアドレス',
      '氏名',
      'パスワード（ハッシュ化）',
      'IPアドレス',
      'ログイン履歴',
    ],
    recipients: ['AWS Cognito'],
    internationalTransfers: true, // AWS Cognitoはグローバルサービス
    retentionPeriod: 'アカウント削除まで（最長2年）',
    securityMeasures: [
      'TLS 1.3による暗号化通信',
      'bcryptによるパスワードハッシュ化',
      'MFA（オプション）',
      'Lambda Rate Limiting',
    ],
  },
  {
    id: 'PA-002',
    name: '検索履歴管理',
    controller: 'CIS File Search Application',
    purpose: [
      'パーソナライズ',
      'サービス改善',
    ],
    legalBasis: 'Consent (同意)',
    dataSubjects: ['登録ユーザー（同意した者のみ）'],
    personalDataCategories: [
      '検索クエリ',
      '検索日時',
      '検索結果数',
    ],
    recipients: ['なし'],
    internationalTransfers: false,
    retentionPeriod: '90日間（自動削除）',
    securityMeasures: [
      'DynamoDB暗号化（at rest）',
      'IAMロールベースのアクセス制御',
      'TTLによる自動削除',
    ],
  },
];
```

---

## 5. 国際データ転送（International Data Transfers）

### 🌍 AWS Cognitoのデータ所在地

**注意**: AWS Cognitoはリージョンベースのサービスですが、一部のメタデータは米国に保存される可能性があります。

#### Standard Contractual Clauses (SCCs) の実装

```typescript
// components/Auth/DataTransferConsent.tsx

export const DataTransferConsent: FC = () => {
  return (
    <div className="data-transfer-notice">
      <h2>国際データ転送に関する同意</h2>

      <p>
        当サービスは、AWS Cognito（Amazon Web Services）を使用しています。
        AWS Cognitoは以下のリージョンでデータを処理します:
      </p>

      <ul>
        <li>プライマリリージョン: アジアパシフィック（東京）ap-northeast-1</li>
        <li>バックアップリージョン: アジアパシフィック（大阪）ap-northeast-3</li>
      </ul>

      <p>
        ただし、一部のメタデータは米国内で処理される場合があります。
        AWSは欧州委員会承認の標準契約条項（SCCs）に基づき、
        適切なデータ保護措置を講じています。
      </p>

      <a
        href="https://aws.amazon.com/compliance/gdpr-center/"
        target="_blank"
        rel="noopener noreferrer"
      >
        AWS GDPRセンターで詳細を確認
      </a>

      <label>
        <input type="checkbox" required />
        上記の国際データ転送について理解し、同意します
      </label>
    </div>
  );
};
```

---

## 6. データ保護影響評価（DPIA）

### 🔍 DPIAが必要なケース

**GDPR Article 35による要件**:
- 大規模な個人データの処理
- センシティブデータの処理
- 公開領域の大規模監視

**CIS File SearchでのDPIA必要性評価**:

```typescript
interface DPIAAssessment {
  requiresDPIA: boolean;
  reasons: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

const assessDPIARequirement = (): DPIAAssessment => {
  const factors = {
    largeScaleProcessing: false,  // 大規模処理ではない（<10,000ユーザー）
    sensitiveData: false,          // センシティブデータなし
    publicMonitoring: false,       // 公開領域の監視なし
    automaticDecisionMaking: false, // 自動意思決定なし
    vulnerableSubjects: false,     // 脆弱な対象者なし
  };

  const requiresDPIA = Object.values(factors).some(v => v === true);

  return {
    requiresDPIA,
    reasons: requiresDPIA
      ? ['該当する要素が存在するため、DPIAが必要']
      : ['該当する要素がないため、DPIAは不要（但し、推奨）'],
    riskLevel: 'LOW',
  };
};
```

**推奨**: 小規模アプリケーションでも、予防的にDPIAを実施することを推奨

---

## 7. コンプライアンスチェックリスト

### ✅ 本番環境デプロイ前の必須確認

#### GDPR準拠

- [ ] プライバシーポリシーが公開されている
- [ ] Cookie同意バナーが実装されている
- [ ] データエクスポート機能が実装されている
- [ ] アカウント削除機能が実装されている
- [ ] データ処理台帳（ROPA）が作成されている
- [ ] データ保持期間が明示されている
- [ ] 国際データ転送の同意が取得されている
- [ ] DPIAが実施されている（必要な場合）

#### CCPA準拠

- [ ] プライバシーポリシーにCCPA要件が含まれている
- [ ] 「Do Not Sell My Personal Information」リンクが設置されている
- [ ] データ削除機能が実装されている
- [ ] データカテゴリが明示されている

#### 日本の個人情報保護法準拠

- [ ] 個人情報取扱いの通知が表示されている
- [ ] 利用目的が明示されている
- [ ] 第三者提供の有無が明示されている
- [ ] 安全管理措置が実施されている
- [ ] お問い合わせ窓口が設置されている

#### セキュリティ対策

- [ ] TLS 1.3による暗号化通信
- [ ] パスワードのbcryptハッシュ化
- [ ] MFAが利用可能
- [ ] セッションタイムアウトが設定されている
- [ ] Rate Limitingが実装されている
- [ ] 監査ログが記録されている

---

## 8. インシデント対応とデータ侵害通知

### 🚨 データ侵害時の対応手順

#### 72時間以内の通知義務（GDPR Article 33）

```typescript
// lib/compliance/breach-notification.ts

interface DataBreachIncident {
  incidentId: string;
  discoveredAt: Date;
  affectedUsers: number;
  dataCategories: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  containmentStatus: 'ONGOING' | 'CONTAINED' | 'RESOLVED';
}

export const notifyDataBreach = async (incident: DataBreachIncident) => {
  // 1. 72時間カウントダウン開始
  const deadlineAt = new Date(incident.discoveredAt.getTime() + 72 * 60 * 60 * 1000);

  // 2. 規制当局への通知（重大な侵害の場合）
  if (incident.severity === 'HIGH' || incident.severity === 'CRITICAL') {
    await notifyRegulatoryAuthority({
      incident,
      deadlineAt,
    });
  }

  // 3. 影響を受けたユーザーへの通知
  if (incident.affectedUsers > 0) {
    await notifyAffectedUsers({
      userIds: getAffectedUserIds(incident),
      message: generateBreachNotificationMessage(incident),
    });
  }

  // 4. インシデントレポートの作成
  await createIncidentReport(incident);

  // 5. 監査ログに記録
  await logBreachNotification({
    incidentId: incident.incidentId,
    notifiedAt: new Date(),
    deadlineAt,
  });
};
```

---

## 9. 定期的なコンプライアンス監査

### 📅 年次監査スケジュール

```markdown
## 2025年コンプライアンス監査計画

### Q1 (1-3月)
- [ ] GDPRデータ処理台帳の更新
- [ ] プライバシーポリシーのレビュー
- [ ] ユーザー同意記録の監査

### Q2 (4-6月)
- [ ] セキュリティ設定の見直し
- [ ] アクセスログの分析
- [ ] 第三者セキュリティ監査の実施

### Q3 (7-9月)
- [ ] データ保持ポリシーの確認
- [ ] 不要データの削除
- [ ] DPIAの見直し（必要な場合）

### Q4 (10-12月)
- [ ] 年次コンプライアンスレポート作成
- [ ] 来年度の改善計画策定
- [ ] スタッフトレーニングの実施
```

---

## 10. 参考リソース

### 法規制

- [GDPR Official Text](https://gdpr-info.eu/)
- [CCPA Official Text](https://oag.ca.gov/privacy/ccpa)
- [個人情報保護委員会](https://www.ppc.go.jp/)

### AWS関連

- [AWS GDPR Center](https://aws.amazon.com/compliance/gdpr-center/)
- [AWS Data Privacy](https://aws.amazon.com/compliance/data-privacy/)
- [AWS Cognito Security Best Practices](https://docs.aws.amazon.com/cognito/latest/developerguide/security-best-practices.html)

### 実装ガイド

- [OWASP Privacy Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/User_Privacy_Protection_Cheat_Sheet.html)
- [ICO Data Protection by Design](https://ico.org.uk/for-organisations/guide-to-data-protection/guide-to-the-general-data-protection-regulation-gdpr/accountability-and-governance/data-protection-by-design-and-default/)

---

## まとめ

クライアント側認証（AWS Cognito OAuth 2.0 PKCE）を使用する場合でも、GDPR、CCPA、個人情報保護法への準拠は必須です。本ドキュメントで示した実装例とチェックリストを活用し、法規制遵守を確実に行ってください。

**重要**: 法的要件は変更される可能性があるため、定期的な見直しと専門家（弁護士）への相談を推奨します。
