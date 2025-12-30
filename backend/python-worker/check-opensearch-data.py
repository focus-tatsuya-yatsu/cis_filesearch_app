#!/usr/bin/env python3
"""
OpenSearchにデータが登録されているか確認（SSMポートフォワーディング経由）
"""

import subprocess
import time
import json
import requests
from datetime import datetime

def start_port_forwarding():
    """SSM経由でOpenSearchへのポートフォワーディングを開始"""
    print(f"[{datetime.now()}] SSMポートフォワーディング開始...")

    # バックグラウンドでポートフォワーディングを開始
    cmd = [
        "aws", "ssm", "start-session",
        "--target", "i-0e6ac1e4d535a4ab2",
        "--document-name", "AWS-StartPortForwardingSessionToRemoteHost",
        "--parameters", '{"host":["vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"],"portNumber":["443"],"localPortNumber":["9200"]}',
        "--region", "ap-northeast-1"
    ]

    try:
        # バックグラウンドプロセスとして起動
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        print("⏳ ポートフォワーディング確立中（5秒待機）...")
        time.sleep(5)

        # プロセスが生きているか確認
        if proc.poll() is None:
            print("✅ ポートフォワーディング確立")
            return proc
        else:
            print("❌ ポートフォワーディング失敗")
            return None

    except Exception as e:
        print(f"❌ エラー: {e}")
        return None

def check_opensearch():
    """OpenSearchのデータを確認"""
    print(f"\n[{datetime.now()}] OpenSearchデータ確認...")
    print("=" * 60)

    base_url = "http://localhost:9200"
    index_name = "file-metadata"

    try:
        # インデックスの存在確認
        response = requests.get(f"{base_url}/{index_name}", timeout=5)

        if response.status_code == 200:
            print(f"✅ インデックス '{index_name}' が存在します")
            index_info = response.json()

            # ドキュメント数を確認
            count_response = requests.get(f"{base_url}/{index_name}/_count")
            if count_response.status_code == 200:
                count_data = count_response.json()
                doc_count = count_data.get('count', 0)
                print(f"📊 ドキュメント数: {doc_count}")

                if doc_count > 0:
                    print("\n📄 最新のドキュメント（最大5件）:")
                    print("-" * 40)

                    # 最新のドキュメントを取得
                    search_query = {
                        "query": {"match_all": {}},
                        "size": 5,
                        "sort": [{"timestamp": {"order": "desc", "missing": "_last"}}]
                    }

                    search_response = requests.post(
                        f"{base_url}/{index_name}/_search",
                        json=search_query,
                        headers={"Content-Type": "application/json"}
                    )

                    if search_response.status_code == 200:
                        search_data = search_response.json()
                        hits = search_data.get('hits', {}).get('hits', [])

                        for i, hit in enumerate(hits, 1):
                            source = hit.get('_source', {})
                            print(f"\n{i}. {source.get('file_name', 'N/A')}")
                            print(f"   Type: {source.get('file_type', 'N/A')}")
                            print(f"   Path: {source.get('file_path', 'N/A')}")
                            print(f"   Size: {source.get('file_size', 0)} bytes")
                            print(f"   Status: {source.get('processing_status', 'N/A')}")

                            # DocuWorksファイルの場合、関連ファイル情報も表示
                            if source.get('is_docuworks'):
                                related = source.get('docuworks_related', {})
                                print(f"   📄 DocuWorksファイル:")
                                print(f"      Original: {related.get('original_file', 'N/A')}")
                                print(f"      PDF: {related.get('pdf_file', 'N/A')}")
                                print(f"      Text: {related.get('text_file', 'N/A')}")

                            if source.get('content'):
                                content_preview = source['content'][:100] + "..." if len(source['content']) > 100 else source['content']
                                print(f"   Content: {content_preview}")

                    # ファイルタイプ別の集計
                    agg_query = {
                        "size": 0,
                        "aggs": {
                            "file_types": {
                                "terms": {
                                    "field": "file_type",
                                    "size": 20
                                }
                            }
                        }
                    }

                    agg_response = requests.post(
                        f"{base_url}/{index_name}/_search",
                        json=agg_query,
                        headers={"Content-Type": "application/json"}
                    )

                    if agg_response.status_code == 200:
                        agg_data = agg_response.json()
                        buckets = agg_data.get('aggregations', {}).get('file_types', {}).get('buckets', [])

                        if buckets:
                            print("\n📊 ファイルタイプ別統計:")
                            print("-" * 40)
                            for bucket in buckets:
                                print(f"  .{bucket['key']}: {bucket['doc_count']}件")

                            # DocuWorksファイルの検索
                            docuworks_query = {
                                "query": {
                                    "term": {"is_docuworks": True}
                                }
                            }

                            dw_response = requests.post(
                                f"{base_url}/{index_name}/_search",
                                json=docuworks_query,
                                headers={"Content-Type": "application/json"}
                            )

                            if dw_response.status_code == 200:
                                dw_data = dw_response.json()
                                dw_count = dw_data.get('hits', {}).get('total', {}).get('value', 0)
                                if dw_count > 0:
                                    print(f"\n📄 DocuWorksファイル: {dw_count}件")
                                    print("   紐付け情報が保存されています")

                else:
                    print("⚠️ ドキュメントがまだ登録されていません")

        elif response.status_code == 404:
            print(f"❌ インデックス '{index_name}' が存在しません")
            print("   Workerがまだインデックスを作成していない可能性があります")
        else:
            print(f"❌ エラー: HTTP {response.status_code}")

    except requests.exceptions.ConnectionError:
        print("❌ OpenSearchに接続できません")
        print("   ポートフォワーディングが確立されていない可能性があります")
        print("\n手動でポートフォワーディングを開始してください:")
        print("./ssm-connect.sh")
        print("オプション9を選択")
    except Exception as e:
        print(f"❌ エラー: {e}")

    print("\n" + "=" * 60)

def main():
    print("OpenSearchデータ確認ツール")
    print("=" * 60)

    # 方法1: 直接チェック（ポートフォワーディングが既に確立されている場合）
    print("\n方法1: 直接確認を試みます...")
    check_opensearch()

    # 方法2: CloudWatch Logsで確認
    print("\n方法2: CloudWatch Logsで処理ログを確認...")
    print("以下のコマンドを実行してください:")
    print("```bash")
    print("aws logs tail /aws/ec2/instance/i-0e6ac1e4d535a4ab2 --follow --region ap-northeast-1")
    print("```")

    print("\n💡 ヒント:")
    print("1. SSMポートフォワーディングを手動で開始:")
    print("   ./ssm-connect.sh (オプション9)")
    print("")
    print("2. 別のターミナルでこのスクリプトを再実行:")
    print("   python3 check-opensearch-data.py")

if __name__ == "__main__":
    main()