#!/usr/bin/env python3
"""
Docuworksファイルの詳細分析
nas_path問題の調査
"""

import json
import boto3
from datetime import datetime
from collections import defaultdict

REGION = "ap-northeast-1"
LAMBDA_FUNCTION = "cis-search-api-prod"

def invoke_search_lambda(query: str, size: int = 10, search_mode: str = "or", file_type: str = None, page: int = 1):
    """Lambda関数を直接呼び出して検索"""
    client = boto3.client('lambda', region_name=REGION)

    query_params = {
        "q": query,
        "size": str(size),
        "limit": str(size),
        "page": str(page),
        "searchMode": search_mode
    }
    if file_type:
        query_params["fileType"] = file_type

    event = {
        "httpMethod": "GET",
        "path": "/search",
        "queryStringParameters": query_params,
        "headers": {},
        "body": None
    }

    response = client.invoke(
        FunctionName=LAMBDA_FUNCTION,
        InvocationType='RequestResponse',
        Payload=json.dumps(event)
    )

    result = json.loads(response['Payload'].read().decode('utf-8'))

    if result.get('statusCode') == 200:
        body = json.loads(result.get('body', '{}'))
        if body.get('success') and body.get('data'):
            return body['data']
        return body
    else:
        return None

def analyze_nas_path_issues():
    """nas_pathの問題を詳細に分析"""
    print("\n" + "=" * 70)
    print("Docuworks nas_path 詳細分析")
    print("=" * 70)

    # 複数ページにわたってサンプルを取得
    all_samples = []
    for page in range(1, 11):  # 10ページ分取得
        result = invoke_search_lambda(".xdw OR .xbd", size=100, search_mode="or", file_type="docuworks", page=page)
        if result and result.get('results'):
            all_samples.extend(result['results'])

    total_samples = len(all_samples)
    print(f"\n分析対象サンプル数: {total_samples}")

    # nas_pathの状態を分類
    nas_path_stats = {
        "has_nas_path": 0,
        "empty_nas_path": 0,
        "nas_path_with_ts_server": 0,
        "nas_path_without_ts_server": 0,
    }

    # ファイル名の状態
    file_name_stats = {
        "normal": 0,
        "empty_or_dot_only": 0,
    }

    # 問題のあるサンプル
    problematic_samples = []

    for r in all_samples:
        nas_path = r.get('nasPath', r.get('nas_path', ''))
        file_name = r.get('fileName', r.get('file_name', ''))
        file_path = r.get('filePath', r.get('file_path', ''))

        # nas_pathの分析
        if nas_path and nas_path.strip():
            nas_path_stats["has_nas_path"] += 1
            if 'ts-server' in nas_path:
                nas_path_stats["nas_path_with_ts_server"] += 1
            else:
                nas_path_stats["nas_path_without_ts_server"] += 1
                problematic_samples.append({
                    "type": "nas_path_no_ts_server",
                    "file_name": file_name,
                    "file_path": file_path,
                    "nas_path": nas_path
                })
        else:
            nas_path_stats["empty_nas_path"] += 1
            problematic_samples.append({
                "type": "empty_nas_path",
                "file_name": file_name,
                "file_path": file_path,
                "nas_path": nas_path
            })

        # ファイル名の分析
        if file_name and file_name.strip() and file_name not in ['.xdw', '.xbd']:
            file_name_stats["normal"] += 1
        else:
            file_name_stats["empty_or_dot_only"] += 1

    # 結果表示
    print("\n--- nas_path 統計 ---")
    print(f"nas_pathあり: {nas_path_stats['has_nas_path']} ({nas_path_stats['has_nas_path']/total_samples*100:.1f}%)")
    print(f"  - ts-server含む: {nas_path_stats['nas_path_with_ts_server']}")
    print(f"  - ts-server含まない: {nas_path_stats['nas_path_without_ts_server']}")
    print(f"nas_pathなし（空）: {nas_path_stats['empty_nas_path']} ({nas_path_stats['empty_nas_path']/total_samples*100:.1f}%)")

    print("\n--- ファイル名 統計 ---")
    print(f"正常なファイル名: {file_name_stats['normal']} ({file_name_stats['normal']/total_samples*100:.1f}%)")
    print(f"空または.xdw/.xbdのみ: {file_name_stats['empty_or_dot_only']} ({file_name_stats['empty_or_dot_only']/total_samples*100:.1f}%)")

    # 問題サンプルの表示
    print("\n--- 問題サンプル（最大20件） ---")
    for i, sample in enumerate(problematic_samples[:20], 1):
        print(f"\n{i}. [{sample['type']}]")
        print(f"   file_name: {sample['file_name']}")
        print(f"   file_path: {sample['file_path']}")
        print(f"   nas_path:  {sample['nas_path']}")

    return {
        "total_samples": total_samples,
        "nas_path_stats": nas_path_stats,
        "file_name_stats": file_name_stats,
        "problematic_count": len(problematic_samples)
    }

def analyze_server_distribution():
    """サーバー別のDocuworksファイル分布を正確に分析"""
    print("\n" + "=" * 70)
    print("サーバー別 Docuworks ファイル分布")
    print("=" * 70)

    servers = ["ts-server3", "ts-server5", "ts-server6", "ts-server7"]
    distribution = {}

    # 各サーバーでDocuworksファイルを検索
    for server in servers:
        # サーバー名とDocuworks拡張子を含むファイルを検索
        result = invoke_search_lambda(
            f"{server} AND (.xdw OR .xbd)",
            size=5,
            search_mode="and",
            file_type="docuworks"
        )

        if result:
            count = result.get('pagination', {}).get('total', 0)
            distribution[server] = count
            print(f"\n{server}:")
            print(f"  Docuworksファイル数: {count:,}")

            # サンプル表示
            if result.get('results'):
                print("  サンプル:")
                for r in result['results'][:3]:
                    file_name = r.get('fileName', r.get('file_name', 'N/A'))
                    nas_path = r.get('nasPath', r.get('nas_path', 'N/A'))
                    print(f"    - {file_name}")
                    if nas_path and nas_path != 'N/A':
                        has_ts_server = 'ts-server' in str(nas_path)
                        print(f"      nas_path: {nas_path[:80]}... [{has_ts_server and 'OK' or 'WARN'}]")

    return distribution

def main():
    print("=" * 70)
    print("Docuworks Files Detailed Analysis")
    print(f"実行日時: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    # 1. 総数確認
    print("\n" + "=" * 70)
    print("1. Docuworksファイル総数")
    print("=" * 70)

    xdw_result = invoke_search_lambda(".xdw", size=1, search_mode="or", file_type="docuworks")
    xbd_result = invoke_search_lambda(".xbd", size=1, search_mode="or", file_type="docuworks")

    xdw_count = xdw_result.get('pagination', {}).get('total', 0) if xdw_result else 0
    xbd_count = xbd_result.get('pagination', {}).get('total', 0) if xbd_result else 0

    print(f".xdw ファイル: {xdw_count:,}")
    print(f".xbd ファイル: {xbd_count:,}")
    print(f"合計: {xdw_count + xbd_count:,}")

    # 2. nas_path詳細分析
    nas_analysis = analyze_nas_path_issues()

    # 3. サーバー分布
    server_dist = analyze_server_distribution()

    # サマリー
    print("\n" + "=" * 70)
    print("分析サマリー")
    print("=" * 70)

    print(f"\n1. Docuworks総数: {xdw_count + xbd_count:,}")
    print(f"   - .xdw: {xdw_count:,}")
    print(f"   - .xbd: {xbd_count:,}")

    print(f"\n2. nas_path問題（サンプル{nas_analysis['total_samples']}件中）:")
    empty_pct = nas_analysis['nas_path_stats']['empty_nas_path'] / nas_analysis['total_samples'] * 100
    print(f"   - nas_pathが空: {nas_analysis['nas_path_stats']['empty_nas_path']}件 ({empty_pct:.1f}%)")

    if nas_analysis['nas_path_stats']['empty_nas_path'] > 0:
        # 全体での推定
        estimated_empty = int((xdw_count + xbd_count) * empty_pct / 100)
        print(f"   - 推定全体での空nas_path: 約{estimated_empty:,}件")

    print(f"\n3. サーバー別分布:")
    for server, count in server_dist.items():
        print(f"   - {server}: {count:,}件")

    print("\n" + "=" * 70)
    print("分析完了")
    print("=" * 70)

if __name__ == "__main__":
    main()
