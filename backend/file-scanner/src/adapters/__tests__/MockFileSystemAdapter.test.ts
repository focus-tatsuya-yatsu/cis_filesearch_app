import { describe, it, expect, beforeEach } from '@jest/globals';
import { MockFileSystemAdapter } from '../MockFileSystemAdapter';
import type { FileEntry } from '../../types';

describe('MockFileSystemAdapter', () => {
  let adapter: MockFileSystemAdapter;

  beforeEach(() => {
    adapter = new MockFileSystemAdapter();
  });

  describe('initialization', () => {
    it('should create adapter with default mock files', async () => {
      // Arrange & Act
      await adapter.initialize();
      const files = await adapter.listFiles('/');

      // Assert
      expect(files).toBeDefined();
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);
    });

    it('should create adapter with custom mock files', async () => {
      // Arrange
      const customFiles: FileEntry[] = [
        {
          path: '/custom/file.txt',
          name: 'file.txt',
          size: 1024,
          modifiedTime: new Date('2025-01-01'),
          isDirectory: false,
          extension: 'txt',
        },
      ];
      const customAdapter = new MockFileSystemAdapter(customFiles);

      // Act
      await customAdapter.initialize();
      const files = await customAdapter.listFiles('/custom');

      // Assert
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('file.txt');
    });

    it('should support multiple initialization calls (idempotent)', async () => {
      // Arrange & Act
      await adapter.initialize();
      await adapter.initialize();
      const files = await adapter.listFiles('/');

      // Assert
      expect(files).toBeDefined();
    });
  });

  describe('listFiles', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should list files in root directory', async () => {
      // Arrange & Act
      const files = await adapter.listFiles('/');

      // Assert
      expect(files).toBeDefined();
      expect(files.length).toBeGreaterThan(0);
      files.forEach((file) => {
        expect(file).toHaveProperty('path');
        expect(file).toHaveProperty('name');
        expect(file).toHaveProperty('size');
        expect(file).toHaveProperty('modifiedTime');
        expect(file).toHaveProperty('isDirectory');
      });
    });

    it('should list files in subdirectory', async () => {
      // Arrange
      const mockFiles: FileEntry[] = [
        {
          path: '/docs/report.pdf',
          name: 'report.pdf',
          size: 2048,
          modifiedTime: new Date(),
          isDirectory: false,
          extension: 'pdf',
        },
      ];
      const customAdapter = new MockFileSystemAdapter(mockFiles);
      await customAdapter.initialize();

      // Act
      const files = await customAdapter.listFiles('/docs');

      // Assert
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('report.pdf');
    });

    it('should return empty array for non-existent directory', async () => {
      // Arrange & Act
      const files = await adapter.listFiles('/non-existent');

      // Assert
      expect(files).toEqual([]);
    });

    it('should handle trailing slash in path', async () => {
      // Arrange & Act
      const filesWithSlash = await adapter.listFiles('/docs/');
      const filesWithoutSlash = await adapter.listFiles('/docs');

      // Assert
      expect(filesWithSlash).toEqual(filesWithoutSlash);
    });

    it('should filter files correctly by path prefix', async () => {
      // Arrange
      const mockFiles: FileEntry[] = [
        {
          path: '/docs/file1.txt',
          name: 'file1.txt',
          size: 100,
          modifiedTime: new Date(),
          isDirectory: false,
          extension: 'txt',
        },
        {
          path: '/images/photo.jpg',
          name: 'photo.jpg',
          size: 200,
          modifiedTime: new Date(),
          isDirectory: false,
          extension: 'jpg',
        },
      ];
      const customAdapter = new MockFileSystemAdapter(mockFiles);
      await customAdapter.initialize();

      // Act
      const docsFiles = await customAdapter.listFiles('/docs');
      const imageFiles = await customAdapter.listFiles('/images');

      // Assert
      expect(docsFiles).toHaveLength(1);
      expect(docsFiles[0].name).toBe('file1.txt');
      expect(imageFiles).toHaveLength(1);
      expect(imageFiles[0].name).toBe('photo.jpg');
    });
  });

  describe('getFileMetadata', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should return metadata for existing file', async () => {
      // Arrange
      const mockFiles: FileEntry[] = [
        {
          path: '/test.txt',
          name: 'test.txt',
          size: 1024,
          modifiedTime: new Date('2025-01-01'),
          isDirectory: false,
          extension: 'txt',
        },
      ];
      const customAdapter = new MockFileSystemAdapter(mockFiles);
      await customAdapter.initialize();

      // Act
      const metadata = await customAdapter.getFileMetadata('/test.txt');

      // Assert
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('test.txt');
      expect(metadata?.size).toBe(1024);
      expect(metadata?.extension).toBe('txt');
    });

    it('should return null for non-existent file', async () => {
      // Arrange & Act
      const metadata = await adapter.getFileMetadata('/non-existent.txt');

      // Assert
      expect(metadata).toBeNull();
    });

    it('should return correct metadata for directory', async () => {
      // Arrange
      const mockFiles: FileEntry[] = [
        {
          path: '/folder',
          name: 'folder',
          size: 0,
          modifiedTime: new Date(),
          isDirectory: true,
        },
      ];
      const customAdapter = new MockFileSystemAdapter(mockFiles);
      await customAdapter.initialize();

      // Act
      const metadata = await customAdapter.getFileMetadata('/folder');

      // Assert
      expect(metadata).toBeDefined();
      expect(metadata?.isDirectory).toBe(true);
    });
  });

  describe('readFile', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should read file content as buffer', async () => {
      // Arrange
      const mockFiles: FileEntry[] = [
        {
          path: '/data.txt',
          name: 'data.txt',
          size: 11,
          modifiedTime: new Date(),
          isDirectory: false,
          extension: 'txt',
        },
      ];
      const customAdapter = new MockFileSystemAdapter(mockFiles);
      await customAdapter.initialize();

      // Act
      const content = await customAdapter.readFile('/data.txt');

      // Assert
      expect(content).toBeInstanceOf(Buffer);
      expect(content.length).toBeGreaterThan(0);
    });

    it('should throw error for non-existent file', async () => {
      // Arrange & Act & Assert
      await expect(adapter.readFile('/non-existent.txt')).rejects.toThrow();
    });

    it('should throw error when reading directory', async () => {
      // Arrange
      const mockFiles: FileEntry[] = [
        {
          path: '/folder',
          name: 'folder',
          size: 0,
          modifiedTime: new Date(),
          isDirectory: true,
        },
      ];
      const customAdapter = new MockFileSystemAdapter(mockFiles);
      await customAdapter.initialize();

      // Act & Assert
      await expect(customAdapter.readFile('/folder')).rejects.toThrow();
    });
  });

  describe('exists', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should return true for existing file', async () => {
      // Arrange
      const mockFiles: FileEntry[] = [
        {
          path: '/exists.txt',
          name: 'exists.txt',
          size: 100,
          modifiedTime: new Date(),
          isDirectory: false,
          extension: 'txt',
        },
      ];
      const customAdapter = new MockFileSystemAdapter(mockFiles);
      await customAdapter.initialize();

      // Act
      const exists = await customAdapter.exists('/exists.txt');

      // Assert
      expect(exists).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      // Arrange & Act
      const exists = await adapter.exists('/non-existent.txt');

      // Assert
      expect(exists).toBe(false);
    });

    it('should return true for existing directory', async () => {
      // Arrange
      const mockFiles: FileEntry[] = [
        {
          path: '/folder',
          name: 'folder',
          size: 0,
          modifiedTime: new Date(),
          isDirectory: true,
        },
      ];
      const customAdapter = new MockFileSystemAdapter(mockFiles);
      await customAdapter.initialize();

      // Act
      const exists = await customAdapter.exists('/folder');

      // Assert
      expect(exists).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should cleanup resources without errors', async () => {
      // Arrange
      await adapter.initialize();

      // Act & Assert
      await expect(adapter.cleanup()).resolves.not.toThrow();
    });

    it('should be callable multiple times (idempotent)', async () => {
      // Arrange
      await adapter.initialize();

      // Act & Assert
      await adapter.cleanup();
      await expect(adapter.cleanup()).resolves.not.toThrow();
    });

    it('should be callable before initialization', async () => {
      // Arrange & Act & Assert
      await expect(adapter.cleanup()).resolves.not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle empty file list', async () => {
      // Arrange
      const emptyAdapter = new MockFileSystemAdapter([]);
      await emptyAdapter.initialize();

      // Act
      const files = await emptyAdapter.listFiles('/');

      // Assert
      expect(files).toEqual([]);
    });

    it('should handle files with special characters in path', async () => {
      // Arrange
      const mockFiles: FileEntry[] = [
        {
          path: '/files/special file (1).txt',
          name: 'special file (1).txt',
          size: 100,
          modifiedTime: new Date(),
          isDirectory: false,
          extension: 'txt',
        },
      ];
      const customAdapter = new MockFileSystemAdapter(mockFiles);
      await customAdapter.initialize();

      // Act
      const metadata = await customAdapter.getFileMetadata(
        '/files/special file (1).txt'
      );

      // Assert
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('special file (1).txt');
    });

    it('should handle very large file sizes', async () => {
      // Arrange
      const largeSize = Number.MAX_SAFE_INTEGER;
      const mockFiles: FileEntry[] = [
        {
          path: '/large.bin',
          name: 'large.bin',
          size: largeSize,
          modifiedTime: new Date(),
          isDirectory: false,
          extension: 'bin',
        },
      ];
      const customAdapter = new MockFileSystemAdapter(mockFiles);
      await customAdapter.initialize();

      // Act
      const metadata = await customAdapter.getFileMetadata('/large.bin');

      // Assert
      expect(metadata?.size).toBe(largeSize);
    });

    it('should handle files with no extension', async () => {
      // Arrange
      const mockFiles: FileEntry[] = [
        {
          path: '/README',
          name: 'README',
          size: 100,
          modifiedTime: new Date(),
          isDirectory: false,
        },
      ];
      const customAdapter = new MockFileSystemAdapter(mockFiles);
      await customAdapter.initialize();

      // Act
      const metadata = await customAdapter.getFileMetadata('/README');

      // Assert
      expect(metadata).toBeDefined();
      expect(metadata?.extension).toBeUndefined();
    });
  });
});
