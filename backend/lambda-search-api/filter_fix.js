function buildFilterQuery(params) {
  const filters = [];
  
  // カテゴリフィルター（道路/構造）- wildcardを使用
  if (params.categories && params.categories.length > 0) {
    const categoryFilters = params.categories.map(cat => {
      if (cat === 'road') {
        return { wildcard: { "filePath.keyword": "*documents/road/*" } };
      } else if (cat === 'structure') {
        return { wildcard: { "filePath.keyword": "*documents/structure/*" } };
      }
      return null;
    }).filter(f => f !== null);
    
    if (categoryFilters.length > 0) {
      filters.push({ bool: { should: categoryFilters, minimum_should_match: 1 } });
    }
  }
  
  // フォルダフィルター - wildcardを使用
  if (params.folders && params.folders.length > 0) {
    const folderFilters = params.folders.map(folder => ({
      wildcard: { "filePath.keyword": `*/${folder}/*` }
    }));
    filters.push({ bool: { should: folderFilters, minimum_should_match: 1 } });
  }
  
  // ファイルタイプフィルター
  if (params.fileType && params.fileType !== 'all') {
    const typeMapping = {
      'pdf': ['pdf'],
      'xlsx': ['xlsx', 'xls'],
      'docx': ['docx', 'doc'],
      'pptx': ['pptx', 'ppt'],
      'xdw': ['xdw'],
      'image': ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff'],
      'other': []
    };
    
    const extensions = typeMapping[params.fileType];
    if (extensions && extensions.length > 0) {
      const typeFilters = extensions.map(ext => ({
        wildcard: { "fileName.keyword": `*.${ext}` }
      }));
      filters.push({ bool: { should: typeFilters, minimum_should_match: 1 } });
    }
  }
  
  // 日付フィルター
  if (params.dateFrom || params.dateTo) {
    const dateField = params.dateFilterType === 'modification' ? 'modified_date' : 'created_date';
    const dateFilter = { range: { [dateField]: {} } };
    if (params.dateFrom) dateFilter.range[dateField].gte = params.dateFrom;
    if (params.dateTo) dateFilter.range[dateField].lte = params.dateTo;
    filters.push(dateFilter);
  }
  
  return filters;
}
