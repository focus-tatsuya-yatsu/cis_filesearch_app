/**
 * 画像アップロードAPIテストスクリプト
 *
 * 実行方法:
 * node scripts/test-image-upload.js [画像ファイルパス]
 *
 * 例:
 * node scripts/test-image-upload.js test-image.jpg
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// コマンドライン引数から画像パスを取得
const imagePath = process.argv[2];

if (!imagePath) {
  console.error('エラー: 画像ファイルパスを指定してください');
  console.error('使用方法: node scripts/test-image-upload.js <画像ファイルパス>');
  console.error('例: node scripts/test-image-upload.js test-image.jpg');
  process.exit(1);
}

// ファイルの存在確認
if (!fs.existsSync(imagePath)) {
  console.error(`エラー: ファイルが見つかりません: ${imagePath}`);
  process.exit(1);
}

// APIエンドポイント
const API_URL = process.env.API_URL || 'http://localhost:3000/api/image-embedding';

console.log('========================================');
console.log('画像アップロードAPIテスト');
console.log('========================================');
console.log('');
console.log('設定:');
console.log(`  API URL: ${API_URL}`);
console.log(`  画像ファイル: ${imagePath}`);
console.log('');

/**
 * APIリクエストを送信
 */
async function testImageUpload() {
  try {
    // FormDataを作成
    const formData = new FormData();
    const fileStream = fs.createReadStream(imagePath);
    formData.append('image', fileStream, path.basename(imagePath));

    console.log('リクエスト送信中...');
    console.log('');

    // fetch APIを使用（Node.js 18以降）
    const response = await fetch(API_URL, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders ? formData.getHeaders() : {},
    });

    console.log(`ステータスコード: ${response.status} ${response.statusText}`);
    console.log('');

    // レスポンスヘッダー
    console.log('レスポンスヘッダー:');
    response.headers.forEach((value, key) => {
      console.log(`  ${key}: ${value}`);
    });
    console.log('');

    // レスポンスボディ
    const responseData = await response.json();
    console.log('レスポンスボディ:');
    console.log(JSON.stringify(responseData, null, 2));
    console.log('');

    // 結果判定
    if (response.ok && responseData.success) {
      console.log('✓ テスト成功！');
      console.log('');
      console.log('埋め込みベクトル情報:');
      console.log(`  次元数: ${responseData.data.dimensions}`);
      console.log(`  ファイル名: ${responseData.data.fileName}`);
      console.log(`  ファイルサイズ: ${responseData.data.fileSize} bytes`);
      console.log(`  ファイルタイプ: ${responseData.data.fileType}`);
      console.log(`  ベクトル（最初の10要素）: [${responseData.data.embedding.slice(0, 10).join(', ')}...]`);
      process.exit(0);
    } else {
      console.error('✗ テスト失敗');
      console.error('');
      console.error('エラー詳細:');
      console.error(`  エラーメッセージ: ${responseData.error}`);
      console.error(`  エラーコード: ${responseData.code}`);
      if (responseData.message) {
        console.error(`  詳細: ${responseData.message}`);
      }
      process.exit(1);
    }

  } catch (error) {
    console.error('✗ リクエスト送信エラー');
    console.error('');
    console.error(error);

    // エラーの種類に応じたヘルプメッセージ
    if (error.code === 'ECONNREFUSED') {
      console.error('');
      console.error('ヒント: Next.js 開発サーバーが起動していません');
      console.error('  起動方法: yarn dev');
    } else if (error.name === 'FetchError') {
      console.error('');
      console.error('ヒント: ネットワークエラーが発生しました');
      console.error('  - 開発サーバーが起動しているか確認してください');
      console.error('  - API_URL が正しいか確認してください');
    }

    process.exit(1);
  }
}

// テスト実行
testImageUpload();
