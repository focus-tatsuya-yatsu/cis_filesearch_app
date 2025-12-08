using Xunit;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using DocuWorksConverter.Services;
using DocuWorksConverter.Interfaces;

namespace DocuWorksConverter.Tests.Services
{
    /// <summary>
    /// Unit tests for MockDocuWorksProcessor
    /// Tests the mock implementation before Day 3 real implementation
    /// Coverage Target: 100% (Critical component)
    /// </summary>
    public class MockDocuWorksProcessorTests : IDisposable
    {
        private readonly Mock<ILogger<MockDocuWorksProcessor>> _mockLogger;
        private readonly IDocuWorksProcessor _processor;
        private readonly List<string> _testFilesToCleanup;

        public MockDocuWorksProcessorTests()
        {
            _mockLogger = new Mock<ILogger<MockDocuWorksProcessor>>();
            _processor = new MockDocuWorksProcessor(_mockLogger.Object);
            _testFilesToCleanup = new List<string>();
        }

        public void Dispose()
        {
            // Cleanup all test files
            foreach (var file in _testFilesToCleanup)
            {
                if (File.Exists(file))
                {
                    try
                    {
                        File.Delete(file);
                    }
                    catch
                    {
                        // Ignore cleanup errors
                    }
                }
            }
        }

        #region Happy Path Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ConvertToPdf_WithValidXdwFile_ShouldReturnPdfPath()
        {
            // Arrange
            var testXdwPath = CreateTestFile("test.xdw", new byte[] { 0x58, 0x44, 0x57, 0x46 });

            // Act
            var pdfPath = await _processor.ConvertToPdfAsync(testXdwPath);

            // Assert
            pdfPath.Should().NotBeNullOrEmpty("PDF path should be returned");
            File.Exists(pdfPath).Should().BeTrue("PDF file should exist");
            Path.GetExtension(pdfPath).Should().Be(".pdf", "Output should have .pdf extension");

            var fileInfo = new FileInfo(pdfPath);
            fileInfo.Length.Should().BeGreaterThan(0, "PDF file should not be empty");

            // Track for cleanup
            _testFilesToCleanup.Add(pdfPath);
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ConvertToPdf_ShouldCreatePdfWithCorrectNaming()
        {
            // Arrange
            var testXdwPath = CreateTestFile("document_2025.xdw", new byte[] { 0x58, 0x44, 0x57, 0x46 });

            // Act
            var pdfPath = await _processor.ConvertToPdfAsync(testXdwPath);

            // Assert
            var expectedPdfName = "document_2025.pdf";
            Path.GetFileName(pdfPath).Should().Be(expectedPdfName, "PDF should have same base name as XDW");

            _testFilesToCleanup.Add(pdfPath);
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ConvertToPdf_ShouldCreatePdfInSameDirectory()
        {
            // Arrange
            var testDirectory = Path.Combine(Path.GetTempPath(), "docuworks-test-" + Guid.NewGuid().ToString());
            Directory.CreateDirectory(testDirectory);

            var testXdwPath = Path.Combine(testDirectory, "test.xdw");
            await File.WriteAllBytesAsync(testXdwPath, new byte[] { 0x58, 0x44, 0x57, 0x46 });
            _testFilesToCleanup.Add(testXdwPath);

            // Act
            var pdfPath = await _processor.ConvertToPdfAsync(testXdwPath);

            // Assert
            Path.GetDirectoryName(pdfPath).Should().Be(testDirectory, "PDF should be in same directory as source XDW");

            _testFilesToCleanup.Add(pdfPath);
            Directory.Delete(testDirectory, true);
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ConvertToPdf_ShouldCompleteWithinReasonableTime()
        {
            // Arrange
            var testXdwPath = CreateTestFile("performance-test.xdw", new byte[] { 0x58, 0x44, 0x57, 0x46 });
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();

            // Act
            var pdfPath = await _processor.ConvertToPdfAsync(testXdwPath);
            stopwatch.Stop();

            // Assert
            stopwatch.ElapsedMilliseconds.Should().BeLessThan(5000, "Mock conversion should complete in < 5 seconds");

            _testFilesToCleanup.Add(pdfPath);
        }

        #endregion

        #region Error Handling Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ConvertToPdf_WithNonExistentFile_ShouldThrowFileNotFoundException()
        {
            // Arrange
            var nonExistentPath = Path.Combine(Path.GetTempPath(), "nonexistent-" + Guid.NewGuid() + ".xdw");

            // Act & Assert
            await Assert.ThrowsAsync<FileNotFoundException>(
                async () => await _processor.ConvertToPdfAsync(nonExistentPath)
            );
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ConvertToPdf_WithInvalidExtension_ShouldThrowArgumentException()
        {
            // Arrange
            var invalidPath = CreateTestFile("test.txt", new byte[] { 0x00, 0x01, 0x02 });

            // Act & Assert
            var exception = await Assert.ThrowsAsync<ArgumentException>(
                async () => await _processor.ConvertToPdfAsync(invalidPath)
            );

            exception.Message.Should().Contain("xdw", "Error message should indicate .xdw extension required");
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ConvertToPdf_WithNullPath_ShouldThrowArgumentNullException()
        {
            // Act & Assert
            await Assert.ThrowsAsync<ArgumentNullException>(
                async () => await _processor.ConvertToPdfAsync(null!)
            );
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ConvertToPdf_WithEmptyPath_ShouldThrowArgumentException()
        {
            // Act & Assert
            await Assert.ThrowsAsync<ArgumentException>(
                async () => await _processor.ConvertToPdfAsync(string.Empty)
            );
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ConvertToPdf_WithWhitespacePath_ShouldThrowArgumentException()
        {
            // Act & Assert
            await Assert.ThrowsAsync<ArgumentException>(
                async () => await _processor.ConvertToPdfAsync("   ")
            );
        }

        #endregion

        #region Filename Variation Tests

        [Theory]
        [Trait("Category", "Unit")]
        [InlineData("simple.xdw")]
        [InlineData("document.XDW")]
        [InlineData("Document.Xdw")]
        [InlineData("file_with_underscore.xdw")]
        [InlineData("file-with-dash.xdw")]
        [InlineData("file.with.dots.xdw")]
        [InlineData("file 123.xdw")]
        [InlineData("ファイル名.xdw")] // Japanese
        [InlineData("文档.xdw")] // Chinese
        [InlineData("файл.xdw")] // Russian
        public async Task ConvertToPdf_WithVariousFilenames_ShouldSucceed(string filename)
        {
            // Arrange
            var testPath = CreateTestFile(filename, new byte[] { 0x58, 0x44, 0x57, 0x46 });

            // Act
            var pdfPath = await _processor.ConvertToPdfAsync(testPath);

            // Assert
            pdfPath.Should().NotBeNullOrEmpty();
            File.Exists(pdfPath).Should().BeTrue();
            Path.GetExtension(pdfPath).Should().Be(".pdf");

            _testFilesToCleanup.Add(pdfPath);
        }

        [Theory]
        [Trait("Category", "Unit")]
        [InlineData("UPPERCASE.XDW")]
        [InlineData("lowercase.xdw")]
        [InlineData("MixedCase.XdW")]
        public async Task ConvertToPdf_WithDifferentCasing_ShouldSucceed(string filename)
        {
            // Arrange
            var testPath = CreateTestFile(filename, new byte[] { 0x58, 0x44, 0x57, 0x46 });

            // Act
            var pdfPath = await _processor.ConvertToPdfAsync(testPath);

            // Assert
            File.Exists(pdfPath).Should().BeTrue("Conversion should succeed regardless of extension casing");

            _testFilesToCleanup.Add(pdfPath);
        }

        #endregion

        #region File Size Tests

        [Theory]
        [Trait("Category", "Unit")]
        [InlineData(100)]           // 100 bytes
        [InlineData(1024)]          // 1 KB
        [InlineData(10240)]         // 10 KB
        [InlineData(102400)]        // 100 KB
        [InlineData(1048576)]       // 1 MB
        public async Task ConvertToPdf_WithVariousFileSizes_ShouldSucceed(int fileSize)
        {
            // Arrange
            var testData = new byte[fileSize];
            new Random(42).NextBytes(testData);
            var testPath = CreateTestFile($"size-test-{fileSize}.xdw", testData);

            // Act
            var pdfPath = await _processor.ConvertToPdfAsync(testPath);

            // Assert
            File.Exists(pdfPath).Should().BeTrue("Conversion should succeed for various file sizes");
            new FileInfo(pdfPath).Length.Should().BeGreaterThan(0, "Generated PDF should not be empty");

            _testFilesToCleanup.Add(pdfPath);
        }

        #endregion

        #region Logging Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ConvertToPdf_ShouldLogConversionStart()
        {
            // Arrange
            var testPath = CreateTestFile("log-test.xdw", new byte[] { 0x58, 0x44, 0x57, 0x46 });

            // Act
            await _processor.ConvertToPdfAsync(testPath);

            // Assert
            _mockLogger.Verify(
                x => x.Log(
                    LogLevel.Information,
                    It.IsAny<EventId>(),
                    It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains("Converting") || v.ToString()!.Contains("Starting")),
                    It.IsAny<Exception>(),
                    It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
                Times.AtLeastOnce,
                "Should log conversion start");
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ConvertToPdf_ShouldLogConversionCompletion()
        {
            // Arrange
            var testPath = CreateTestFile("log-completion-test.xdw", new byte[] { 0x58, 0x44, 0x57, 0x46 });

            // Act
            await _processor.ConvertToPdfAsync(testPath);

            // Assert
            _mockLogger.Verify(
                x => x.Log(
                    LogLevel.Information,
                    It.IsAny<EventId>(),
                    It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains("Completed") || v.ToString()!.Contains("Success")),
                    It.IsAny<Exception>(),
                    It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
                Times.AtLeastOnce,
                "Should log conversion completion");
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ConvertToPdf_WhenError_ShouldLogError()
        {
            // Arrange
            var nonExistentPath = Path.Combine(Path.GetTempPath(), "error-test.xdw");

            // Act & Assert
            try
            {
                await _processor.ConvertToPdfAsync(nonExistentPath);
            }
            catch (FileNotFoundException)
            {
                // Expected exception
            }

            _mockLogger.Verify(
                x => x.Log(
                    LogLevel.Error,
                    It.IsAny<EventId>(),
                    It.IsAny<It.IsAnyType>(),
                    It.IsAny<Exception>(),
                    It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
                Times.AtLeastOnce,
                "Should log error when conversion fails");
        }

        #endregion

        #region Concurrent Processing Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ConvertToPdf_WithConcurrentCalls_ShouldHandleCorrectly()
        {
            // Arrange
            var testFiles = Enumerable.Range(1, 5)
                .Select(i => CreateTestFile($"concurrent-{i}.xdw", new byte[] { 0x58, 0x44, 0x57, 0x46 }))
                .ToList();

            // Act
            var conversionTasks = testFiles.Select(file => _processor.ConvertToPdfAsync(file));
            var results = await Task.WhenAll(conversionTasks);

            // Assert
            results.Should().HaveCount(5, "All conversions should complete");
            results.Should().OnlyContain(path => File.Exists(path), "All PDFs should exist");
            results.Should().OnlyHaveUniqueItems("Each PDF should have unique path");

            foreach (var pdf in results)
            {
                _testFilesToCleanup.Add(pdf);
            }
        }

        #endregion

        #region Helper Methods

        private string CreateTestFile(string filename, byte[] content)
        {
            var testPath = Path.Combine(Path.GetTempPath(), filename);
            File.WriteAllBytes(testPath, content);
            _testFilesToCleanup.Add(testPath);
            return testPath;
        }

        #endregion
    }
}
