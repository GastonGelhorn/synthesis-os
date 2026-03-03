#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# Download all-MiniLM-L6-v2 ONNX model for SynthesisOS local embeddings.
#
# This model replaces OpenAI text-embedding-ada-002 API calls with
# local inference (~2-5ms on CPU vs 2-5s via API).
#
# Files downloaded:
#   - model.onnx       (~22MB) — the sentence-transformers model
#   - tokenizer.json   (~700KB) — HuggingFace fast tokenizer
#
# Target directory: {APP_DATA_DIR}/models/all-MiniLM-L6-v2/
# On macOS: ~/Library/Application Support/com.synthesis.os/models/all-MiniLM-L6-v2/
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

# Determine the target directory
if [ -n "${1:-}" ]; then
    MODEL_DIR="$1"
else
    # Default macOS app data path
    MODEL_DIR="$HOME/Library/Application Support/com.synthesis.os/models/all-MiniLM-L6-v2"
fi

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  SynthesisOS — Local Embedding Model Downloader              ║"
echo "║  Model: all-MiniLM-L6-v2 (384-dim, ~22MB)                   ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "Target: $MODEL_DIR"
echo ""

mkdir -p "$MODEL_DIR"

HF_BASE="https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main"

# Download ONNX model
if [ -f "$MODEL_DIR/model.onnx" ]; then
    echo "✓ model.onnx already exists, skipping."
else
    echo "⬇ Downloading model.onnx (~22MB)..."
    curl -L -o "$MODEL_DIR/model.onnx" \
        "$HF_BASE/onnx/model.onnx" \
        --progress-bar
    echo "✓ model.onnx downloaded."
fi

# Download tokenizer
if [ -f "$MODEL_DIR/tokenizer.json" ]; then
    echo "✓ tokenizer.json already exists, skipping."
else
    echo "⬇ Downloading tokenizer.json..."
    curl -L -o "$MODEL_DIR/tokenizer.json" \
        "$HF_BASE/tokenizer.json" \
        --progress-bar
    echo "✓ tokenizer.json downloaded."
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " Model ready at: $MODEL_DIR"
echo "   - model.onnx     $(du -h "$MODEL_DIR/model.onnx" | cut -f1)"
echo "   - tokenizer.json $(du -h "$MODEL_DIR/tokenizer.json" | cut -f1)"
echo ""
echo "SynthesisOS will load this model automatically at kernel boot."
echo "═══════════════════════════════════════════════════════════════"
