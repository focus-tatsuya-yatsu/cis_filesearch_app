# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CIS File Search Application - A sophisticated application that enables efficient searching of client's local NAS using AWS infrastructure. The system provides an enterprise-grade file search solution with modern UI/UX and advanced search capabilities.

## Technology Stack

### Frontend
- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **UI Framework**: React
- **Directory Structure**: src directory pattern
- **Styling**: Tailwind CSS
  - Responsive design mandatory
  - Unit preference: rem/em/%/vw/vh (minimize px usage)
- **Animation**: Framer Motion
- **Design Philosophy**: Modern, sophisticated UI/UX

### Backend
- **Runtime**: Node.js
- **Framework**: Express
- **Cloud Services**: AWS (for NAS integration and logging)

### Infrastructure & Tools
- **Containerization**: Docker
- **Package Manager**: yarn

## Development Methodology

- Test-Driven Development (TDD) approach for robust, bug-free code
- Comprehensive code documentation and comments
- Clean architecture with high maintainability

## Documentation Reference

**IMPORTANT**: Always refer to the comprehensive documentation in the `/docs` directory as needed:

- **Requirements**: `/docs/requirement.md` - Complete system requirements and specifications
- **Architecture**: `/docs/architecture.md` - System architecture, layer structure, and data flows
- **API Specs**: `/docs/api-specification.md` - REST API endpoints and specifications
- **Database**: `/docs/database-design.md` - Database schemas for RDS, DynamoDB, OpenSearch, S3
- **Coding Standards**: `/docs/coding-standards.md` - TypeScript/React coding conventions (ES modules mandatory)
- **Testing**: `/docs/test-strategy.md` - Testing approach and coverage targets
- **Deployment**: `/docs/deployment-guide.md` - AWS deployment procedures with Terraform
- **Roadmap**: `/docs/roadmap.md` - 8-month project timeline and milestones
- **Tasks**: `/docs/tasks/` - Phase-by-phase task breakdown with progress tracking

When implementing features or making architectural decisions, consult the relevant documentation to ensure alignment with project standards and requirements.

## Task Management

**CRITICAL**: When completing any development task:

1. **Check the task list**: Refer to `/docs/tasks/progress-dashboard.md` to see the current task status
2. **Mark tasks as complete**: After finishing a task, update the corresponding task in the appropriate phase file:
   - Phase 1: `/docs/tasks/phase1-tasks.md`
   - Phase 2: `/docs/tasks/phase2-tasks.md`
   - Phase 3: `/docs/tasks/phase3-tasks.md`
   - Phase 4: `/docs/tasks/phase4-tasks.md`
3. **Update progress**: Change `[ ]` to `[x]` for completed tasks
4. **Update dashboard**: Update the progress percentage in `/docs/tasks/progress-dashboard.md` to reflect current status

Example:
```markdown
- [x] 🔴 **Next.js プロジェクト初期化** `担当: FE1` `期限: 2025-01-20`
  - `npx create-next-app@latest` 実行
  - TypeScript設定
  - src/ ディレクトリ構造作成
```

This ensures project progress is always visible at a glance and the team stays aligned.

## Commands

```bash
# Install dependencies
yarn install

# Development server (Frontend)
yarn dev

# Build for production
yarn build

# Run tests
yarn test

# Run specific test file
yarn test [test-file-path]

# Lint code
yarn lint

# Format code
yarn format

# Docker operations
docker build -t cis-filesearch-app .
docker run -p 3000:3000 cis-filesearch-app
```

## Architecture

### Frontend Architecture
- **pages/**: Next.js App Router pages
- **components/**: Reusable React components
  - **ui/**: Base UI components
  - **features/**: Feature-specific components
- **hooks/**: Custom React hooks
- **services/**: API integration and external services
- **utils/**: Utility functions
- **types/**: TypeScript type definitions

### Backend Architecture
- **controllers/**: Request handlers
- **services/**: Business logic
- **models/**: Data models
- **middleware/**: Express middleware
- **routes/**: API route definitions
- **aws/**: AWS service integrations

### Key Architectural Decisions
- Server-side rendering with Next.js for optimal SEO and performance
- AWS integration for scalable file indexing and search
- Microservices approach for NAS synchronization
- Event-driven architecture for real-time updates

## Core Features Implementation Guide

### 1. Filter & Sort System
- Location: Top of search results
- Components: Filter dropdowns, sort toggles
- State management: React Context or Zustand
- Filters: File type, modification date, size
- Sort: Ascending/descending toggle

### 2. File Path Display
- Full path in dedicated column
- Collapsible for long paths
- Show last segments by default
- Hover tooltip for complete path

### 3. Path Copy Feature
- Copy icon next to each path
- Clipboard API integration
- Toast notification on successful copy

### 4. Explorer-Style UI
- Left panel: Tree structure using recursive components
- Right panel: Search results grid/list view
- Split-pane resizable interface

### 5. File Preview
- Hover trigger with delay
- Supported formats: Images (jpg, png, gif), PDF, Docuworks
- Preview service integration for file rendering
- Lazy loading for performance

### 6. Case-Insensitive Search
- Implement at database query level
- Use ILIKE (PostgreSQL) or COLLATE (MySQL)
- Frontend validation to match backend behavior

### 7. Search Logging
- AWS CloudWatch integration
- Log structure: timestamp, user, query, results count
- Dashboard component for log visualization
- Export functionality to CSV/JSON

### 8. Sync & Update System
- Scheduled jobs using cron
- Manual trigger via API endpoint
- Progress indicator during sync
- Differential sync for efficiency

### 9. Full-Text Search
- PDF text extraction using pdf-parse or similar
- Docuworks integration via API
- Elasticsearch or AWS OpenSearch for indexing
- OCR capabilities for scanned documents

## AWS Integration Points

- **S3**: File metadata storage and caching
- **Lambda**: Serverless file processing
- **CloudWatch**: Logging and monitoring
- **DynamoDB/RDS**: Search index and metadata
- **API Gateway**: REST API management
- **EventBridge**: Scheduled sync operations

## Security Considerations

- Authentication/Authorization implementation required
- VPN or secure tunnel for NAS access
- Encrypted data transmission
- Rate limiting on search API
- Input sanitization for search queries

## Performance Optimization

- Implement pagination for search results
- Use virtual scrolling for large file lists
- Cache frequently accessed data
- Optimize database queries with proper indexing
- CDN for static assets
- Lazy load heavy components

## Testing Strategy

- Unit tests for utility functions and hooks
- Integration tests for API endpoints
- Component testing with React Testing Library
- E2E testing with Cypress or Playwright
- Performance testing for search operations
- Load testing for concurrent users

## Future AI Enhancement Areas

When implementing AI features, consider:
- Image similarity search using embeddings
- Search pattern analysis for predictions
- Auto-tagging using NLP
- Folder structure optimization suggestions
- Smart file recommendations based on usage