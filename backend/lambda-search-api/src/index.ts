/**
 * Lambda Handler for CIS Search API
 * API Gateway → Lambda → OpenSearch
 * + Bedrock画像embedding生成
 */

import { APIGatewayProxyResult, Context } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
// 拡張版OpenSearchサービスを使用（503エラー対策）
import { searchDocuments } from './services/opensearch.service.enhanced';
import { validateSearchQuery } from './utils/validator';
import { handleError, createSuccessResponse } from './utils/error-handler';
import { Logger } from './services/logger.service';
import { SearchQuery } from './types';

// Bedrockクライアント（us-east-1でTitan Embed Image v1を使用）
const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

// S3クライアント
const s3Client = new S3Client({ region: 'ap-northeast-1' });
const THUMBNAIL_BUCKET = 'cis-filesearch-s3-thumbnail';
const LANDING_BUCKET = 'cis-filesearch-s3-landing';
const DOCUWORKS_CONVERTED_PREFIX = 'docuworks-converted/';
const CONVERTED_PDF_PREFIX = 'converted-pdf/';

// CORSヘッダー
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json',
};

/**
 * 画像のembeddingを生成（Bedrock Titan Embed Image v1）
 */
async function generateImageEmbedding(imageBase64: string): Promise<number[]> {
  const command = new InvokeModelCommand({
    modelId: 'amazon.titan-embed-image-v1',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ inputImage: imageBase64 }),
  });

  const response = await bedrockClient.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.embedding;
}

/**
 * プレビュー画像のPresigned URLを生成
 */
async function getPreviewUrl(fileName: string, pageNumber: number = 1): Promise<string> {
  const key = `previews/${fileName}/page_${pageNumber}.jpg`;

  const command = new GetObjectCommand({
    Bucket: THUMBNAIL_BUCKET,
    Key: key,
  });

  // 5分間有効なPresigned URLを生成
  const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });
  return url;
}

/**
 * ファイルの全プレビューページ情報を取得
 */
async function getPreviewPages(fileName: string): Promise<{ pages: Array<{ pageNumber: number; key: string; size?: number }>; totalPages: number }> {
  const prefix = `previews/${fileName}/`;

  const command = new ListObjectsV2Command({
    Bucket: THUMBNAIL_BUCKET,
    Prefix: prefix,
  });

  const response = await s3Client.send(command);

  if (!response.Contents || response.Contents.length === 0) {
    return { pages: [], totalPages: 0 };
  }

  // ページ番号でソート - nullを除外してソート
  type PageInfo = { pageNumber: number; key: string; size?: number };
  const pages: PageInfo[] = response.Contents
    .map((obj): PageInfo | null => {
      const match = obj.Key?.match(/page_(\d+)\.jpg$/);
      if (!match) return null;
      return {
        pageNumber: parseInt(match[1]),
        key: obj.Key || '',
        size: obj.Size,
      };
    })
    .filter((p): p is PageInfo => p !== null)
    .sort((a, b) => a.pageNumber - b.pageNumber);

  return {
    pages,
    totalPages: pages.length,
  };
}

/**
 * プレビューフォルダを検索（拡張子なし → 拡張子付きの順でフォールバック）
 *
 * preview_worker.pyがS3に保存するフォルダ名と、Lambda APIが検索するフォルダ名の
 * 不整合を解決するためのフォールバック検索を実装。
 *
 * 検索順序:
 * 1. 拡張子なし: previews/report/page_1.jpg
 * 2. 拡張子付き: previews/report.pdf/page_1.jpg
 */
async function findPreviewFolder(fileName: string): Promise<string | null> {
  // 1. まず拡張子なしで検索
  const baseFileName = fileName.replace(/\.[^/.]+$/, '');
  let info = await getPreviewPages(baseFileName);
  if (info.totalPages > 0) {
    console.log(`[Preview] Found preview folder (without extension): ${baseFileName}`);
    return baseFileName;
  }

  // 2. 拡張子付きで検索（フォールバック）
  info = await getPreviewPages(fileName);
  if (info.totalPages > 0) {
    console.log(`[Preview] Found preview folder (with extension): ${fileName}`);
    return fileName;
  }

  console.log(`[Preview] Preview folder not found for: ${fileName}`);
  return null;
}

/**
 * S3オブジェクトの存在を確認
 */
async function checkS3ObjectExists(bucket: string, key: string): Promise<boolean> {
  try {
    // ListObjectsV2で存在確認（HEADリクエストの代わり）
    const listCommand = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: key,
      MaxKeys: 1,
    });
    const response = await s3Client.send(listCommand);
    return response.Contents?.some((obj) => obj.Key === key) || false;
  } catch {
    return false;
  }
}

/**
 * DocuWorks変換済みPDFのPresigned URLを取得
 *
 * 変換済みPDFは以下の形式で保存される（日付フォルダ付き）:
 * docuworks-converted/{category}/{server}/{YYYY}/{MM}/{DD}/{timestamp}_{server}_{filename}_{datetime}.pdf
 *
 * 例: docuworks-converted/road/ts-server3/2026/01/19/084228_ts-server7_001 平面図001-2_20260114115628.pdf
 *
 * 注意: PowerShellスクリプトにより、ファイル名に以下の変換が適用される:
 * - プレフィックス: {HHMMSS}_{server}_ (例: 084228_ts-server7_)
 * - サフィックス: _{YYYYMMDDHHmmss} (例: _20260114115628)
 * - 日付フォルダ: {YYYY}/{MM}/{DD}/ (例: 2026/01/19/)
 */
async function getDocuWorksConvertedPdfUrl(fileName: string, s3Key?: string): Promise<{ url: string; found: boolean }> {
  // 元のファイル名から拡張子を除去（日本語や記号も含む）
  const baseFileName = fileName.replace(/\.(xdw|xbd)$/i, '');

  // s3Keyのクリーンアップ: OpenSearchに保存された異常な形式を修正
  let cleanedS3Key = s3Key;
  if (cleanedS3Key) {
    cleanedS3Key = cleanedS3Key.replace(/^processed\/s3:\/\/[^/]+\//, '');
    cleanedS3Key = cleanedS3Key.replace(/^s3:\/\/[^/]+\//, '');
  }

  // プロジェクトフォルダを抽出（誤マッチ防止のため）
  // パターン: R6(A)-37_壬生SIC詳細設計, H26(A)-24_大谷スマートIC予備設計, R02_JOB など
  let projectFolder: string | null = null;
  if (cleanedS3Key) {
    const projectMatch = cleanedS3Key.match(/\/([RH]\d+(?:\([A-Z]\))?-?\d*_[^/]+)\//i);
    if (projectMatch) {
      projectFolder = projectMatch[1];
    }
  }

  // サブディレクトリを抽出（報告書/ など、同一プロジェクト内でのパス一致確認用）
  let subdirectory: string | null = null;
  if (cleanedS3Key) {
    // プロジェクトフォルダの後のパスを取得
    const subdirMatch = cleanedS3Key.match(/\/[RH]\d+(?:\([A-Z]\))?-?\d*_[^/]+\/(.+)\/[^/]+$/i);
    if (subdirMatch && subdirMatch[1]) {
      // 最初のサブディレクトリのみ取得（深いパスの場合は最初の部分）
      const subdirParts = subdirMatch[1].split('/');
      subdirectory = subdirParts[0] || null;
    }
  }

  console.log(`[DocuWorks Preview] Searching: fileName=${fileName}, baseFileName=${baseFileName}, projectFolder=${projectFolder}, subdirectory=${subdirectory}, cleanedS3Key=${cleanedS3Key}`);

  // ===== Phase 1: 直接パス検索（従来のシンプル変換に対応） =====
  if (cleanedS3Key) {
    const directPdfKey = cleanedS3Key.replace(/\.(xdw|xbd)$/i, '.pdf');
    if (await checkS3ObjectExists(LANDING_BUCKET, directPdfKey)) {
      console.log(`[DocuWorks Preview] Found at direct path: ${directPdfKey}`);
      const command = new GetObjectCommand({
        Bucket: LANDING_BUCKET,
        Key: directPdfKey,
        ResponseContentType: 'application/pdf',
        ResponseContentDisposition: 'inline',
      });
      return { url: await getSignedUrl(s3Client, command, { expiresIn: 3600 }), found: true };
    }

    const docuworksConvertedKey = cleanedS3Key
      .replace(/^(?:processed|documents)\//, DOCUWORKS_CONVERTED_PREFIX)
      .replace(/\.(xdw|xbd)$/i, '.pdf');
    if (await checkS3ObjectExists(LANDING_BUCKET, docuworksConvertedKey)) {
      console.log(`[DocuWorks Preview] Found at converted path: ${docuworksConvertedKey}`);
      const command = new GetObjectCommand({
        Bucket: LANDING_BUCKET,
        Key: docuworksConvertedKey,
        ResponseContentType: 'application/pdf',
        ResponseContentDisposition: 'inline',
      });
      return { url: await getSignedUrl(s3Client, command, { expiresIn: 3600 }), found: true };
    }
  }

  // ===== Phase 2: 特定フォルダ内検索（最優先・高速） =====
  // フォルダ構造は保持されるため、s3Keyから直接フォルダパスを構築して検索
  // 例: documents/structure/ts-server7/H22_JOB/xxx/報告書/file.xdw
  //   → docuworks-converted/structure/ts-server7/H22_JOB/xxx/報告書/
  if (cleanedS3Key) {
    // フォルダパスを抽出（ファイル名部分を除去）
    const folderPath = cleanedS3Key.replace(/\/[^/]+\.(xdw|xbd)$/i, '/');
    const specificFolderPrefix = folderPath.replace(/^(?:processed|documents)\//, DOCUWORKS_CONVERTED_PREFIX);

    console.log(`[DocuWorks Preview] Phase 2: Searching in specific folder: ${specificFolderPrefix}`);

    try {
      const listCommand = new ListObjectsV2Command({
        Bucket: LANDING_BUCKET,
        Prefix: specificFolderPrefix,
        MaxKeys: 100, // フォルダ内は通常少数のファイル
      });

      const response = await s3Client.send(listCommand);

      if (response.Contents && response.Contents.length > 0) {
        // ファイル名でマッチングを試みる
        const normalizedTarget = baseFileName.toLowerCase();

        for (const obj of response.Contents) {
          if (!obj.Key || !obj.Key.endsWith('.pdf')) continue;

          const objFileName = obj.Key.split('/').pop() || '';
          // パターン: {timestamp}_ts-serverN_{originalName}_{datetime}.pdf
          // または: {timestamp}_ts-serverN_{originalName}.pdf
          const extractedMatch = objFileName.match(/^\d{6}_ts-server\d+_(.+?)(?:_\d{14})?\.pdf$/i);

          if (extractedMatch) {
            const extractedName = extractedMatch[1].toLowerCase();
            // 完全一致または高い類似度
            if (extractedName === normalizedTarget ||
                extractedName.includes(normalizedTarget) ||
                normalizedTarget.includes(extractedName)) {
              console.log(`[DocuWorks Preview] Phase 2: Found match in specific folder: ${obj.Key}`);
              const command = new GetObjectCommand({
                Bucket: LANDING_BUCKET,
                Key: obj.Key,
                ResponseContentType: 'application/pdf',
                ResponseContentDisposition: 'inline',
              });
              return { url: await getSignedUrl(s3Client, command, { expiresIn: 3600 }), found: true };
            }
          }
        }
        console.log(`[DocuWorks Preview] Phase 2: No match found in ${response.Contents.length} files in specific folder`);
        // Phase 3, 4 へフォールスルー
      } else {
        console.log(`[DocuWorks Preview] Phase 2: Specific folder is empty or doesn't exist, continuing to Phase 3, 4`);
        // Phase 3, 4 へフォールスルー
      }
    } catch (err) {
      console.error(`[DocuWorks Preview] Phase 2 error:`, err);
      // エラーの場合もフォールスルーしてPhase 3, 4を試行
    }
  }

  // ===== Phase 3: converted-pdf フォルダ検索 =====
  const convertedPdfKey = `${CONVERTED_PDF_PREFIX}${baseFileName}.pdf`;
  if (await checkS3ObjectExists(LANDING_BUCKET, convertedPdfKey)) {
    console.log(`[DocuWorks Preview] Found in converted-pdf: ${convertedPdfKey}`);
    const command = new GetObjectCommand({
      Bucket: LANDING_BUCKET,
      Key: convertedPdfKey,
      ResponseContentType: 'application/pdf',
      ResponseContentDisposition: 'inline',
    });
    return { url: await getSignedUrl(s3Client, command, { expiresIn: 3600 }), found: true };
  }

  // ===== Phase 4: 広範囲プレフィックス検索（フォールバック） =====
  // 特定フォルダで見つからない場合の広範囲検索
  const searchPrefixes: string[] = [];

  if (cleanedS3Key) {
    // 基本パス解析: カテゴリとサーバーを抽出
    const pathMatch = cleanedS3Key.match(/(?:processed|documents)\/(road|structure)\/(ts-server\d+)/);
    if (pathMatch) {
      const category = pathMatch[1];
      const originalServer = pathMatch[2];

      // 重要: 実際のS3構造に基づくサーバーマッピング
      // NAS構成:
      //   road(道路): ts-server3 (R:), ts-server5 (U:)
      //   structure(構造): ts-server6 (V:), ts-server7 (S:)
      // 現在のS3状態:
      //   - road/ts-server3/: 5,070ファイル ✓
      //   - road/ts-server5/: 0ファイル ✗ (未変換)
      //   - structure/ts-server6/: 存在 ✓
      //   - structure/ts-server7/: 54,845ファイル ✓
      const ACTUAL_CONVERTED_SERVERS: Record<string, string[]> = {
        road: ['ts-server3', 'ts-server5'],  // 両サーバーを検索対象に含める
        structure: ['ts-server7', 'ts-server6'],
      };

      const serversToSearch = ACTUAL_CONVERTED_SERVERS[category] || [];

      console.log(`[DocuWorks Preview] Original server from s3Key: ${originalServer}, actual servers to search: ${serversToSearch.join(', ')}`);

      // 実際に存在するサーバーフォルダのみ検索
      serversToSearch.forEach((s) => {
        searchPrefixes.push(`${DOCUWORKS_CONVERTED_PREFIX}${category}/${s}/`);
      });
    }
  }

  // フォールバック: カテゴリ別全体検索
  if (searchPrefixes.length === 0) {
    searchPrefixes.push(`${DOCUWORKS_CONVERTED_PREFIX}road/`);
    searchPrefixes.push(`${DOCUWORKS_CONVERTED_PREFIX}structure/`);
  }

  const uniquePrefixes = [...new Set(searchPrefixes)];
  console.log(`[DocuWorks Preview] Search prefixes: ${uniquePrefixes.join(', ')}`);

  // ファイル名マッチング用の正規化関数（記号除去版 - 緩いマッチング用）
  const normalizeFileName = (name: string): string => {
    return name
      .replace(/[_\-\s()（）【】「」『』\[\]]+/g, '') // 記号を除去
      .toLowerCase();
  };

  // ファイル名マッチング用の正規化関数（軽量版 - プレフィックス保持）
  // アンダースコアとハイフンを保持して、プレフィックス（S2_00_など）を維持
  const normalizeFileNameLight = (name: string): string => {
    return name
      .replace(/[()（）【】「」『』\[\]\s]+/g, '') // 括弧類とスペースのみ除去
      .toLowerCase();
  };

  // S3ファイル名からオリジナルファイル名を抽出する関数
  const extractOriginalFileName = (s3FileName: string): string => {
    // PDF拡張子を除去
    let name = s3FileName.replace(/\.pdf$/i, '');
    // プレフィックス除去: {6桁タイムスタンプ}_{ts-serverN}_
    name = name.replace(/^\d{6}_ts-server\d+_/, '');
    // サフィックス除去: _{14桁日時}
    name = name.replace(/_\d{14}$/, '');
    return name;
  };

  // マッチングスコアを計算する関数（高いほど良い）
  // 注意: 変換済みPDFは日付フォルダに保存されるため、元のフォルダ構造は保持されない
  // そのため、ファイル名のみでマッチングを行う
  const calculateMatchScore = (
    s3FileName: string,
    _s3FilePath: string,
    targetBaseName: string,
    _targetProjectFolder: string | null,
    _targetSubdirectory: string | null
  ): number => {
    const extractedName = extractOriginalFileName(s3FileName);
    const normalizedExtracted = normalizeFileName(extractedName);
    const normalizedTarget = normalizeFileName(targetBaseName);

    // プレフィックス保持版の正規化
    const normalizedExtractedLight = normalizeFileNameLight(extractedName);
    const normalizedTargetLight = normalizeFileNameLight(targetBaseName);

    // ベーススコアの計算
    let baseScore = 0;

    // 完全一致: 最高スコア
    if (extractedName === targetBaseName) {
      baseScore = 100;
    }
    // プレフィックス保持版での完全一致（S2_00_数量計算書 vs S2_00_数量計算書）
    else if (normalizedExtractedLight === normalizedTargetLight) {
      baseScore = 98;
    }
    // 記号除去版での完全一致（緩いマッチング）
    else if (normalizedExtracted === normalizedTarget) {
      baseScore = 95;
    }
    // プレフィックス保持版で抽出名がターゲットを含む
    else if (normalizedExtractedLight.includes(normalizedTargetLight)) {
      baseScore = 90;
    }
    // 抽出名がターゲットを含む（記号除去版）
    else if (extractedName.includes(targetBaseName)) {
      baseScore = 88;
    }
    else if (normalizedExtracted.includes(normalizedTarget)) {
      baseScore = 85;
    }
    // ターゲットが抽出名を含む（短いファイル名対応）- 最低5文字必要
    else if (normalizedTargetLight.includes(normalizedExtractedLight) && normalizedExtractedLight.length >= 5) {
      const matchRatio = normalizedExtractedLight.length / normalizedTargetLight.length;
      if (matchRatio >= 0.8) {
        baseScore = 80;
      } else if (matchRatio >= 0.5) {
        baseScore = 70;
      } else {
        baseScore = 50;
      }
    }
    else if (targetBaseName.includes(extractedName) && extractedName.length >= 5) {
      baseScore = 75;
    }
    else if (normalizedTarget.includes(normalizedExtracted) && normalizedExtracted.length >= 5) {
      baseScore = 70;
    }
    else {
      // 部分一致（共通部分が多い）
      const commonLength = findCommonSubstringLength(normalizedExtracted, normalizedTarget);
      const maxLen = Math.max(normalizedExtracted.length, normalizedTarget.length);
      if (commonLength >= 8 && commonLength / maxLen >= 0.7) {
        baseScore = 50 + (commonLength / maxLen) * 30;
      } else if (commonLength >= 5 && commonLength / maxLen >= 0.5) {
        baseScore = 40 + (commonLength / maxLen) * 20;
      }
    }

    // プレフィックス一致ボーナス（S2_00_ などのプレフィックスが一致する場合）
    const targetPrefixMatch = targetBaseName.match(/^([A-Za-z0-9]+_\d+_)/);
    if (targetPrefixMatch && baseScore > 0) {
      const targetPrefix = targetPrefixMatch[1].toLowerCase();
      if (extractedName.toLowerCase().startsWith(targetPrefix)) {
        baseScore += 10; // プレフィックス完全一致ボーナス
        console.log(`[DocuWorks Preview] Prefix match bonus: +10 for ${s3FileName} (prefix: ${targetPrefix})`);
      }
    }

    return Math.max(0, Math.min(100, baseScore));
  };

  // 最長共通部分文字列の長さを求める
  const findCommonSubstringLength = (s1: string, s2: string): number => {
    if (!s1 || !s2) return 0;
    let maxLen = 0;
    for (let i = 0; i < s1.length; i++) {
      for (let j = 0; j < s2.length; j++) {
        let k = 0;
        while (i + k < s1.length && j + k < s2.length && s1[i + k] === s2[j + k]) {
          k++;
        }
        maxLen = Math.max(maxLen, k);
      }
    }
    return maxLen;
  };

  // 各プレフィックスで検索
  for (const searchPrefix of uniquePrefixes) {
    console.log(`[DocuWorks Preview] Searching in: ${searchPrefix}`);

    let continuationToken: string | undefined;
    let searchedCount = 0;
    const maxSearchCount = 10000; // 検索上限を増加
    let bestMatch: { key: string; score: number } | null = null;

    try {
      while (searchedCount < maxSearchCount) {
        const listCommand = new ListObjectsV2Command({
          Bucket: LANDING_BUCKET,
          Prefix: searchPrefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        });

        const response = await s3Client.send(listCommand);

        if (response.Contents) {
          for (const obj of response.Contents) {
            if (!obj.Key || !obj.Key.endsWith('.pdf')) continue;

            const objFileName = obj.Key.split('/').pop() || '';
            const score = calculateMatchScore(objFileName, obj.Key, baseFileName, projectFolder, subdirectory);

            // スコア60以上で候補として記録
            if (score >= 60) {
              console.log(`[DocuWorks Preview] Candidate: ${objFileName} (score: ${score})`);
              if (!bestMatch || score > bestMatch.score) {
                bestMatch = { key: obj.Key, score };
              }
              // スコア95以上なら即座に確定（高信頼度マッチ）
              if (score >= 95) {
                console.log(`[DocuWorks Preview] High confidence match found: ${obj.Key}`);
                const command = new GetObjectCommand({
                  Bucket: LANDING_BUCKET,
                  Key: obj.Key,
                  ResponseContentType: 'application/pdf',
                  ResponseContentDisposition: 'inline',
                });
                return { url: await getSignedUrl(s3Client, command, { expiresIn: 3600 }), found: true };
              }
            }
          }
        }

        searchedCount += response.Contents?.length || 0;
        continuationToken = response.NextContinuationToken;

        if (!continuationToken) break;
      }

      console.log(`[DocuWorks Preview] Searched ${searchedCount} files in ${searchPrefix}`);

      // 高信頼度マッチがなかった場合、ベストマッチを使用（スコア60以上）
      if (bestMatch && bestMatch.score >= 60) {
        console.log(`[DocuWorks Preview] Using best match: ${bestMatch.key} (score: ${bestMatch.score})`);
        const command = new GetObjectCommand({
          Bucket: LANDING_BUCKET,
          Key: bestMatch.key,
          ResponseContentType: 'application/pdf',
          ResponseContentDisposition: 'inline',
        });
        return { url: await getSignedUrl(s3Client, command, { expiresIn: 3600 }), found: true };
      }
    } catch (err) {
      console.error(`[DocuWorks Preview] Error searching in ${searchPrefix}:`, err);
    }
  }

  // ===== Phase 4は削除 =====
  // 以前のキーワードベースのフォールバック検索は誤マッチの主要原因だったため削除
  // 「見つからない」を返す方が、間違ったファイルを返すより良い

  console.log(`[DocuWorks Preview] PDF not found for: ${baseFileName}`);
  return { url: '', found: false };
}

/**
 * プレビューリクエストを処理
 */
async function handlePreviewRequest(params: {
  action?: string;
  fileName?: string;
  fileType?: string;
  s3Key?: string;
  pageNumber?: number;
}): Promise<APIGatewayProxyResult> {
  const { fileName, fileType, s3Key, pageNumber = 1, action: previewAction } = params;

  if (!fileName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'fileName is required' }),
    };
  }

  try {
    // ファイルタイプに基づいて処理を分岐
    const isDocuWorks = fileType === 'docuworks' ||
                        /\.(xdw|xbd)$/i.test(fileName);

    // DocuWorksファイルの場合は変換済みPDFを返す
    if (isDocuWorks) {
      console.log(`Processing DocuWorks preview request: ${fileName}`);

      const result = await getDocuWorksConvertedPdfUrl(fileName, s3Key);

      if (result.found) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            data: {
              fileName,
              previewType: 'pdf',
              pdfUrl: result.url,
              totalPages: 1, // PDFの場合、フロントエンドでページ数を取得
              message: 'DocuWorks file converted to PDF',
            },
          }),
        };
      } else {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'DocuWorks converted PDF not found',
            message: 'このDocuWorksファイルはまだPDFに変換されていません',
          }),
        };
      }
    }

    // 通常のファイル（JPEG プレビュー）
    // プレビューフォルダを検索（拡張子なし → 拡張子付きの順でフォールバック）
    const previewFolder = await findPreviewFolder(fileName);

    if (previewAction === 'get_preview_info') {
      // プレビュー情報のみ取得
      if (!previewFolder) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Preview not found for this file',
          }),
        };
      }

      const info = await getPreviewPages(previewFolder);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: {
            fileName: previewFolder,
            totalPages: info.totalPages,
            pages: info.pages,
          },
        }),
      };
    } else {
      // 指定ページのPresigned URLを取得
      if (!previewFolder) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Preview not found for this file',
          }),
        };
      }

      const info = await getPreviewPages(previewFolder);

      if (info.totalPages === 0) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Preview not found for this file',
          }),
        };
      }

      const page = Math.min(Math.max(1, pageNumber), info.totalPages);
      const previewUrl = await getPreviewUrl(previewFolder, page);

      // 全ページのURLを生成
      const allPageUrls = await Promise.all(
        info.pages.map(async (p) => ({
          pageNumber: p.pageNumber,
          url: await getPreviewUrl(previewFolder, p.pageNumber),
          size: p.size,
        }))
      );

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: {
            fileName: previewFolder,
            previewType: 'images',
            currentPage: page,
            totalPages: info.totalPages,
            previewUrl,
            allPages: allPageUrls,
          },
        }),
      };
    }
  } catch (error: any) {
    console.error('Preview error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
}

const logger = new Logger('LambdaHandler');

/**
 * Lambda Handler
 * API GatewayからのHTTPリクエストを処理
 *
 * Supports both:
 * - REST API (APIGatewayProxyEvent)
 * - HTTP API v2 (APIGatewayProxyEventV2)
 */
export async function handler(
  event: any,
  context: Context
): Promise<APIGatewayProxyResult> {
  // Normalize event format (support both REST API and HTTP API v2)
  const httpMethod = event.httpMethod || event.requestContext?.http?.method || 'UNKNOWN';
  const path = event.path || event.requestContext?.http?.path || event.rawPath || '/';
  const queryParams = event.queryStringParameters || {};

  // リクエストID、タイムスタンプをログに記録
  logger.info('Lambda invoked', {
    requestId: context.awsRequestId,
    httpMethod,
    path,
    eventVersion: event.version || '1.0',
  });

  try {
    // OPTIONSリクエスト（CORS Preflight）
    if (httpMethod === 'OPTIONS') {
      return handleOptionsRequest();
    }

    // POSTリクエストの処理（画像検索用）
    if (httpMethod === 'POST') {
      return await handlePostRequest(event, context);
    }

    // GETリクエストの処理（テキスト検索用）
    if (httpMethod !== 'GET') {
      logger.warn('Method not allowed', { httpMethod, path });
      return createSuccessResponse({
        error: 'Method not allowed',
        code: 'METHOD_NOT_ALLOWED',
      });
    }

    // クエリパラメータは既に上で取得済み

    // バリデーション
    const searchQuery: SearchQuery = validateSearchQuery(queryParams);

    logger.info('Search query validated', { searchQuery });

    // OpenSearchで検索実行
    const searchResult = await searchDocuments(searchQuery);

    // ページネーション情報を構築
    const page = searchQuery.from! / searchQuery.size! + 1;
    const limit = searchQuery.size!;
    const totalPages = Math.ceil(searchResult.total / limit);

    // レスポンスを構築
    const responseData = {
      results: searchResult.results,
      pagination: {
        total: searchResult.total,
        page,
        limit,
        totalPages,
      },
      query: {
        q: searchQuery.query,
        searchMode: searchQuery.searchMode,
        fileType: searchQuery.fileType,
        dateFrom: searchQuery.dateFrom,
        dateTo: searchQuery.dateTo,
        sortBy: searchQuery.sortBy,
        sortOrder: searchQuery.sortOrder,
      },
      took: searchResult.took,
    };

    logger.info('Search completed successfully', {
      resultCount: searchResult.results.length,
      total: searchResult.total,
      took: searchResult.took,
    });

    return createSuccessResponse(responseData);
  } catch (error: any) {
    logger.error('Lambda execution failed', {
      error: error.message,
      stack: error.stack,
    });

    return handleError(error);
  }
}

/**
 * POSTリクエスト処理（画像検索用 + embedding生成）
 */
async function handlePostRequest(
  event: any,
  _context: Context
): Promise<APIGatewayProxyResult> {
  try {
    // リクエストボディをパース
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    // プレビューアクションの処理
    if (body.action === 'get_preview' || body.action === 'get_preview_info') {
      logger.info('Processing preview request', { action: body.action, fileName: body.fileName });
      return await handlePreviewRequest(body);
    }

    // generate-embeddingアクションの処理
    if (body.action === 'generate-embedding' && body.image) {
      logger.info('Generating image embedding', { imageLength: body.image.length });
      try {
        const embedding = await generateImageEmbedding(body.image);
        logger.info('Image embedding generated successfully', { dimensions: embedding.length });
        return createSuccessResponse({
          embedding,
          dimensions: embedding.length,
        });
      } catch (embeddingError: any) {
        logger.error('Failed to generate image embedding', {
          error: embeddingError.message,
          stack: embeddingError.stack,
        });
        return {
          statusCode: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            success: false,
            error: {
              code: 'EMBEDDING_GENERATION_FAILED',
              message: 'Failed to generate image embedding',
              details: { originalError: embeddingError.message },
            },
          }),
        };
      }
    }

    logger.info('POST request body parsed', {
      hasImageEmbedding: !!body.imageEmbedding,
      embeddingLength: body.imageEmbedding?.length,
    });

    // バリデーション（POSTリクエスト用）
    const searchQuery: SearchQuery = validateSearchQuery(body);

    logger.info('POST search query validated', {
      searchQuery: {
        ...searchQuery,
        imageEmbedding: searchQuery.imageEmbedding ? `[${searchQuery.imageEmbedding.length} dimensions]` : undefined
      }
    });

    // OpenSearchで検索実行
    const searchResult = await searchDocuments(searchQuery);

    // ページネーション情報を構築
    const page = Math.floor(searchQuery.from! / searchQuery.size!) + 1;
    const limit = searchQuery.size!;
    const totalPages = Math.ceil(searchResult.total / limit);

    // レスポンスを構築
    // フロントエンドの期待するフォーマットに合わせる（totalをトップレベルに配置）
    const responseData = {
      results: searchResult.results,
      total: searchResult.total,  // フロントエンドはdata.totalを期待
      pagination: {
        total: searchResult.total,
        page,
        limit,
        totalPages,
      },
      query: {
        q: searchQuery.query,
        searchMode: searchQuery.searchMode,
        searchType: searchQuery.imageEmbedding ? 'image' : 'text',
        fileType: searchQuery.fileType,
        dateFrom: searchQuery.dateFrom,
        dateTo: searchQuery.dateTo,
        sortBy: searchQuery.sortBy,
        sortOrder: searchQuery.sortOrder,
      },
      took: searchResult.took,
    };

    logger.info('POST search completed successfully', {
      resultCount: searchResult.results.length,
      total: searchResult.total,
      took: searchResult.took,
    });

    return createSuccessResponse(responseData);
  } catch (error: any) {
    logger.error('POST request failed', {
      error: error.message,
      stack: error.stack,
    });

    return handleError(error);
  }
}

/**
 * OPTIONSリクエスト（CORS Preflight）のハンドリング
 */
function handleOptionsRequest(): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '3600',
    },
    body: '',
  };
}
