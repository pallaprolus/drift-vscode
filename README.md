# Drift - Documentation Sync Detector

<img src="./images/icon.png" width="128" alt="Drift Logo" />

**Drift** detects when your documentation drifts out of sync with your code. It pairs documentation blocks (JSDoc, docstrings, etc.) with their code anchors and flags potential staleness when the code changes.

## Features

### 🔍 Automatic Drift Detection

Drift analyzes your codebase to find documentation that may have become stale:

- **Parameter Mismatches** - Documentation mentions parameters that don't exist, or code has undocumented parameters
- **Return Type Drift** - Documented return types that don't match the code
- **Renamed Identifiers** - Detects when documented names may have been renamed in code
- **Description References** - Finds references to code elements in descriptions that no longer exist

### 📊 Staleness Dashboard

A sidebar view shows all documentation drift issues, organized by file and sorted by severity:

- 🔴 **Critical** - Major mismatches requiring immediate attention
- 🟠 **High** - Significant drift that should be addressed
- 🟡 **Medium** - Moderate issues to review
- ⚪ **Low** - Minor inconsistencies

### ✨ Visual Indicators

- **Gutter Icons** - Quick visual markers in the editor margin
- **Inline Decorations** - Subtle highlights on potentially stale documentation
- **Hover Information** - Detailed drift analysis on hover

### ✅ Review Workflow

- Mark documentation as "Reviewed" to dismiss warnings
- Drift remembers reviewed items across sessions
- Quick actions directly from hover messages

## Supported Languages

- TypeScript / JavaScript
- Python
- Go
- Rust
- Java
- (More coming soon: C/C++)

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Drift - Documentation Sync Detector"
4. Click Install

Or install from the command line:

```bash
code --install-extension pallaprolus.drift
```

## Usage

### Scan Your Workspace

1. Open the Command Palette (Ctrl+Shift+P)
2. Run "Drift: Scan Workspace for Documentation Drift"
3. Review results in the Drift Dashboard sidebar

### Scan Current File

1. Open a file
2. Run "Drift: Scan Current File" from the Command Palette

### Mark as Reviewed

- Click "Mark as Reviewed" in the hover message
- Or right-click an item in the Dashboard and select "Mark as Reviewed"

## Configuration

Configure Drift in your VS Code settings:

```json
{
  // Show gutter icons for drift warnings
  "drift.enableGutterIcons": true,
  
  // Show inline decorations
  "drift.enableInlineDecorations": true,
  
  // Files/folders to exclude from scanning
  "drift.excludePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**"
  ],
  
  // Languages to scan
  "drift.supportedLanguages": [
    "javascript",
    "typescript",
    "python"
  ],
  
  // Minimum drift score (0-1) to show warnings
  "drift.driftThreshold": 0.3
}
```

## How It Works

### 1. Parse Doc-Code Pairs

Drift parses your source files to identify documentation blocks and their associated code:

```typescript
/**
 * Calculate the total price with tax
 * @param price - The base price
 * @param taxRate - The tax rate as a decimal
 * @returns The total price including tax
 */
function calculateTotal(price: number, taxRate: number): number {
  return price * (1 + taxRate);
}
```

### 2. Analyze for Drift

When you modify the code, Drift detects potential documentation issues:

```typescript
/**
 * Calculate the total price with tax
 * @param price - The base price          // ✓ Still valid
 * @param taxRate - The tax rate          // ⚠️ Parameter renamed to 'tax'
 * @returns The total price including tax
 */
function calculateTotal(price: number, tax: number, discount?: number): number {
  //                                      ^^^           ^^^^^^^^
  //                           Parameter renamed    New undocumented parameter
  return (price * (1 + tax)) - (discount || 0);
}
```

### 3. Calculate Drift Score

Each doc-code pair receives a drift score (0-1) based on:

- Number and severity of mismatches
- Type of drift (parameter vs. return type vs. description)
- Confidence in the detection

## Commands

| Command | Description |
|---------|-------------|
| `Drift: Scan Workspace` | Scan all files for documentation drift |
| `Drift: Scan Current File` | Scan only the active file |
| `Drift: Mark as Reviewed` | Mark documentation as reviewed |
| `Drift: Show Dashboard` | Open the Drift Dashboard sidebar |
| `Drift: Refresh Dashboard` | Re-scan and update the dashboard |

## Contributing

Contributions are welcome! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

```bash
# Clone the repository
git clone https://github.com/pallaprolus/drift-vscode.git
cd drift-vscode

# Install dependencies
npm install

# Compile
npm run compile

# Run in development mode
code --extensionDevelopmentPath=.
```

### Adding Language Support

To add support for a new language:

1. Create a new parser in `src/parsers/` extending `BaseParser`
2. Implement `parseDocCodePairs()` and `extractCodeSignature()`
3. Register the parser in `ParserRegistry`

## Roadmap

- [x] Go support
- [x] Rust support
- [x] Java support
- [ ] README code block synchronization
- [ ] AI-powered semantic drift detection
- [ ] Git integration for change tracking
- [ ] Export reports (HTML, Markdown)

## Community & Impact
 
Drift is built to help developers maintain high-quality documentation. If this tool has saved you time or prevented bugs, I'd love to hear your story!
 
-   **Used in a project?** Add a badge to your README: `[![Drift](https://img.shields.io/badge/docs-drift-blue)](https://marketplace.visualstudio.com/items?itemName=pallaprolus.drift)`
 
## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

Built with ❤️ using the VS Code Extension API.

---

**Found a bug or have a suggestion?** [Open an issue](https://github.com/pallaprolus/drift-vscode/issues)
