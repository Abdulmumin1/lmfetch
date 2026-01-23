#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
MUTED='\033[0;2m'
NC='\033[0m'

# Change this to your GitHub repository "owner/repo"
REPO="Abdulmumin1/lmfetch"
INSTALL_DIR="$HOME/.lmfetch/bin"
BINARY_NAME="lmfetch"

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin*) echo "darwin" ;;
        Linux*)  echo "linux" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *) echo "unsupported" ;;
    esac
}

# Detect architecture
detect_arch() {
    local arch
    arch=$(uname -m)
    case "$arch" in
        x86_64|amd64) echo "x64" ;;
        aarch64|arm64) echo "arm64" ;;
        *) echo "unsupported" ;;
    esac
}

# Check for Rosetta on macOS
check_rosetta() {
    if [ "$(detect_os)" = "darwin" ] && [ "$(detect_arch)" = "x64" ]; then
        if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
            echo "arm64"
            return
        fi
    fi
    detect_arch
}

os=$(detect_os)
arch=$(check_rosetta)

if [ "$os" = "unsupported" ] || [ "$arch" = "unsupported" ]; then
    echo -e "${RED}Unsupported platform: $(uname -s) $(uname -m)${NC}"
    exit 1
fi

# Build filename matching release.yml assets
# lmfetch-linux-x64
# lmfetch-windows-x64.exe
# lmfetch-darwin-x64
# lmfetch-darwin-arm64

if [ "$os" = "windows" ]; then
    filename="${BINARY_NAME}-${os}-${arch}.exe"
else
    filename="${BINARY_NAME}-${os}-${arch}"
fi

echo -e "${MUTED}Detected: ${NC}${os}-${arch}"

# Get latest version
echo -e "${MUTED}Fetching latest version...${NC}"
# Use the "latest" release endpoint to get the tag name
latest_tag=$(curl -sI "https://github.com/${REPO}/releases/latest" | grep -i "^location:" | sed -n 's/.*tag\/\([^[:space:]]*\).*/\1/p' | tr -d '\r')

if [ -z "$latest_tag" ]; then
    echo -e "${RED}Failed to fetch latest version tag from GitHub${NC}"
    exit 1
fi

echo -e "${MUTED}Installing version: ${NC}${latest_tag}"

# Version comparison logic
# Returns 0 if v1 > v2, 1 otherwise
version_gt() {
    test "$(printf '%s\n' "$@" | sort -V | head -n 1)" != "$1"
}

# Check if already installed
if command -v "$BINARY_NAME" &> /dev/null; then
    current_version=$($BINARY_NAME --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "0.0.0")
    # Clean up v prefix if present in tag
    latest_version=$(echo "$latest_tag" | sed 's/^v//')
    
    echo -e "${MUTED}Current version: ${NC}${current_version}"
    
    if [ "$current_version" = "$latest_version" ]; then
        echo -e "${GREEN}You already have the latest version ($latest_version).${NC}"
        exit 0
    fi
    
    if version_gt "$current_version" "$latest_version"; then
        echo -e "${GREEN}You have a newer version ($current_version) than the latest release ($latest_version).${NC}"
        exit 0
    fi
    
    echo -e "${MUTED}Upgrading from ${current_version} to ${latest_version}...${NC}"
fi

# Download URL
# Asset URL format: https://github.com/user/repo/releases/download/v0.2.0/lmfetch-macos-arm64
url="https://github.com/${REPO}/releases/download/${latest_tag}/${filename}"

# Create install directory
mkdir -p "$INSTALL_DIR"

# Download binary
echo -e "${MUTED}Downloading from ${url}...${NC}"
if ! curl -fSL --progress-bar -o "$INSTALL_DIR/$BINARY_NAME" "$url"; then
    echo -e "${RED}Download failed. Check if the release exists.${NC}"
    exit 1
fi

chmod +x "$INSTALL_DIR/$BINARY_NAME"

# Add to PATH
add_to_path() {
    local shell_config="$1"
    
    if [ -f "$shell_config" ]; then
        # Check if already in path
        if ! grep -q "$INSTALL_DIR" "$shell_config" 2>/dev/null; then
            echo -e "\n# $BINARY_NAME" >> "$shell_config"
            echo -e "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$shell_config"
            echo -e "${MUTED}Added to PATH in ${NC}$shell_config"
        else
            echo -e "${MUTED}Already in PATH of ${NC}$shell_config"
        fi
    fi
}

# Detect shell and update config
case "$(basename "$SHELL")" in
    zsh)  add_to_path "$HOME/.zshrc" ;;
    bash) add_to_path "$HOME/.bashrc" ;;
    fish)
        fish_config="$HOME/.config/fish/config.fish"
        # Fish syntax is different
        if [ -f "$fish_config" ]; then
             if ! grep -q "$INSTALL_DIR" "$fish_config" 2>/dev/null; then
                echo -e "\n# $BINARY_NAME" >> "$fish_config"
                echo -e "fish_add_path $INSTALL_DIR" >> "$fish_config"
                echo -e "${MUTED}Added to PATH in ${NC}$fish_config"
             fi
        fi
        ;;
esac

# GitHub Actions support
if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "$INSTALL_DIR" >> "$GITHUB_PATH"
fi

echo -e ""
echo -e "${GREEN}$BINARY_NAME installed successfully!${NC}"
echo -e ""
echo -e "${MUTED}To get started:${NC}"
echo -e "  ${MUTED}1.${NC} Restart your terminal or run: ${MUTED}source ~/.zshrc${NC} (or ~/.bashrc)"
echo -e "  ${MUTED}2.${NC} Run: ${MUTED}$BINARY_NAME${NC}"
echo -e ""
