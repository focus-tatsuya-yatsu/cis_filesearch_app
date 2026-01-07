"""
Office File Converter Module
LibreOfficeを使用してOffice文書をPDFに変換
"""

import logging
import os
import subprocess
import tempfile
import shutil
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class OfficeConverter:
    """
    LibreOfficeを使用してOffice文書をPDFに変換するクラス

    対応フォーマット:
    - Word: .doc, .docx
    - Excel: .xls, .xlsx
    - PowerPoint: .ppt, .pptx
    - OpenDocument: .odt, .ods, .odp
    """

    SUPPORTED_EXTENSIONS = {
        '.doc', '.docx',      # Word
        '.xls', '.xlsx',      # Excel
        '.ppt', '.pptx',      # PowerPoint
        '.odt', '.ods', '.odp'  # OpenDocument
    }

    def __init__(self, libreoffice_path: Optional[str] = None):
        """
        初期化

        Args:
            libreoffice_path: LibreOfficeの実行ファイルパス（Noneの場合は自動検出）
        """
        self.libreoffice_path = libreoffice_path or self._find_libreoffice()

        if self.libreoffice_path:
            logger.info(f"OfficeConverter initialized with LibreOffice: {self.libreoffice_path}")
        else:
            logger.warning("LibreOffice not found. Office file conversion will not be available.")

    def _find_libreoffice(self) -> Optional[str]:
        """LibreOfficeの実行ファイルを検索"""
        # 一般的なパスを順番にチェック
        possible_paths = [
            'soffice',                                    # PATH内
            '/usr/bin/soffice',                          # Linux標準
            '/usr/bin/libreoffice',                      # Linux代替
            '/opt/libreoffice/program/soffice',          # Linux手動インストール
            '/Applications/LibreOffice.app/Contents/MacOS/soffice',  # macOS
            r'C:\Program Files\LibreOffice\program\soffice.exe',     # Windows
        ]

        for path in possible_paths:
            if shutil.which(path):
                return path

        # whichコマンドで検索
        try:
            result = subprocess.run(
                ['which', 'soffice'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except Exception:
            pass

        return None

    def is_available(self) -> bool:
        """LibreOfficeが利用可能かチェック"""
        return self.libreoffice_path is not None

    def can_convert(self, file_path: str) -> bool:
        """指定されたファイルを変換可能かチェック"""
        ext = Path(file_path).suffix.lower()
        return ext in self.SUPPORTED_EXTENSIONS

    def convert_to_pdf(
        self,
        input_path: str,
        output_dir: Optional[str] = None,
        timeout: int = 120
    ) -> Optional[str]:
        """
        Office文書をPDFに変換

        Args:
            input_path: 入力ファイルパス
            output_dir: 出力ディレクトリ（Noneの場合は一時ディレクトリ）
            timeout: タイムアウト秒数（デフォルト: 120秒）

        Returns:
            生成されたPDFのパス、失敗時はNone
        """
        if not self.is_available():
            logger.error("LibreOffice is not available")
            return None

        input_path = Path(input_path)

        if not input_path.exists():
            logger.error(f"Input file does not exist: {input_path}")
            return None

        if input_path.suffix.lower() not in self.SUPPORTED_EXTENSIONS:
            logger.warning(f"Unsupported file type: {input_path.suffix}")
            return None

        # 出力ディレクトリの設定
        cleanup_output_dir = False
        if output_dir is None:
            output_dir = tempfile.mkdtemp(prefix='office_convert_')
            cleanup_output_dir = True
        else:
            os.makedirs(output_dir, exist_ok=True)

        try:
            # LibreOfficeコマンドを構築
            cmd = [
                self.libreoffice_path,
                '--headless',           # GUIなしで実行
                '--invisible',          # ウィンドウを表示しない
                '--nologo',             # スプラッシュスクリーンなし
                '--nofirststartwizard', # 初回起動ウィザードをスキップ
                '--convert-to', 'pdf',
                '--outdir', output_dir,
                str(input_path)
            ]

            logger.info(f"Converting Office file to PDF: {input_path.name}")
            logger.debug(f"Command: {' '.join(cmd)}")

            # 変換実行
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                env={**os.environ, 'HOME': tempfile.gettempdir()}  # 一時HOMEディレクトリを使用
            )

            if result.returncode != 0:
                logger.error(f"LibreOffice conversion failed (return code: {result.returncode})")
                logger.error(f"stderr: {result.stderr}")
                logger.error(f"stdout: {result.stdout}")

                if cleanup_output_dir:
                    shutil.rmtree(output_dir, ignore_errors=True)
                return None

            # 生成されたPDFファイルを確認
            pdf_path = Path(output_dir) / f"{input_path.stem}.pdf"

            if pdf_path.exists():
                file_size = pdf_path.stat().st_size
                logger.info(f"Successfully converted to PDF: {pdf_path.name} ({file_size} bytes)")
                return str(pdf_path)

            # PDFが見つからない場合、ディレクトリ内を検索
            pdf_files = list(Path(output_dir).glob('*.pdf'))
            if pdf_files:
                pdf_path = pdf_files[0]
                logger.info(f"Found converted PDF: {pdf_path.name}")
                return str(pdf_path)

            logger.error(f"PDF file was not created. Expected: {pdf_path}")
            if cleanup_output_dir:
                shutil.rmtree(output_dir, ignore_errors=True)
            return None

        except subprocess.TimeoutExpired:
            logger.error(f"LibreOffice conversion timed out after {timeout}s for {input_path}")
            if cleanup_output_dir:
                shutil.rmtree(output_dir, ignore_errors=True)
            return None
        except Exception as e:
            logger.error(f"Office conversion failed: {str(e)}")
            if cleanup_output_dir:
                shutil.rmtree(output_dir, ignore_errors=True)
            return None

    def get_version(self) -> Optional[str]:
        """LibreOfficeのバージョンを取得"""
        if not self.is_available():
            return None

        try:
            result = subprocess.run(
                [self.libreoffice_path, '--version'],
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception as e:
            logger.debug(f"Failed to get LibreOffice version: {e}")

        return None
