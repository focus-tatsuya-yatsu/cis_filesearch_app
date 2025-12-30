
/**
 * プレビュー画像のPresigned URLを生成
 * @param {string} fileName - ファイル名（拡張子なし）
 * @param {number} pageNumber - ページ番号（1始まり）
 * @returns {Promise<string>} Presigned URL
 */
async function getPreviewUrl(fileName, pageNumber = 1) {
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
 * @param {string} fileName - ファイル名（拡張子なし）
 * @returns {Promise<{pages: Array, totalPages: number}>}
 */
async function getPreviewPages(fileName) {
  const prefix = `previews/${fileName}/`;
  
  const command = new ListObjectsV2Command({
    Bucket: THUMBNAIL_BUCKET,
    Prefix: prefix,
  });
  
  const response = await s3Client.send(command);
  
  if (!response.Contents || response.Contents.length === 0) {
    return { pages: [], totalPages: 0 };
  }
  
  // ページ番号でソート
  const pages = response.Contents
    .map(obj => {
      const match = obj.Key.match(/page_(\d+)\.jpg$/);
      return match ? {
        pageNumber: parseInt(match[1]),
        key: obj.Key,
        size: obj.Size,
      } : null;
    })
    .filter(p => p !== null)
    .sort((a, b) => a.pageNumber - b.pageNumber);
  
  return {
    pages,
    totalPages: pages.length,
  };
}

/**
 * プレビューリクエストを処理
 * @param {Object} params - リクエストパラメータ
 * @returns {Promise<Object>} レスポンス
 */
async function handlePreviewRequest(params) {
  const { fileName, pageNumber = 1, action: previewAction } = params;
  
  if (!fileName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'fileName is required' }),
    };
  }
  
  try {
    // ファイル名から拡張子を除去
    const baseFileName = fileName.replace(/\.[^/.]+$/, '');
    
    if (previewAction === 'get_preview_info') {
      // プレビュー情報のみ取得
      const info = await getPreviewPages(baseFileName);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: {
            fileName: baseFileName,
            totalPages: info.totalPages,
            pages: info.pages,
          },
        }),
      };
    } else {
      // 指定ページのPresigned URLを取得
      const info = await getPreviewPages(baseFileName);
      
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
      
      const page = Math.min(Math.max(1, parseInt(pageNumber)), info.totalPages);
      const previewUrl = await getPreviewUrl(baseFileName, page);
      
      // 全ページのURLを生成（オプション）
      const allPageUrls = await Promise.all(
        info.pages.map(async (p) => ({
          pageNumber: p.pageNumber,
          url: await getPreviewUrl(baseFileName, p.pageNumber),
          size: p.size,
        }))
      );
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: {
            fileName: baseFileName,
            currentPage: page,
            totalPages: info.totalPages,
            previewUrl,
            allPages: allPageUrls,
          },
        }),
      };
    }
  } catch (error) {
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
