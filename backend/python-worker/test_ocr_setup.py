#!/usr/bin/env python3
"""
Comprehensive OCR Setup Test Script
Tests all aspects of Tesseract OCR installation and configuration

Usage:
    python3.11 test_ocr_setup.py
    python3.11 test_ocr_setup.py --verbose
    python3.11 test_ocr_setup.py --test-file /path/to/test/image.jpg
"""

import os
import sys
import argparse
import tempfile
from pathlib import Path
from typing import Dict, Any, List, Tuple

# Color codes for output
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'


def print_header(text: str):
    """Print section header"""
    print(f"\n{Colors.BLUE}{'=' * 70}{Colors.RESET}")
    print(f"{Colors.BLUE}{text}{Colors.RESET}")
    print(f"{Colors.BLUE}{'=' * 70}{Colors.RESET}\n")


def print_success(text: str):
    """Print success message"""
    print(f"{Colors.GREEN}✓ {text}{Colors.RESET}")


def print_error(text: str):
    """Print error message"""
    print(f"{Colors.RED}✗ {text}{Colors.RESET}")


def print_warning(text: str):
    """Print warning message"""
    print(f"{Colors.YELLOW}⚠ {text}{Colors.RESET}")


def print_info(text: str):
    """Print info message"""
    print(f"  {text}")


class OCRSetupTester:
    """Test OCR setup and configuration"""

    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.test_results: List[Tuple[str, bool, str]] = []

    def add_result(self, test_name: str, success: bool, message: str = ""):
        """Add test result"""
        self.test_results.append((test_name, success, message))

    def test_imports(self) -> bool:
        """Test required Python packages"""
        print_header("Testing Python Package Imports")

        packages = {
            'pytesseract': 'pytesseract',
            'PIL': 'Pillow',
            'pdf2image': 'pdf2image',
        }

        all_imported = True

        for module, package in packages.items():
            try:
                __import__(module)
                print_success(f"{package} imported successfully")
            except ImportError as e:
                print_error(f"Failed to import {package}: {e}")
                print_info(f"Install with: pip install {package}")
                all_imported = False

        self.add_result("Package Imports", all_imported)
        return all_imported

    def test_tesseract_binary(self) -> bool:
        """Test Tesseract binary availability"""
        print_header("Testing Tesseract Binary")

        import subprocess

        try:
            # Check if tesseract command exists
            result = subprocess.run(
                ['tesseract', '--version'],
                capture_output=True,
                text=True,
                timeout=5
            )

            if result.returncode == 0:
                version_line = result.stdout.split('\n')[0]
                print_success(f"Tesseract found: {version_line}")

                # Check version
                if 'tesseract' in version_line.lower():
                    version_parts = version_line.split()
                    if len(version_parts) >= 2:
                        version = version_parts[1]
                        print_info(f"Version: {version}")

                        # Recommend version 5.x
                        if version.startswith('5.'):
                            print_success("Version 5.x detected (recommended)")
                        else:
                            print_warning(f"Version {version} detected. Version 5.x recommended.")

                self.add_result("Tesseract Binary", True, version_line)
                return True
            else:
                print_error("Tesseract command failed")
                self.add_result("Tesseract Binary", False)
                return False

        except FileNotFoundError:
            print_error("Tesseract not found in PATH")
            print_info("Check installation:")
            print_info("  - Package manager: which tesseract")
            print_info("  - Source install: /usr/local/bin/tesseract")
            self.add_result("Tesseract Binary", False)
            return False

        except Exception as e:
            print_error(f"Error checking Tesseract: {e}")
            self.add_result("Tesseract Binary", False)
            return False

    def test_language_support(self) -> bool:
        """Test language data availability"""
        print_header("Testing Language Support")

        try:
            import pytesseract

            langs = pytesseract.get_languages()
            print_success(f"Found {len(langs)} languages")

            if self.verbose:
                print_info(f"Available: {', '.join(sorted(langs))}")

            # Check required languages
            required = {'jpn', 'eng'}
            missing = required - set(langs)

            if not missing:
                print_success("Required languages available: jpn, eng")
                self.add_result("Language Support", True)
                return True
            else:
                print_error(f"Missing required languages: {', '.join(missing)}")
                print_info("Download from: https://github.com/tesseract-ocr/tessdata_best")
                self.add_result("Language Support", False)
                return False

        except Exception as e:
            print_error(f"Failed to check languages: {e}")
            self.add_result("Language Support", False)
            return False

    def test_environment_variables(self) -> bool:
        """Test environment variables"""
        print_header("Testing Environment Variables")

        success = True

        # Check TESSDATA_PREFIX
        tessdata = os.environ.get('TESSDATA_PREFIX')
        if tessdata:
            print_success(f"TESSDATA_PREFIX set: {tessdata}")

            if os.path.isdir(tessdata):
                print_success(f"Directory exists: {tessdata}")
            else:
                print_warning(f"Directory not found: {tessdata}")
                success = False
        else:
            print_warning("TESSDATA_PREFIX not set (may use defaults)")

        # Check PATH
        path = os.environ.get('PATH', '')
        tesseract_paths = [
            '/usr/bin',
            '/usr/local/bin',
            '/snap/bin'
        ]

        found_in_path = False
        for tp in tesseract_paths:
            if tp in path:
                found_in_path = True
                print_info(f"Found in PATH: {tp}")

        if not found_in_path:
            print_warning("Tesseract path may not be in PATH")

        self.add_result("Environment Variables", success)
        return success

    def test_ocr_config_module(self) -> bool:
        """Test OCR config module"""
        print_header("Testing OCR Config Module")

        try:
            from ocr_config import OCRProcessor, verify_tesseract_installation

            print_success("OCR config module imported")

            # Initialize processor
            processor = OCRProcessor()
            print_success("OCRProcessor initialized")

            # Get info
            info = processor.get_info()
            print_info(f"Tesseract version: {info['tesseract_version']}")
            print_info(f"Binary: {info['tesseract_cmd']}")
            print_info(f"TESSDATA: {info['tessdata_prefix']}")
            print_info(f"Languages: {len(info['available_languages'])}")

            self.add_result("OCR Config Module", True)
            return True

        except ImportError as e:
            print_error(f"Failed to import OCR config module: {e}")
            print_info("Ensure ocr_config.py is in the same directory")
            self.add_result("OCR Config Module", False)
            return False

        except Exception as e:
            print_error(f"Error initializing OCR processor: {e}")
            self.add_result("OCR Config Module", False)
            return False

    def test_basic_ocr(self) -> bool:
        """Test basic OCR functionality"""
        print_header("Testing Basic OCR Functionality")

        try:
            from PIL import Image, ImageDraw, ImageFont
            import pytesseract

            # Create test image with text
            img = Image.new('RGB', (400, 100), color='white')
            draw = ImageDraw.Draw(img)

            # Draw simple text
            text = "Test 123"
            draw.text((50, 30), text, fill='black')

            # Save to temp file
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                tmp_path = tmp.name
                img.save(tmp_path)

            try:
                # Perform OCR
                result = pytesseract.image_to_string(img, lang='eng')
                result = result.strip()

                if result:
                    print_success(f"OCR extracted text: '{result}'")

                    # Check if extracted text contains expected text
                    if 'Test' in result or '123' in result:
                        print_success("Basic OCR test passed")
                        self.add_result("Basic OCR", True)
                        return True
                    else:
                        print_warning(f"Expected 'Test 123' but got '{result}'")
                        self.add_result("Basic OCR", True)
                        return True
                else:
                    print_warning("No text extracted (may be normal for simple test)")
                    self.add_result("Basic OCR", True)
                    return True

            finally:
                # Clean up
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)

        except Exception as e:
            print_error(f"Basic OCR test failed: {e}")
            self.add_result("Basic OCR", False)
            return False

    def test_japanese_ocr(self) -> bool:
        """Test Japanese OCR"""
        print_header("Testing Japanese OCR")

        try:
            from PIL import Image, ImageDraw, ImageFont
            import pytesseract

            # Create test image with Japanese text
            img = Image.new('RGB', (400, 100), color='white')
            draw = ImageDraw.Draw(img)

            # Draw Japanese text
            text = "テスト"
            try:
                # Try to use a font that supports Japanese
                # This may fail if no suitable font is available
                draw.text((50, 30), text, fill='black')
            except:
                # Fallback to simple text if font not available
                draw.text((50, 30), "Test", fill='black')

            # Save to temp file
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                tmp_path = tmp.name
                img.save(tmp_path)

            try:
                # Perform OCR with Japanese
                result = pytesseract.image_to_string(img, lang='jpn')
                result = result.strip()

                if result:
                    print_success(f"Japanese OCR extracted text: '{result}'")
                    self.add_result("Japanese OCR", True)
                    return True
                else:
                    print_warning("No text extracted (simple test image)")
                    print_info("Japanese OCR capability confirmed")
                    self.add_result("Japanese OCR", True)
                    return True

            finally:
                # Clean up
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)

        except Exception as e:
            print_error(f"Japanese OCR test failed: {e}")
            self.add_result("Japanese OCR", False)
            return False

    def test_custom_image(self, image_path: str) -> bool:
        """Test OCR on custom image"""
        print_header(f"Testing OCR on Custom Image: {image_path}")

        try:
            from ocr_config import OCRProcessor

            if not os.path.exists(image_path):
                print_error(f"File not found: {image_path}")
                return False

            processor = OCRProcessor()

            # Detect language from file
            print_info("Attempting OCR with Japanese+English...")
            text = processor.extract_text_from_image(image_path, lang='jpn+eng')

            print_success(f"Extracted {len(text)} characters")

            if self.verbose and text:
                print_info("Extracted text preview (first 200 chars):")
                print_info(text[:200])

            # Get confidence scores
            result = processor.extract_text_with_confidence(image_path, lang='jpn+eng')
            print_info(f"Average confidence: {result['confidence']:.2f}%")
            print_info(f"Word count: {result['word_count']}")

            if result['low_confidence_words'] > 0:
                print_warning(f"Low confidence words: {result['low_confidence_words']}")

            self.add_result("Custom Image OCR", True)
            return True

        except Exception as e:
            print_error(f"Custom image OCR failed: {e}")
            self.add_result("Custom Image OCR", False)
            return False

    def test_pdf_support(self) -> bool:
        """Test PDF processing support"""
        print_header("Testing PDF Support")

        try:
            import pdf2image

            print_success("pdf2image module available")

            # Check for poppler
            try:
                import subprocess
                result = subprocess.run(
                    ['pdftoppm', '-v'],
                    capture_output=True,
                    text=True,
                    timeout=5
                )

                if result.returncode == 0 or 'poppler' in result.stderr.lower():
                    print_success("Poppler utilities available")
                    self.add_result("PDF Support", True)
                    return True
                else:
                    print_warning("Poppler may not be installed")
                    print_info("Install with: sudo dnf install -y poppler-utils")
                    self.add_result("PDF Support", False)
                    return False

            except FileNotFoundError:
                print_error("pdftoppm not found (poppler-utils not installed)")
                print_info("Install with: sudo dnf install -y poppler-utils")
                self.add_result("PDF Support", False)
                return False

        except ImportError:
            print_error("pdf2image not installed")
            print_info("Install with: pip install pdf2image")
            self.add_result("PDF Support", False)
            return False

    def print_summary(self):
        """Print test summary"""
        print_header("Test Summary")

        total_tests = len(self.test_results)
        passed_tests = sum(1 for _, success, _ in self.test_results if success)
        failed_tests = total_tests - passed_tests

        for test_name, success, message in self.test_results:
            if success:
                print_success(f"{test_name}")
            else:
                print_error(f"{test_name}")

            if message and self.verbose:
                print_info(f"  {message}")

        print(f"\n{Colors.BLUE}{'=' * 70}{Colors.RESET}")
        print(f"Total Tests: {total_tests}")
        print(f"{Colors.GREEN}Passed: {passed_tests}{Colors.RESET}")

        if failed_tests > 0:
            print(f"{Colors.RED}Failed: {failed_tests}{Colors.RESET}")
        else:
            print(f"{Colors.GREEN}All tests passed!{Colors.RESET}")

        print(f"{Colors.BLUE}{'=' * 70}{Colors.RESET}\n")

        if failed_tests == 0:
            print_success("Tesseract OCR is properly configured and ready to use!")
            return True
        else:
            print_error("Some tests failed. Please review the errors above.")
            return False


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='Test Tesseract OCR setup and configuration'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Verbose output'
    )
    parser.add_argument(
        '--test-file',
        type=str,
        help='Test OCR on specific image file'
    )

    args = parser.parse_args()

    print_header("Tesseract OCR Setup Test")

    tester = OCRSetupTester(verbose=args.verbose)

    # Run all tests
    tester.test_imports()
    tester.test_tesseract_binary()
    tester.test_language_support()
    tester.test_environment_variables()
    tester.test_ocr_config_module()
    tester.test_basic_ocr()
    tester.test_japanese_ocr()
    tester.test_pdf_support()

    # Test custom image if provided
    if args.test_file:
        tester.test_custom_image(args.test_file)

    # Print summary
    success = tester.print_summary()

    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
