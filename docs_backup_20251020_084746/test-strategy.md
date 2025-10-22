# CIS ファイル検索システム テスト戦略書

## 1. テスト方針

### 1.1 テストピラミッド

```
         ┌─────┐
        /  E2E  \       10% - エンドツーエンドテスト
       /─────────\
      / Integration\    30% - 統合テスト
     /───────────────\
    /   Unit Tests    \ 60% - ユニットテスト
   /───────────────────\
```

### 1.2 カバレッジ目標

| テスト種別 | カバレッジ目標 | 優先度 |
|-----------|--------------|--------|
| ユニットテスト | 80%以上 | 高 |
| 統合テスト | 70%以上 | 高 |
| E2Eテスト | 主要シナリオ100% | 中 |

## 2. ユニットテスト

### 2.1 コンポーネントテスト

```typescript
// src/components/SearchBar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchBar } from './SearchBar';

describe('SearchBar', () => {
  const mockOnSearch = jest.fn();

  it('should call onSearch with input value', async () => {
    const user = userEvent.setup();
    render(<SearchBar onSearch={mockOnSearch} />);

    const input = screen.getByPlaceholderText('ファイルを検索...');
    await user.type(input, 'test query');
    await user.click(screen.getByRole('button', { name: '検索' }));

    expect(mockOnSearch).toHaveBeenCalledWith('test query');
  });
});
```

### 2.2 Hooks テスト

```typescript
// src/hooks/useSearch.test.ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSearch } from './useSearch';

describe('useSearch', () => {
  it('should fetch search results', async () => {
    const { result } = renderHook(() => useSearch());

    act(() => {
      result.current.search('test query');
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.results).toHaveLength(2);
    });
  });
});
```

## 3. 統合テスト

### 3.1 APIエンドポイントテスト

```typescript
// tests/integration/api/search.test.ts
import request from 'supertest';
import { app } from '@/api/app';

describe('Search API Integration', () => {
  describe('GET /api/search', () => {
    it('should return search results', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: '報告書' })
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.data.results).toHaveLength(1);
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .get('/api/search')
        .query({ q: 'test' })
        .expect(401);
    });
  });
});
```

## 4. E2Eテスト

### 4.1 主要シナリオテスト

```typescript
// tests/e2e/search-flow.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Search Flow', () => {
  test('should search and view file details', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');

    // 検索実行
    await page.goto('/search');
    await page.fill('[placeholder="ファイルを検索..."]', '営業報告書');
    await page.click('button:has-text("検索")');

    // 結果確認
    await expect(page.locator('.search-results')).toBeVisible();
    const firstResult = page.locator('.search-result-item').first();
    await expect(firstResult).toContainText('営業報告書');
  });
});
```

## 5. パフォーマンステスト

### 5.1 負荷テスト

```javascript
// tests/performance/load-test.js (k6)
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 10 },
    { duration: '5m', target: 50 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<10000'],
    http_req_failed: ['rate<0.1'],
  },
};

export default function() {
  const res = http.get('https://api.cis-filesearch.com/search?q=report');

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 10s': (r) => r.timings.duration < 10000,
  });
}
```

## 6. セキュリティテスト

```typescript
// tests/security/auth.test.ts
describe('Authentication Security', () => {
  it('should prevent SQL injection', async () => {
    const maliciousInput = "admin' OR '1'='1";
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: maliciousInput, password: 'password' });

    expect(response.status).toBe(400);
  });

  it('should enforce rate limiting', async () => {
    const requests = Array(101).fill(null).map(() =>
      request(app).post('/api/auth/login')
    );

    const responses = await Promise.all(requests);
    const rateLimitedResponses = responses.filter(r => r.status === 429);

    expect(rateLimitedResponses.length).toBeGreaterThan(0);
  });
});
```

## 7. CI/CDパイプライン

```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'yarn'
      - run: yarn install --frozen-lockfile
      - run: yarn test:unit --coverage
      - uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
    steps:
      - uses: actions/checkout@v3
      - run: yarn install
      - run: yarn test:integration

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: yarn install
      - run: npx playwright install
      - run: yarn test:e2e
```

## 8. テストデータ管理

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

async function main() {
  const users = await Promise.all(
    Array(10).fill(null).map(() =>
      prisma.user.create({
        data: {
          email: faker.internet.email(),
          name: faker.person.fullName(),
          passwordHash: '$2b$10$...',
        },
      })
    )
  );

  console.log(`Seeded ${users.length} users`);
}

main().finally(() => prisma.$disconnect());
```

---

## 改訂履歴

| 版数 | 日付 | 改訂内容 | 作成者 |
|------|------|----------|--------|
| 1.0 | 2025-01-15 | 初版作成 | CIS開発チーム |