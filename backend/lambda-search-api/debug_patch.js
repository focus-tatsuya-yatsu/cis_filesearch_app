// デバッグ用: 結果のfile_type値をログ出力
const sampleTypes = response.body.hits.hits.slice(0, 10).map(h => h._source.file_type);
console.log('Sample file_type values:', JSON.stringify(sampleTypes));
