# Drift - Documentation Sync Detector

<img src="./images/icon.png" width="128" alt="Drift Logo" />

**Drift** detects when your documentation drifts out of sync with your code. It pairs documentation blocks (JSDoc, docstrings, README code blocks, etc.) with their code anchors and flags potential staleness when the code changes.

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
- Quick Fixes to add missing or remove stale `@param` tags

### 📝 README Code Block Sync

Drift checks fenced code blocks in `README.md` and `docs/**/*.md` against the real code:

- **Renamed symbols** - The README calls `formatUsrName()` but the code now defines `formatUserName()`
- **Stale signatures** - A `function calculateTotal(price, taxRate)` example when the code has `(price, tax, discount)`
- **Wrong argument counts** - `calculateTotal(10)` when the function needs two arguments
- **Removed functions** - Examples that document a function that no longer exists

Issues show up in the dashboard, as CodeLens on the code block, and in the gutter of the Markdown file.

### 🌿 Git Change Tracking

When the workspace is a Git repository, Drift uses `git blame` and the working-tree diff to catch drift that signature matching cannot see:

- **Uncommitted code edits** whose documentation was not touched
- **Docs that are older than the code** - code committed more than `drift.git.staleDays` after the docs last changed

No extra setup: it works with the `git` on your `PATH` and is cached per file.

### ✨ AI Semantic Checks (opt-in, on demand)

Signature checks can't tell you that a docstring says "throws when missing" while the code now returns `undefined`. For that, Drift can ask an AI model:

- Click the **AI Check** CodeLens above any documented function, or run **Drift: AI Check All Documentation in Current File**
- Uses the **VS Code Language Model API** (for example GitHub Copilot) with no setup, or the **Anthropic API** with your own key stored in VS Code's secret storage
- Drift **never** sends code to a model automatically. Every check is something you trigger, and the CodeLens can be hidden with `drift.ai.provider: "off"`

### 📤 Export Reports

**Drift: Export Report** writes the current findings as **Markdown** (for pull requests and wikis), a self-contained **HTML** page, or **JSON** for CI pipelines.

## Supported Languages

- TypeScript / JavaScript (JSDoc)
- Python (Sphinx, Google, and NumPy docstrings)
- Go
- Rust
- Java (Javadoc)
- Markdown code blocks in README and docs (cross-checked against the languages above)

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

### Run an AI Check

1. Place the cursor on a documented function and run "Drift: AI Check Documentation at Cursor", or click the **AI Check** CodeLens
2. The first time, VS Code asks for permission to use a language model (if you use Copilot), or run "Drift: Set Anthropic API Key" to use the Anthropic API instead
3. Findings are added to the hover, dashboard, and reports like any other drift reason

### Export a Report

1. Scan the workspace
2. Run "Drift: Export Report" (also available from the dashboard toolbar)
3. Choose Markdown, HTML, or JSON and pick where to save it

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
    "javascriptreact",
    "typescriptreact",
    "python",
    "go",
    "java",
    "rust"
  ],
  
  // Minimum drift score (0-1) to show warnings
  "drift.driftThreshold": 0.3,

  // Check README / docs code blocks against the code
  "drift.scanMarkdown": true,
  "drift.markdownPatterns": ["**/README.md", "**/docs/**/*.md"],

  // Git-based change tracking
  "drift.git.enabled": true,
  "drift.git.staleDays": 30,

  // AI semantic checks: "auto" | "anthropic" | "vscode" | "off"
  "drift.ai.provider": "auto",
  "drift.ai.model": "claude-opus-5"
}
```

### AI provider notes

- `auto` uses the Anthropic API when a key has been saved with "Drift: Set Anthropic API Key", and otherwise falls back to the VS Code Language Model API (GitHub Copilot or another chat provider).
- The Anthropic key is stored in VS Code's encrypted secret storage, never in settings files.
- Only the documentation block and the function body you check are sent. Nothing is sent without an explicit command or CodeLens click.

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
| `Drift: Scan Workspace` | Scan all files (and README/docs code blocks) for documentation drift |
| `Drift: Scan Current File` | Scan only the active file |
| `Drift: Mark as Reviewed` | Mark documentation as reviewed |
| `Drift: Show Dashboard` | Open the Drift Dashboard sidebar |
| `Drift: Refresh Dashboard` | Re-scan and update the dashboard |
| `Drift: Export Report` | Save findings as Markdown, HTML, or JSON |
| `Drift: AI Check Documentation at Cursor` | Ask an AI model whether the docs still describe the function |
| `Drift: AI Check All Documentation in Current File` | Run the AI check for every documented symbol in the file |
| `Drift: Set Anthropic API Key` | Store an Anthropic key in secret storage for AI checks |
| `Drift: Clear Anthropic API Key` | Remove the stored key |

## Contributing

Contributions are welcome! Open an issue first for larger changes so we can agree on the approach.

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

# Run the unit tests
npm run test:unit
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
- [x] README code block synchronization
- [x] AI-powered semantic drift detection
- [x] Git integration for change tracking
- [x] Export reports (HTML, Markdown, JSON)

Ideas for what comes next are tracked in [GitHub issues](https://github.com/pallaprolus/drift-vscode/issues). C/C++ support and a CI-friendly command-line runner are the most requested.

## Community & Impact
 
Drift is built to help developers maintain high-quality documentation. If this tool has saved you time or prevented bugs, I'd love to hear your story!
 
-   **Used in a project?** Add a badge to your README: `[![Drift](https://img.shields.io/badge/docs-drift-blue)](https://marketplace.visualstudio.com/items?itemName=pallaprolus.drift)`
 
## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

Built with ❤️ using the VS Code Extension API.

---

**Found a bug or have a suggestion?** [Open an issue](https://github.com/pallaprolus/drift-vscode/issues)
