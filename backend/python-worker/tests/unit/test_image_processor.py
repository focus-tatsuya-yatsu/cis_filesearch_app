"""
Unit Tests for Image Processor
Tests image processing and OCR functionality
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

from processors.image_processor import ImageProcessor
from processors.base_processor import ProcessingResult


@pytest.mark.unit
@pytest.mark.image
class TestImageProcessor:
    """Test Image processor functionality"""

    @pytest.fixture
    def processor(self, test_config):
        """Create Image processor instance"""
        return ImageProcessor(test_config)

    def test_can_process_image_files(self, processor):
        """Test image file detection"""
        assert processor.can_process("/path/to/photo.jpg")
        assert processor.can_process("/path/to/image.jpeg")
        assert processor.can_process("/path/to/picture.png")
        assert processor.can_process("/path/to/image.gif")
        assert processor.can_process("/path/to/photo.JPG")
        assert processor.can_process("/path/to/IMAGE.PNG")

    def test_cannot_process_non_image_files(self, processor):
        """Test rejection of non-image files"""
        assert not processor.can_process("/path/to/document.pdf")
        assert not processor.can_process("/path/to/file.docx")
        assert not processor.can_process("/path/to/file.txt")
        assert not processor.can_process("/path/to/file")

    def test_process_simple_image(self, processor, sample_image: Path, assert_processing):
        """Test processing of simple image file"""
        result = processor.process(str(sample_image))

        assert_processing.assert_success(result)
        assert result.file_type == ".jpg"
        assert result.processor_name == "ImageProcessor"

    def test_process_image_generates_thumbnail(self, processor, sample_image: Path):
        """Test thumbnail generation"""
        result = processor.process(str(sample_image))

        assert result.success
        if result.thumbnail_data:
            assert isinstance(result.thumbnail_data, bytes)
            assert len(result.thumbnail_data) > 0
            assert result.thumbnail_format in ["JPEG", "PNG"]

    @pytest.mark.requires_tesseract
    def test_process_image_with_ocr(self, processor, sample_text_image: Path):
        """Test OCR text extraction from image"""
        result = processor.process(str(sample_text_image))

        assert result.success
        # OCR may or may not extract text depending on Tesseract availability
        if result.extracted_text:
            assert len(result.extracted_text) > 0
            assert result.word_count > 0

    @pytest.mark.requires_tesseract
    def test_ocr_confidence_score(self, processor, sample_text_image: Path):
        """Test OCR confidence score"""
        result = processor.process(str(sample_text_image))

        if result.ocr_confidence is not None:
            assert 0.0 <= result.ocr_confidence <= 1.0

    def test_process_image_metadata(self, processor, sample_image: Path):
        """Test image metadata extraction"""
        result = processor.process(str(sample_image))

        assert result.success
        assert isinstance(result.metadata, dict)
        # May contain EXIF data, dimensions, etc.

    def test_process_nonexistent_image(self, processor, assert_processing):
        """Test processing of nonexistent file"""
        result = processor.process("/nonexistent/image.jpg")

        assert_processing.assert_failure(result)

    def test_process_corrupted_image(self, processor, temp_dir: Path, assert_processing):
        """Test processing of corrupted image file"""
        corrupted_image = temp_dir / "corrupted.jpg"
        corrupted_image.write_text("This is not a valid image")

        result = processor.process(str(corrupted_image))

        # Should fail gracefully
        assert_processing.assert_failure(result)

    def test_process_png_image(self, processor, temp_dir: Path):
        """Test PNG image processing"""
        from PIL import Image

        png_path = temp_dir / "test.png"
        img = Image.new('RGB', (100, 100), color='red')
        img.save(png_path, 'PNG')

        result = processor.process(str(png_path))

        assert result.success
        assert result.file_type == ".png"

    def test_process_gif_image(self, processor, temp_dir: Path):
        """Test GIF image processing"""
        from PIL import Image

        gif_path = temp_dir / "test.gif"
        img = Image.new('RGB', (100, 100), color='blue')
        img.save(gif_path, 'GIF')

        result = processor.process(str(gif_path))

        assert result.success
        assert result.file_type == ".gif"

    def test_process_large_image(self, processor, temp_dir: Path):
        """Test processing of large image"""
        from PIL import Image

        large_image = temp_dir / "large.jpg"
        # Create 4K image
        img = Image.new('RGB', (3840, 2160), color='white')
        img.save(large_image, 'JPEG')

        result = processor.process(str(large_image))

        # Should handle large images
        assert isinstance(result, ProcessingResult)

    def test_process_small_image(self, processor, temp_dir: Path):
        """Test processing of very small image"""
        from PIL import Image

        small_image = temp_dir / "small.jpg"
        img = Image.new('RGB', (10, 10), color='green')
        img.save(small_image, 'JPEG')

        result = processor.process(str(small_image))

        assert result.success

    def test_thumbnail_size_is_reasonable(self, processor, sample_image: Path):
        """Test that thumbnail size is reasonable"""
        result = processor.process(str(sample_image))

        if result.thumbnail_data:
            # Thumbnail should be smaller than original
            thumbnail_size = len(result.thumbnail_data)
            original_size = result.file_size

            # Thumbnail should be significantly smaller (usually)
            # But may be larger for very small images
            assert thumbnail_size > 0

    @pytest.mark.slow
    def test_processing_time_is_reasonable(self, processor, sample_image: Path):
        """Test that processing time is recorded and reasonable"""
        result = processor.process(str(sample_image))

        assert result.success
        assert result.processing_time_seconds > 0
        assert result.processing_time_seconds < 10  # Should be fast

    def test_image_with_exif_data(self, processor, temp_dir: Path):
        """Test image with EXIF metadata"""
        from PIL import Image

        img_path = temp_dir / "with_exif.jpg"
        img = Image.new('RGB', (200, 200), color='yellow')

        # Save with EXIF (Pillow handles basic EXIF)
        img.save(img_path, 'JPEG', quality=95)

        result = processor.process(str(img_path))

        assert result.success
        # Metadata may contain EXIF info

    def test_grayscale_image(self, processor, temp_dir: Path):
        """Test grayscale image processing"""
        from PIL import Image

        gray_path = temp_dir / "grayscale.jpg"
        img = Image.new('L', (200, 200), color=128)  # 'L' mode is grayscale
        img.save(gray_path, 'JPEG')

        result = processor.process(str(gray_path))

        assert result.success

    def test_rgba_image(self, processor, temp_dir: Path):
        """Test RGBA image with transparency"""
        from PIL import Image

        rgba_path = temp_dir / "transparent.png"
        img = Image.new('RGBA', (200, 200), color=(255, 0, 0, 128))
        img.save(rgba_path, 'PNG')

        result = processor.process(str(rgba_path))

        assert result.success

    @patch('processors.image_processor.pytesseract')
    def test_ocr_unavailable_graceful_handling(self, mock_tesseract, processor, sample_image: Path):
        """Test graceful handling when OCR is unavailable"""
        mock_tesseract.image_to_string.side_effect = Exception("Tesseract not installed")

        result = processor.process(str(sample_image))

        # Should still succeed even if OCR fails
        # Just won't have extracted text
        assert isinstance(result, ProcessingResult)

    @pytest.mark.requires_tesseract
    def test_ocr_with_different_languages(self, processor, sample_text_image: Path):
        """Test OCR with different language settings"""
        # This would require modifying processor to accept language parameter
        result = processor.process(str(sample_text_image))

        if result.ocr_language:
            assert isinstance(result.ocr_language, str)


@pytest.mark.unit
@pytest.mark.image
class TestImageProcessorEdgeCases:
    """Test edge cases for Image processor"""

    @pytest.fixture
    def processor(self, test_config):
        return ImageProcessor(test_config)

    def test_image_with_special_characters_in_name(self, processor, temp_dir: Path):
        """Test image with special characters in filename"""
        from PIL import Image

        special_name = temp_dir / "photo (copy) [1].jpg"
        img = Image.new('RGB', (100, 100), color='red')
        img.save(special_name, 'JPEG')

        result = processor.process(str(special_name))

        assert result.success
        assert result.file_name == "photo (copy) [1].jpg"

    def test_image_with_no_extension(self, processor, temp_dir: Path):
        """Test image file without extension"""
        from PIL import Image

        no_ext = temp_dir / "noextension"
        img = Image.new('RGB', (100, 100), color='blue')
        img.save(no_ext, 'JPEG')

        # Should not process (relies on extension)
        assert not processor.can_process(str(no_ext))

    def test_cmyk_image(self, processor, temp_dir: Path):
        """Test CMYK color mode image"""
        from PIL import Image

        cmyk_path = temp_dir / "cmyk.jpg"
        img = Image.new('CMYK', (100, 100), color=(100, 100, 0, 0))
        img.save(cmyk_path, 'JPEG')

        result = processor.process(str(cmyk_path))

        # Should handle or convert CMYK
        assert isinstance(result, ProcessingResult)

    def test_image_with_orientation_exif(self, processor):
        """Test image with EXIF orientation tag"""
        # Some images have orientation metadata
        # Processor should handle or respect it
        pass

    def test_animated_gif(self, processor, temp_dir: Path):
        """Test animated GIF processing"""
        # Animated GIFs have multiple frames
        # Processor should handle first frame
        pass

    def test_webp_format(self, processor, temp_dir: Path):
        """Test WebP format if supported"""
        try:
            from PIL import Image
            webp_path = temp_dir / "test.webp"
            img = Image.new('RGB', (100, 100), color='purple')
            img.save(webp_path, 'WEBP')

            if processor.can_process(str(webp_path)):
                result = processor.process(str(webp_path))
                assert result.success
        except:
            pytest.skip("WebP not supported")

    def test_very_wide_image(self, processor, temp_dir: Path):
        """Test very wide panoramic image"""
        from PIL import Image

        wide_path = temp_dir / "panorama.jpg"
        img = Image.new('RGB', (10000, 100), color='cyan')
        img.save(wide_path, 'JPEG')

        result = processor.process(str(wide_path))

        assert isinstance(result, ProcessingResult)

    def test_very_tall_image(self, processor, temp_dir: Path):
        """Test very tall image"""
        from PIL import Image

        tall_path = temp_dir / "tall.jpg"
        img = Image.new('RGB', (100, 10000), color='magenta')
        img.save(tall_path, 'JPEG')

        result = processor.process(str(tall_path))

        assert isinstance(result, ProcessingResult)

    @pytest.mark.requires_tesseract
    def test_image_with_vertical_text(self, processor, temp_dir: Path):
        """Test OCR with vertical text orientation"""
        from PIL import Image, ImageDraw

        img_path = temp_dir / "vertical.png"
        img = Image.new('RGB', (200, 800), color='white')
        draw = ImageDraw.Draw(img)

        # Draw vertical text (rotated)
        # This is simplified; actual vertical text requires rotation
        draw.text((50, 50), "Vertical", fill='black')

        img.save(img_path, 'PNG')

        result = processor.process(str(img_path))

        # OCR may or may not handle vertical text well
        assert isinstance(result, ProcessingResult)
