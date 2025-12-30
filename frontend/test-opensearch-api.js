/**
 * OpenSearch API テストスクリプト
 * モックデータのフォールバック動作を確認します
 */

const http = require('http');

function testSearchAPI(query, searchMode = 'or') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: `/api/search/?q=${encodeURIComponent(query)}&searchMode=${searchMode}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: jsonData,
          });
        } catch (error) {
          reject(new Error(`Failed to parse JSON: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

async function runTests() {
  console.log('========================================');
  console.log('OpenSearch API テスト');
  console.log('========================================\n');

  try {
    // テスト1: 基本検索（OR検索）
    console.log('テスト1: 基本検索（OR検索） - "予算"');
    const result1 = await testSearchAPI('予算', 'or');
    console.log(`ステータス: ${result1.statusCode}`);
    console.log(`モックデータ使用: ${result1.headers['x-mock-data'] || 'false'}`);
    console.log(`結果数: ${result1.body.data?.results?.length || 0}`);
    console.log(`合計: ${result1.body.data?.pagination?.total || 0}`);
    if (result1.body.warning) {
      console.log(`⚠️  警告: ${result1.body.warning}`);
    }
    console.log('\n最初の結果:');
    if (result1.body.data?.results?.[0]) {
      const firstResult = result1.body.data.results[0];
      console.log(`  - ファイル名: ${firstResult.fileName}`);
      console.log(`  - パス: ${firstResult.filePath}`);
      console.log(`  - スコア: ${firstResult.relevanceScore}`);
    }
    console.log('\n');

    // テスト2: AND検索
    console.log('テスト2: AND検索 - "2024 予算"');
    const result2 = await testSearchAPI('2024 予算', 'and');
    console.log(`ステータス: ${result2.statusCode}`);
    console.log(`モックデータ使用: ${result2.headers['x-mock-data'] || 'false'}`);
    console.log(`結果数: ${result2.body.data?.results?.length || 0}`);
    console.log(`合計: ${result2.body.data?.pagination?.total || 0}`);
    console.log('\n');

    // テスト3: ファイルタイプ検索
    console.log('テスト3: 空クエリ検索');
    const result3 = await testSearchAPI('', 'or');
    console.log(`ステータス: ${result3.statusCode}`);
    console.log(`モックデータ使用: ${result3.headers['x-mock-data'] || 'false'}`);
    console.log(`結果数: ${result3.body.data?.results?.length || 0}`);
    console.log(`合計: ${result3.body.data?.pagination?.total || 0}`);
    console.log('\n');

    console.log('========================================');
    console.log('✅ すべてのテスト完了');
    console.log('========================================');
  } catch (error) {
    console.error('❌ テスト失敗:', error.message);
    process.exit(1);
  }
}

runTests();
