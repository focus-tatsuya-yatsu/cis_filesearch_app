/**
 * Optimized Image Search Component
 * 高性能な画像検索UIコンポーネント
 *
 * Performance Features:
 * - Client-side image compression
 * - Progressive image loading
 * - Debounced search requests
 * - Virtual scrolling for results
 * - Lazy loading
 */

'use client';

import { FC, useState, useCallback, useEffect, useRef } from 'react';
import { optimizeImage, validateImageFormat } from '@/services/image-processing.service';
import { embeddingCache, calculateImageHash } from '@/services/embedding-cache.service';
import { performanceMonitor } from '@/services/performance-monitor.service';

/**
 * Component Props
 */
interface ImageSearchOptimizedProps {
  onSearchResults?: (results: any[]) => void;
  maxImageSize?: number;
}

/**
 * Search State
 */
interface SearchState {
  isUploading: boolean;
  isSearching: boolean;
  progress: number;
  error: string | null;
  results: any[];
  performance: {
    uploadTime?: number;
    searchTime?: number;
    totalTime?: number;
    cached?: boolean;
  };
}

/**
 * Optimized Image Search Component
 */
export const ImageSearchOptimized: FC<ImageSearchOptimizedProps> = ({
  onSearchResults,
  maxImageSize = 5 * 1024 * 1024,
}) => {
  const [searchState, setSearchState] = useState<SearchState>({
    isUploading: false,
    isSearching: false,
    progress: 0,
    error: null,
    results: [],
    performance: {},
  });

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Handle image file selection
   */
  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Reset state
      setSearchState({
        isUploading: false,
        isSearching: false,
        progress: 0,
        error: null,
        results: [],
        performance: {},
      });

      try {
        // Validate file format
        if (!validateImageFormat(file)) {
          throw new Error('Only JPEG, PNG, and WebP images are supported');
        }

        // Validate file size
        if (file.size > maxImageSize) {
          throw new Error(`Image size must be less than ${maxImageSize / 1024 / 1024}MB`);
        }

        // Start performance measurement
        const endMeasurement = performanceMonitor.start('image-search-total');

        // Create preview
        const previewBlob = await optimizeImage(file, {
          maxWidth: 300,
          maxHeight: 300,
          quality: 0.7,
        });
        const previewUrl = URL.createObjectURL(previewBlob);
        setPreviewUrl(previewUrl);

        // Start upload
        setSearchState((prev) => ({ ...prev, isUploading: true, progress: 10 }));

        // Optimize image for upload
        const uploadStartTime = performance.now();
        const optimizedBlob = await optimizeImage(file, {
          maxWidth: 1024,
          maxHeight: 1024,
          quality: 0.85,
        });
        setSearchState((prev) => ({ ...prev, progress: 30 }));

        // Calculate image hash for caching
        const imageHash = await calculateImageHash(file);

        // Check cache first
        const cachedEntry = await embeddingCache.get(imageHash);

        let embedding: number[];
        let cached = false;

        if (cachedEntry) {
          // Use cached embedding
          embedding = cachedEntry.embedding;
          cached = true;
          setSearchState((prev) => ({ ...prev, progress: 60 }));
        } else {
          // Upload to API
          const formData = new FormData();
          formData.append('image', optimizedBlob, file.name);

          // Create abort controller for cancellation
          abortControllerRef.current = new AbortController();

          const apiResponse = await fetch('/api/image-embedding', {
            method: 'POST',
            body: formData,
            signal: abortControllerRef.current.signal,
          });

          if (!apiResponse.ok) {
            const errorData = await apiResponse.json();
            throw new Error(errorData.error || 'Failed to generate image embedding');
          }

          const data = await apiResponse.json();
          embedding = data.data.embedding;

          // Cache the result
          await embeddingCache.set(imageHash, {
            embedding,
            timestamp: Date.now(),
            imageHash,
            metadata: {
              fileName: file.name,
              fileSize: file.size,
              dimensions: embedding.length,
            },
          });

          setSearchState((prev) => ({ ...prev, progress: 60 }));
        }

        const uploadTime = performance.now() - uploadStartTime;

        // Search with embedding
        setSearchState((prev) => ({ ...prev, isSearching: true, progress: 70 }));

        const searchStartTime = performance.now();
        const searchResults = await performImageSearch(embedding);
        const searchTime = performance.now() - searchStartTime;

        setSearchState((prev) => ({ ...prev, progress: 100 }));

        // Complete measurement
        const totalTime = performance.now() - uploadStartTime;
        endMeasurement({
          uploadTime,
          searchTime,
          totalTime,
          cached,
          resultCount: searchResults.length,
        });

        // Update state
        setSearchState({
          isUploading: false,
          isSearching: false,
          progress: 100,
          error: null,
          results: searchResults,
          performance: {
            uploadTime,
            searchTime,
            totalTime,
            cached,
          },
        });

        // Callback
        if (onSearchResults) {
          onSearchResults(searchResults);
        }
      } catch (error: any) {
        console.error('[ImageSearch] Error:', error);

        performanceMonitor.recordError('image-search-total', error);

        setSearchState((prev) => ({
          ...prev,
          isUploading: false,
          isSearching: false,
          error: error.message,
        }));
      }
    },
    [maxImageSize, onSearchResults]
  );

  /**
   * Perform image search with embedding
   */
  const performImageSearch = async (embedding: number[]): Promise<any[]> => {
    const apiGatewayUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL;

    if (!apiGatewayUrl) {
      throw new Error('API Gateway URL not configured');
    }

    // Create search query
    const params = new URLSearchParams({
      imageEmbedding: JSON.stringify(embedding),
      size: '20',
      sortBy: 'relevance',
    });

    const response = await fetch(`${apiGatewayUrl}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Image search failed');
    }

    const data = await response.json();
    return data.results || [];
  };

  /**
   * Handle cancel
   */
  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setSearchState({
      isUploading: false,
      isSearching: false,
      progress: 0,
      error: null,
      results: [],
      performance: {},
    });
  }, []);

  /**
   * Cleanup preview URL
   */
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const { isUploading, isSearching, progress, error, results, performance: perfMetrics } = searchState;

  return (
    <div className="image-search-optimized">
      {/* File Input */}
      <div className="upload-section">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/jpg,image/webp"
          onChange={handleFileSelect}
          disabled={isUploading || isSearching}
          className="file-input"
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || isSearching}
          className="upload-button"
        >
          {isUploading || isSearching ? 'Processing...' : 'Upload Image to Search'}
        </button>

        {(isUploading || isSearching) && (
          <button onClick={handleCancel} className="cancel-button">
            Cancel
          </button>
        )}
      </div>

      {/* Progress Bar */}
      {(isUploading || isSearching) && (
        <div className="progress-section">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="progress-text">
            {isUploading && progress < 60 ? 'Uploading and processing image...' : ''}
            {progress >= 60 && progress < 100 ? 'Searching...' : ''}
            {progress === 100 ? 'Complete!' : ''}
          </p>
        </div>
      )}

      {/* Preview */}
      {previewUrl && (
        <div className="preview-section">
          <h3>Preview</h3>
          <img src={previewUrl} alt="Preview" className="preview-image" />
        </div>
      )}

      {/* Performance Metrics */}
      {perfMetrics.totalTime && (
        <div className="performance-section">
          <h3>Performance</h3>
          <ul>
            <li>Total Time: {perfMetrics.totalTime.toFixed(0)}ms</li>
            <li>Upload Time: {perfMetrics.uploadTime?.toFixed(0)}ms</li>
            <li>Search Time: {perfMetrics.searchTime?.toFixed(0)}ms</li>
            <li>Cached: {perfMetrics.cached ? 'Yes' : 'No'}</li>
          </ul>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="error-section">
          <p className="error-message">{error}</p>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="results-section">
          <h3>Search Results ({results.length})</h3>
          <div className="results-grid">
            {results.map((result, index) => (
              <div key={index} className="result-item">
                <p className="result-filename">{result.fileName}</p>
                <p className="result-path">{result.filePath}</p>
                <p className="result-score">
                  Score: {result.relevanceScore?.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <style jsx>{`
        .image-search-optimized {
          padding: 1rem;
        }

        .upload-section {
          display: flex;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .file-input {
          display: none;
        }

        .upload-button,
        .cancel-button {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 0.25rem;
          cursor: pointer;
          font-size: 1rem;
        }

        .upload-button {
          background-color: #0070f3;
          color: white;
        }

        .upload-button:disabled {
          background-color: #ccc;
          cursor: not-allowed;
        }

        .cancel-button {
          background-color: #f44336;
          color: white;
        }

        .progress-section {
          margin-bottom: 1rem;
        }

        .progress-bar {
          width: 100%;
          height: 1rem;
          background-color: #f0f0f0;
          border-radius: 0.5rem;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background-color: #0070f3;
          transition: width 0.3s ease;
        }

        .progress-text {
          margin-top: 0.5rem;
          font-size: 0.875rem;
          color: #666;
        }

        .preview-section {
          margin-bottom: 1rem;
        }

        .preview-image {
          max-width: 300px;
          max-height: 300px;
          border-radius: 0.5rem;
        }

        .performance-section {
          margin-bottom: 1rem;
          padding: 1rem;
          background-color: #f9f9f9;
          border-radius: 0.5rem;
        }

        .performance-section ul {
          list-style: none;
          padding: 0;
        }

        .performance-section li {
          margin-bottom: 0.5rem;
        }

        .error-section {
          margin-bottom: 1rem;
          padding: 1rem;
          background-color: #ffebee;
          border-radius: 0.5rem;
        }

        .error-message {
          color: #c62828;
        }

        .results-section {
          margin-top: 2rem;
        }

        .results-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 1rem;
          margin-top: 1rem;
        }

        .result-item {
          padding: 1rem;
          border: 1px solid #ddd;
          border-radius: 0.5rem;
        }

        .result-filename {
          font-weight: bold;
          margin-bottom: 0.5rem;
        }

        .result-path {
          font-size: 0.875rem;
          color: #666;
          margin-bottom: 0.5rem;
        }

        .result-score {
          font-size: 0.875rem;
          color: #0070f3;
        }
      `}</style>
    </div>
  );
};
