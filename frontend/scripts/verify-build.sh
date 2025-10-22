#!/bin/bash

# ====================================
# Vercel Deployment Verification Script
# ====================================
#
# This script verifies that the Next.js build will succeed
# on Vercel by running the same build process locally.
#
# Usage:
#   chmod +x scripts/verify-build.sh
#   ./scripts/verify-build.sh
#
# Exit codes:
#   0 - Build successful, ready for Vercel deployment
#   1 - Build failed, DO NOT deploy to Vercel
# ====================================

set -e  # Exit immediately if a command exits with a non-zero status

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Vercel Deployment Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1: Clean previous build artifacts
echo "📦 Step 1/4: Cleaning previous build artifacts..."
rm -rf .next out
echo "✅ Clean completed"
echo ""

# Step 2: Install dependencies (skip if already installed)
echo "📥 Step 2/4: Verifying dependencies..."
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  yarn install
else
  echo "✅ Dependencies already installed"
fi
echo ""

# Step 3: Run production build (same as Vercel)
echo "🔨 Step 3/4: Running production build..."
echo "   (This is exactly what Vercel will run)"
echo ""
yarn build
BUILD_EXIT_CODE=$?
echo ""

# Step 4: Verify build results
if [ $BUILD_EXIT_CODE -eq 0 ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✅ BUILD SUCCESSFUL"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "📊 Build Summary:"
  echo "   • TypeScript compilation: ✅ Passed"
  echo "   • ESLint validation: ✅ Passed (warnings allowed)"
  echo "   • Static export: ✅ Generated"
  echo "   • Output directory: ./out"
  echo ""
  echo "🎉 Ready for Vercel deployment!"
  echo ""
  echo "Next steps:"
  echo "   1. git add ."
  echo "   2. git commit -m \"fix: resolve ESLint build errors for Vercel deployment\""
  echo "   3. git push origin main"
  echo "   4. Vercel will automatically deploy"
  echo ""
  exit 0
else
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "❌ BUILD FAILED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "⚠️  DO NOT deploy to Vercel yet!"
  echo "   Fix the errors above before deploying."
  echo ""
  exit 1
fi
