/**
 * S3 Preview Service
 * PDFプレビューとPresigned URLの生成を管理
 *
 * 対応フォーマット:
 * - PDF: ネイティブ表示
 * - 画像: jpg, jpeg, png, gif, webp, bmp, tiff, tif
 * - Office: doc, docx, xls, xlsx, ppt, pptx (プレビュー画像経由)
 * - DocuWorks: xdw, xbd (PDF変換経由)
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

/**
 * プレビュー対応ファイル拡張子
 */
export const PREVIEWABLE_EXTENSIONS = {
  // PDF
  pdf: ['pdf'],
  // 画像
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif'],
  // Office系（LibreOffice経由でプレビュー生成）
  office: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'],
  // DocuWorks
  docuworks: ['xdw', 'xbd'],
} as const;

/**
 * 全てのプレビュー対応拡張子をフラットな配列で取得
 */
export const ALL_PREVIEWABLE_EXTENSIONS = [
  ...PREVIEWABLE_EXTENSIONS.pdf,
  ...PREVIEWABLE_EXTENSIONS.image,
  ...PREVIEWABLE_EXTENSIONS.office,
  ...PREVIEWABLE_EXTENSIONS.docuworks,
];

/**
 * ファイルがプレビュー可能かチェック
 *
 * @param fileName - ファイル名
 * @returns プレビュー可能な場合true
 */
export function isPreviewable(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext ? (ALL_PREVIEWABLE_EXTENSIONS as readonly string[]).includes(ext) : false;
}

/**
 * ファイルタイプのカテゴリを取得
 *
 * @param fileType - ファイル拡張子（ドットなし）
 * @returns カテゴリ名（pdf, image, office, docuworks, unknown）
 */
export function getFileTypeCategory(
  fileType: string
): 'pdf' | 'image' | 'office' | 'docuworks' | 'unknown' {
  const lowerType = fileType.toLowerCase();

  if ((PREVIEWABLE_EXTENSIONS.pdf as readonly string[]).includes(lowerType)) {
    return 'pdf';
  }
  if ((PREVIEWABLE_EXTENSIONS.image as readonly string[]).includes(lowerType)) {
    return 'image';
  }
  if ((PREVIEWABLE_EXTENSIONS.office as readonly string[]).includes(lowerType)) {
    return 'office';
  }
  if ((PREVIEWABLE_EXTENSIONS.docuworks as readonly string[]).includes(lowerType)) {
    return 'docuworks';
  }
  return 'unknown';
}

export interface PreviewUrlOptions {
  bucket: string;
  key: string;
  expiresIn?: number; // デフォルト: 300秒（5分）
  responseContentType?: string;
  responseContentDisposition?: string;
}

export interface PdfPreviewOptions {
  bucket: string;
  key: string;
  pageNumber?: number; // 特定のページのプレビュー（オプション）
  keywords?: string[]; // ハイライトするキーワード
  expiresIn?: number;
}

export interface PdfMetadata {
  totalPages: number;
  fileName: string;
  fileSize: number;
  contentType: string;
}

/**
 * S3クライアントのシングルトン
 */
let s3Client: S3Client | null = null;

/**
 * S3クライアントを取得
 */
export function getS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  const region = process.env.AWS_REGION || 'ap-northeast-1';

  s3Client = new S3Client({
    region,
    credentials: defaultProvider(),
  });

  return s3Client;
}

/**
 * Presigned URLを生成
 * ファイルへの一時的な読み取りアクセスを提供
 *
 * @param options - Presigned URL生成オプション
 * @returns Presigned URL
 */
export async function generatePresignedUrl(
  options: PreviewUrlOptions
): Promise<string> {
  const {
    bucket,
    key,
    expiresIn = 300, // デフォルト5分
    responseContentType,
    responseContentDisposition,
  } = options;

  const client = getS3Client();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentType: responseContentType,
    ResponseContentDisposition: responseContentDisposition,
  });

  try {
    const url = await getSignedUrl(client, command, { expiresIn });
    return url;
  } catch (error) {
    console.error('Failed to generate presigned URL:', error);
    throw new Error('Failed to generate preview URL');
  }
}

/**
 * PDFファイルのプレビューURLを生成
 *
 * @param options - PDFプレビューオプション
 * @returns プレビューURL
 */
export async function generatePdfPreviewUrl(
  options: PdfPreviewOptions
): Promise<string> {
  const {
    bucket,
    key,
    pageNumber,
    expiresIn = 300,
  } = options;

  // ページ番号が指定されている場合は、ページ別のS3オブジェクトキーを使用
  // 例: processed/document.pdf -> processed/document.pdf/pages/page-1.pdf
  let previewKey = key;

  if (pageNumber !== undefined) {
    // ページ別プレビューが存在する場合は、そのキーを使用
    const pageKey = `${key}/pages/page-${pageNumber}.pdf`;
    previewKey = pageKey;
  }

  return generatePresignedUrl({
    bucket,
    key: previewKey,
    expiresIn,
    responseContentType: 'application/pdf',
    responseContentDisposition: 'inline', // ダウンロードではなくブラウザで表示
  });
}

/**
 * PDFのメタデータを取得
 * S3に保存されているメタデータを使用
 *
 * @param bucket - S3バケット名
 * @param key - S3オブジェクトキー
 * @returns PDFメタデータ
 */
export async function getPdfMetadata(
  bucket: string,
  key: string
): Promise<PdfMetadata> {
  const client = getS3Client();

  try {
    // メタデータファイルのキーを構築
    // 例: processed/document.pdf -> processed/document.pdf.metadata.json
    const metadataKey = `${key}.metadata.json`;

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: metadataKey,
    });

    const response = await client.send(command);

    if (!response.Body) {
      throw new Error('Metadata file is empty');
    }

    // ストリームをバッファに変換
    const bodyContents = await streamToString(response.Body);
    const metadata = JSON.parse(bodyContents);

    return {
      totalPages: metadata.total_pages || 0,
      fileName: metadata.file_name || '',
      fileSize: metadata.file_size || 0,
      contentType: metadata.content_type || 'application/pdf',
    };
  } catch (error) {
    console.error('Failed to get PDF metadata:', error);
    throw new Error('Failed to retrieve PDF metadata');
  }
}

/**
 * 画像ファイルのプレビューURLを生成
 *
 * @param bucket - S3バケット名
 * @param key - S3オブジェクトキー
 * @param expiresIn - URL有効期限（秒）
 * @returns プレビューURL
 */
export async function generateImagePreviewUrl(
  bucket: string,
  key: string,
  expiresIn: number = 300
): Promise<string> {
  // サムネイルが存在する場合はそちらを使用
  const thumbnailKey = key.replace(
    process.env.S3_PROCESSED_PREFIX || 'processed/',
    process.env.S3_THUMBNAIL_PREFIX || 'thumbnails/'
  );

  try {
    // まずサムネイルの存在を確認
    const client = getS3Client();
    const checkCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: thumbnailKey,
    });

    await client.send(checkCommand);

    // サムネイルが存在する場合はそれを使用
    return generatePresignedUrl({
      bucket,
      key: thumbnailKey,
      expiresIn,
      responseContentDisposition: 'inline',
    });
  } catch (error) {
    // サムネイルが存在しない場合はオリジナルを使用
    return generatePresignedUrl({
      bucket,
      key,
      expiresIn,
      responseContentDisposition: 'inline',
    });
  }
}

/**
 * DocuWorksファイルのプレビューURLを生成
 * DocuWorksファイルはPDFに変換済みと想定
 *
 * @param bucket - S3バケット名
 * @param key - S3オブジェクトキー（元のDocuWorksファイル）
 * @param expiresIn - URL有効期限（秒）
 * @returns プレビューURL（PDFのURL）
 */
export async function generateDocuWorksPreviewUrl(
  bucket: string,
  key: string,
  expiresIn: number = 300
): Promise<string> {
  // DocuWorksファイルは処理時にPDFに変換されている想定
  // 例: processed/document.xdw -> processed/document.xdw.pdf
  const pdfKey = `${key}.pdf`;

  return generatePresignedUrl({
    bucket,
    key: pdfKey,
    expiresIn,
    responseContentType: 'application/pdf',
    responseContentDisposition: 'inline',
  });
}

/**
 * 複数ページのプレビューURLを一括生成
 *
 * @param bucket - S3バケット名
 * @param key - S3オブジェクトキー
 * @param pageNumbers - ページ番号の配列
 * @param expiresIn - URL有効期限（秒）
 * @returns ページ番号とURLのマップ
 */
export async function generateMultiplePageUrls(
  bucket: string,
  key: string,
  pageNumbers: number[],
  expiresIn: number = 300
): Promise<Map<number, string>> {
  const urlMap = new Map<number, string>();

  const promises = pageNumbers.map(async (pageNumber) => {
    try {
      const url = await generatePdfPreviewUrl({
        bucket,
        key,
        pageNumber,
        expiresIn,
      });
      urlMap.set(pageNumber, url);
    } catch (error) {
      console.error(`Failed to generate URL for page ${pageNumber}:`, error);
      // エラーが発生したページはスキップ
    }
  });

  await Promise.all(promises);

  return urlMap;
}

/**
 * ReadableStreamを文字列に変換
 *
 * @param stream - ReadableStream
 * @returns 文字列
 */
async function streamToString(stream: any): Promise<string> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Office文書のプレビューURLを生成
 * Office文書はバックエンドでPDF変換後にプレビュー画像が生成されている
 *
 * @param bucket - S3バケット名
 * @param key - S3オブジェクトキー（元のOfficeファイル）
 * @param expiresIn - URL有効期限（秒）
 * @returns プレビューURL（最初のページのプレビュー画像）
 */
export async function generateOfficePreviewUrl(
  bucket: string,
  key: string,
  expiresIn: number = 300
): Promise<string> {
  // Office文書は処理時にプレビュー画像が生成されている想定
  // プレビュー画像のパス: previews/{filename}/page_1.jpg
  const fileName = key.split('/').pop() || key;
  const previewKey = `previews/${fileName}/page_1.jpg`;

  try {
    // まずプレビュー画像の存在を確認
    const client = getS3Client();
    const checkCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: previewKey,
    });

    await client.send(checkCommand);

    // プレビュー画像が存在する場合
    return generatePresignedUrl({
      bucket,
      key: previewKey,
      expiresIn,
      responseContentType: 'image/jpeg',
      responseContentDisposition: 'inline',
    });
  } catch (error) {
    // プレビュー画像がない場合はダウンロード用URLを返す
    console.warn(`Office preview not found for ${key}, returning download URL`);
    return generatePresignedUrl({
      bucket,
      key,
      expiresIn,
      responseContentDisposition: 'attachment',
    });
  }
}

/**
 * ファイルタイプに応じた適切なプレビューURLを生成
 *
 * @param bucket - S3バケット名
 * @param key - S3オブジェクトキー
 * @param fileType - ファイルタイプ
 * @param expiresIn - URL有効期限（秒）
 * @returns プレビューURL
 */
export async function generatePreviewUrlByType(
  bucket: string,
  key: string,
  fileType: string,
  expiresIn: number = 300
): Promise<string> {
  const category = getFileTypeCategory(fileType);

  switch (category) {
    case 'pdf':
      return generatePdfPreviewUrl({
        bucket,
        key,
        expiresIn,
      });

    case 'image':
      return generateImagePreviewUrl(bucket, key, expiresIn);

    case 'office':
      return generateOfficePreviewUrl(bucket, key, expiresIn);

    case 'docuworks':
      return generateDocuWorksPreviewUrl(bucket, key, expiresIn);

    default:
      // その他のファイルはダウンロード用のURLを生成
      return generatePresignedUrl({
        bucket,
        key,
        expiresIn,
        responseContentDisposition: 'attachment',
      });
  }
}
