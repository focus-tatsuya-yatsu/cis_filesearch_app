using Xunit;
using FluentAssertions;
using Moq;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Logging;
using DocuWorksConverter.Services;
using System.Net;

namespace DocuWorksConverter.Tests.Services
{
    /// <summary>
    /// Unit tests for S3Service
    /// Tests AWS S3 integration with mock AWS SDK
    /// Coverage Target: 85%+
    /// </summary>
    public class S3ServiceTests : IDisposable
    {
        private readonly Mock<IAmazonS3> _mockS3Client;
        private readonly Mock<ILogger<S3Service>> _mockLogger;
        private readonly S3Service _service;
        private readonly List<string> _testFilesToCleanup;

        private const string TestBucket = "docuworks-test-bucket";

        public S3ServiceTests()
        {
            _mockS3Client = new Mock<IAmazonS3>();
            _mockLogger = new Mock<ILogger<S3Service>>();
            _service = new S3Service(_mockS3Client.Object, _mockLogger.Object, TestBucket);
            _testFilesToCleanup = new List<string>();
        }

        public void Dispose()
        {
            foreach (var file in _testFilesToCleanup)
            {
                if (File.Exists(file))
                {
                    try { File.Delete(file); } catch { }
                }
            }
        }

        #region Upload Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task UploadFileAsync_WithValidFile_ShouldReturnS3Uri()
        {
            // Arrange
            var testFilePath = CreateTestFile("test-upload.pdf", new byte[] { 0x25, 0x50, 0x44, 0x46 });
            var expectedKey = $"converted/{Path.GetFileName(testFilePath)}";

            _mockS3Client
                .Setup(x => x.PutObjectAsync(It.IsAny<PutObjectRequest>(), default))
                .ReturnsAsync(new PutObjectResponse
                {
                    HttpStatusCode = HttpStatusCode.OK,
                    ETag = "\"test-etag\""
                });

            // Act
            var result = await _service.UploadFileAsync(testFilePath, "converted/");

            // Assert
            result.Should().NotBeNullOrEmpty("S3 URI should be returned");
            result.Should().Contain(TestBucket, "URI should contain bucket name");
            result.Should().Contain(expectedKey, "URI should contain the S3 key");

            _mockS3Client.Verify(
                x => x.PutObjectAsync(
                    It.Is<PutObjectRequest>(req =>
                        req.BucketName == TestBucket &&
                        req.Key == expectedKey &&
                        req.FilePath == testFilePath),
                    default),
                Times.Once,
                "Should call PutObjectAsync with correct parameters");
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task UploadFileAsync_WithMetadata_ShouldIncludeMetadata()
        {
            // Arrange
            var testFilePath = CreateTestFile("test-with-metadata.pdf", new byte[] { 0x25, 0x50, 0x44, 0x46 });
            var metadata = new Dictionary<string, string>
            {
                { "original-filename", "original.xdw" },
                { "conversion-timestamp", DateTime.UtcNow.ToString("o") },
                { "user-id", "test-user" }
            };

            _mockS3Client
                .Setup(x => x.PutObjectAsync(It.IsAny<PutObjectRequest>(), default))
                .ReturnsAsync(new PutObjectResponse { HttpStatusCode = HttpStatusCode.OK });

            // Act
            await _service.UploadFileAsync(testFilePath, "converted/", metadata);

            // Assert
            _mockS3Client.Verify(
                x => x.PutObjectAsync(
                    It.Is<PutObjectRequest>(req =>
                        req.Metadata["original-filename"] == "original.xdw" &&
                        req.Metadata.ContainsKey("conversion-timestamp") &&
                        req.Metadata["user-id"] == "test-user"),
                    default),
                Times.Once,
                "Should include metadata in upload request");
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task UploadFileAsync_WithNonExistentFile_ShouldThrowFileNotFoundException()
        {
            // Arrange
            var nonExistentPath = Path.Combine(Path.GetTempPath(), "nonexistent.pdf");

            // Act & Assert
            await Assert.ThrowsAsync<FileNotFoundException>(
                async () => await _service.UploadFileAsync(nonExistentPath, "converted/")
            );
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task UploadFileAsync_WhenS3Fails_ShouldThrowAmazonS3Exception()
        {
            // Arrange
            var testFilePath = CreateTestFile("test-failure.pdf", new byte[] { 0x25, 0x50, 0x44, 0x46 });

            _mockS3Client
                .Setup(x => x.PutObjectAsync(It.IsAny<PutObjectRequest>(), default))
                .ThrowsAsync(new AmazonS3Exception("S3 service unavailable"));

            // Act & Assert
            await Assert.ThrowsAsync<AmazonS3Exception>(
                async () => await _service.UploadFileAsync(testFilePath, "converted/")
            );
        }

        [Theory]
        [Trait("Category", "Unit")]
        [InlineData("")]
        [InlineData("source/")]
        [InlineData("converted/")]
        [InlineData("archive/2025/01/")]
        public async Task UploadFileAsync_WithDifferentPrefixes_ShouldUseCorrectKey(string prefix)
        {
            // Arrange
            var testFilePath = CreateTestFile("test-prefix.pdf", new byte[] { 0x25, 0x50, 0x44, 0x46 });
            var expectedKey = prefix + Path.GetFileName(testFilePath);

            _mockS3Client
                .Setup(x => x.PutObjectAsync(It.IsAny<PutObjectRequest>(), default))
                .ReturnsAsync(new PutObjectResponse { HttpStatusCode = HttpStatusCode.OK });

            // Act
            await _service.UploadFileAsync(testFilePath, prefix);

            // Assert
            _mockS3Client.Verify(
                x => x.PutObjectAsync(
                    It.Is<PutObjectRequest>(req => req.Key == expectedKey),
                    default),
                Times.Once);
        }

        #endregion

        #region Download Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task DownloadFileAsync_WithValidKey_ShouldSaveToLocalPath()
        {
            // Arrange
            var testKey = "source/test.xdw";
            var localPath = Path.Combine(Path.GetTempPath(), "downloaded-" + Guid.NewGuid() + ".xdw");
            _testFilesToCleanup.Add(localPath);

            var testContent = new byte[] { 0x58, 0x44, 0x57, 0x46, 0x01, 0x02, 0x03 };
            var memoryStream = new MemoryStream(testContent);

            var getObjectResponse = new GetObjectResponse
            {
                ResponseStream = memoryStream,
                HttpStatusCode = HttpStatusCode.OK,
                ContentLength = testContent.Length
            };

            _mockS3Client
                .Setup(x => x.GetObjectAsync(It.IsAny<GetObjectRequest>(), default))
                .ReturnsAsync(getObjectResponse);

            // Act
            var result = await _service.DownloadFileAsync(testKey, localPath);

            // Assert
            result.Should().Be(localPath, "Should return the local path");
            File.Exists(localPath).Should().BeTrue("File should exist at local path");

            var downloadedContent = await File.ReadAllBytesAsync(localPath);
            downloadedContent.Should().BeEquivalentTo(testContent, "Downloaded content should match original");

            _mockS3Client.Verify(
                x => x.GetObjectAsync(
                    It.Is<GetObjectRequest>(req =>
                        req.BucketName == TestBucket &&
                        req.Key == testKey),
                    default),
                Times.Once);
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task DownloadFileAsync_WithNonExistentKey_ShouldThrowAmazonS3Exception()
        {
            // Arrange
            var testKey = "nonexistent/file.xdw";
            var localPath = Path.Combine(Path.GetTempPath(), "test.xdw");

            _mockS3Client
                .Setup(x => x.GetObjectAsync(It.IsAny<GetObjectRequest>(), default))
                .ThrowsAsync(new AmazonS3Exception("The specified key does not exist.")
                {
                    StatusCode = HttpStatusCode.NotFound
                });

            // Act & Assert
            var exception = await Assert.ThrowsAsync<AmazonS3Exception>(
                async () => await _service.DownloadFileAsync(testKey, localPath)
            );

            exception.StatusCode.Should().Be(HttpStatusCode.NotFound);
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task DownloadFileAsync_WithInvalidLocalPath_ShouldThrowException()
        {
            // Arrange
            var testKey = "source/test.xdw";
            var invalidPath = "Z:\\NonExistent\\Path\\file.xdw"; // Invalid drive

            var memoryStream = new MemoryStream(new byte[] { 0x58, 0x44, 0x57, 0x46 });
            _mockS3Client
                .Setup(x => x.GetObjectAsync(It.IsAny<GetObjectRequest>(), default))
                .ReturnsAsync(new GetObjectResponse
                {
                    ResponseStream = memoryStream,
                    HttpStatusCode = HttpStatusCode.OK
                });

            // Act & Assert
            await Assert.ThrowsAnyAsync<Exception>(
                async () => await _service.DownloadFileAsync(testKey, invalidPath)
            );
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task DownloadFileAsync_ShouldCreateDirectoryIfNotExists()
        {
            // Arrange
            var testKey = "source/test.xdw";
            var testDirectory = Path.Combine(Path.GetTempPath(), "docuworks-download-" + Guid.NewGuid());
            var localPath = Path.Combine(testDirectory, "downloaded.xdw");

            var memoryStream = new MemoryStream(new byte[] { 0x58, 0x44, 0x57, 0x46 });
            _mockS3Client
                .Setup(x => x.GetObjectAsync(It.IsAny<GetObjectRequest>(), default))
                .ReturnsAsync(new GetObjectResponse
                {
                    ResponseStream = memoryStream,
                    HttpStatusCode = HttpStatusCode.OK
                });

            try
            {
                // Act
                await _service.DownloadFileAsync(testKey, localPath);

                // Assert
                Directory.Exists(testDirectory).Should().BeTrue("Directory should be created");
                File.Exists(localPath).Should().BeTrue("File should exist");
            }
            finally
            {
                if (Directory.Exists(testDirectory))
                {
                    Directory.Delete(testDirectory, true);
                }
            }
        }

        #endregion

        #region Metadata Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task GetFileMetadataAsync_WithValidKey_ShouldReturnMetadata()
        {
            // Arrange
            var testKey = "source/test.xdw";
            var expectedMetadata = new Dictionary<string, string>
            {
                { "original-filename", "test.xdw" },
                { "upload-timestamp", "2025-01-28T10:00:00Z" },
                { "file-size", "1024" }
            };

            var metadataResponse = new GetObjectMetadataResponse
            {
                HttpStatusCode = HttpStatusCode.OK,
                ContentLength = 1024,
                LastModified = DateTime.UtcNow,
                Metadata = new MetadataCollection()
            };

            foreach (var kvp in expectedMetadata)
            {
                metadataResponse.Metadata[kvp.Key] = kvp.Value;
            }

            _mockS3Client
                .Setup(x => x.GetObjectMetadataAsync(It.IsAny<GetObjectMetadataRequest>(), default))
                .ReturnsAsync(metadataResponse);

            // Act
            var result = await _service.GetFileMetadataAsync(testKey);

            // Assert
            result.Should().NotBeNull("Metadata should be returned");
            result.Should().ContainKey("original-filename");
            result["original-filename"].Should().Be("test.xdw");
            result.Should().ContainKey("upload-timestamp");

            _mockS3Client.Verify(
                x => x.GetObjectMetadataAsync(
                    It.Is<GetObjectMetadataRequest>(req =>
                        req.BucketName == TestBucket &&
                        req.Key == testKey),
                    default),
                Times.Once);
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task GetFileMetadataAsync_WithNonExistentKey_ShouldThrowException()
        {
            // Arrange
            var testKey = "nonexistent/file.xdw";

            _mockS3Client
                .Setup(x => x.GetObjectMetadataAsync(It.IsAny<GetObjectMetadataRequest>(), default))
                .ThrowsAsync(new AmazonS3Exception("Not Found")
                {
                    StatusCode = HttpStatusCode.NotFound
                });

            // Act & Assert
            await Assert.ThrowsAsync<AmazonS3Exception>(
                async () => await _service.GetFileMetadataAsync(testKey)
            );
        }

        #endregion

        #region Delete Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task DeleteFileAsync_WithValidKey_ShouldSucceed()
        {
            // Arrange
            var testKey = "temp/test-to-delete.pdf";

            _mockS3Client
                .Setup(x => x.DeleteObjectAsync(It.IsAny<DeleteObjectRequest>(), default))
                .ReturnsAsync(new DeleteObjectResponse
                {
                    HttpStatusCode = HttpStatusCode.NoContent
                });

            // Act
            await _service.DeleteFileAsync(testKey);

            // Assert
            _mockS3Client.Verify(
                x => x.DeleteObjectAsync(
                    It.Is<DeleteObjectRequest>(req =>
                        req.BucketName == TestBucket &&
                        req.Key == testKey),
                    default),
                Times.Once);
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task DeleteFileAsync_WithNonExistentKey_ShouldNotThrow()
        {
            // Arrange
            var testKey = "nonexistent/file.pdf";

            _mockS3Client
                .Setup(x => x.DeleteObjectAsync(It.IsAny<DeleteObjectRequest>(), default))
                .ReturnsAsync(new DeleteObjectResponse
                {
                    HttpStatusCode = HttpStatusCode.NoContent
                });

            // Act & Assert
            var exception = await Record.ExceptionAsync(
                async () => await _service.DeleteFileAsync(testKey)
            );

            exception.Should().BeNull("S3 Delete is idempotent - should not throw for non-existent keys");
        }

        #endregion

        #region List Files Tests

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ListFilesAsync_WithPrefix_ShouldReturnMatchingFiles()
        {
            // Arrange
            var prefix = "source/";
            var expectedObjects = new List<S3Object>
            {
                new S3Object { Key = "source/file1.xdw", Size = 1024, LastModified = DateTime.UtcNow },
                new S3Object { Key = "source/file2.xdw", Size = 2048, LastModified = DateTime.UtcNow },
                new S3Object { Key = "source/file3.xdw", Size = 3072, LastModified = DateTime.UtcNow }
            };

            _mockS3Client
                .Setup(x => x.ListObjectsV2Async(It.IsAny<ListObjectsV2Request>(), default))
                .ReturnsAsync(new ListObjectsV2Response
                {
                    HttpStatusCode = HttpStatusCode.OK,
                    S3Objects = expectedObjects
                });

            // Act
            var results = await _service.ListFilesAsync(prefix);

            // Assert
            results.Should().HaveCount(3, "Should return all files with matching prefix");
            results.Should().OnlyContain(key => key.StartsWith(prefix), "All results should start with prefix");

            _mockS3Client.Verify(
                x => x.ListObjectsV2Async(
                    It.Is<ListObjectsV2Request>(req =>
                        req.BucketName == TestBucket &&
                        req.Prefix == prefix),
                    default),
                Times.Once);
        }

        [Fact]
        [Trait("Category", "Unit")]
        public async Task ListFilesAsync_WithPagination_ShouldHandleMultiplePages()
        {
            // Arrange
            var prefix = "source/";

            // First page
            _mockS3Client
                .SetupSequence(x => x.ListObjectsV2Async(It.IsAny<ListObjectsV2Request>(), default))
                .ReturnsAsync(new ListObjectsV2Response
                {
                    HttpStatusCode = HttpStatusCode.OK,
                    S3Objects = new List<S3Object>
                    {
                        new S3Object { Key = "source/file1.xdw" },
                        new S3Object { Key = "source/file2.xdw" }
                    },
                    IsTruncated = true,
                    NextContinuationToken = "token123"
                })
                // Second page
                .ReturnsAsync(new ListObjectsV2Response
                {
                    HttpStatusCode = HttpStatusCode.OK,
                    S3Objects = new List<S3Object>
                    {
                        new S3Object { Key = "source/file3.xdw" }
                    },
                    IsTruncated = false
                });

            // Act
            var results = await _service.ListFilesAsync(prefix);

            // Assert
            results.Should().HaveCount(3, "Should return all files across multiple pages");

            _mockS3Client.Verify(
                x => x.ListObjectsV2Async(It.IsAny<ListObjectsV2Request>(), default),
                Times.Exactly(2),
                "Should call ListObjectsV2 twice for paginated results");
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
