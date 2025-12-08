# ==========================================
# Python Worker Dockerfile
# Multi-stage build for production deployment
# ==========================================

FROM amazonlinux:2023 AS base

# Set working directory
WORKDIR /app

# Install system dependencies
RUN dnf update -y && \
    dnf install -y \
    python3.11 \
    python3.11-pip \
    poppler-utils \
    ImageMagick \
    ImageMagick-devel \
    file-devel \
    wget \
    tar \
    && dnf clean all

# Install Tesseract OCR
COPY scripts/install-tesseract-al2023.sh /tmp/
RUN bash /tmp/install-tesseract-al2023.sh && \
    rm /tmp/install-tesseract-al2023.sh

# Set Tesseract environment variables
ENV TESSDATA_PREFIX=/usr/local/share/tessdata
ENV PATH="/usr/local/bin:${PATH}"

# Verify Tesseract installation
RUN tesseract --version && \
    tesseract --list-langs

# ==========================================
# Build stage
# ==========================================
FROM base AS builder

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip3.11 install --no-cache-dir --upgrade pip && \
    pip3.11 install --no-cache-dir -r requirements.txt

# ==========================================
# Production stage
# ==========================================
FROM base AS production

# Copy Python packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Create app user
RUN useradd -m -u 1000 appuser && \
    mkdir -p /tmp/file-processor /var/log && \
    chown -R appuser:appuser /tmp/file-processor /var/log

# Copy application code
COPY --chown=appuser:appuser . .

# Switch to app user
USER appuser

# Create temp directory
RUN mkdir -p /tmp/file-processor

# Expose health check port (optional)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python3.11 -c "import sys; sys.exit(0)"

# Default command
CMD ["python3.11", "worker.py"]
