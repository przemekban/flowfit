const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Read stdin
let stdin = '';
try {
  stdin = fs.readFileSync(0, 'utf-8');
} catch (e) {
  // If no stdin or error, exit silently
  process.exit(0);
}

if (!stdin || stdin.trim() === '') {
  process.exit(0);
}

let eventData;
try {
  // Strip BOM if present (common in Windows PowerShell pipes)
  const cleanStdin = stdin.replace(/^\uFEFF/, '');
  eventData = JSON.parse(cleanStdin);
} catch (e) {
  console.error("Failed to parse stdin as JSON:", e.message);
  process.exit(1);
}

// In PostToolUse hook, the tool name and input are available in eventData.
const toolInput = eventData.tool_input || {};
const filePath = toolInput.file_path || toolInput.path || toolInput.TargetFile || toolInput.AbsolutePath;

if (!filePath) {
  // If no file path found in tool input, we just exit 0
  process.exit(0);
}

const resolvedPath = path.resolve(filePath);

// Check if the file exists (in case it was deleted by the tool)
if (!fs.existsSync(resolvedPath)) {
  console.log(`File does not exist: ${resolvedPath}. Skipping checks.`);
  process.exit(0);
}

console.log(`Running post-tool hook for file: ${resolvedPath}`);

// Run ESLint to auto-fix issues
try {
  console.log(`Linting file with eslint: ${filePath}`);
  execSync(`npx eslint --fix "${resolvedPath}"`, { stdio: 'inherit' });
} catch (e) {
  console.error(`ESLint failed for file: ${filePath}`);
  process.exit(2);
}

// Run Prettier to format the file
try {
  console.log(`Formatting file with prettier: ${filePath}`);
  execSync(`npx prettier --write "${resolvedPath}"`, { stdio: 'inherit' });
} catch (e) {
  console.error(`Prettier formatting failed for file: ${filePath}`);
  process.exit(2);
}

// Check if the file is in a risk area
const relativePath = path.relative(process.cwd(), resolvedPath).replace(/\\/g, '/');

const riskPatterns = [
  /^src\/pages\/api\//,
  /^src\/lib\/services\//,
  /^src\/middleware\.ts$/,
  /^src\/components\/session\//,
  /^src\/types\.ts$/,
  /^src\/lib\/validation\//
];

const isRiskFile = riskPatterns.some(pattern => pattern.test(relativePath));

if (isRiskFile) {
  console.log(`File is in risk area: ${relativePath}. Running related tests...`);
  try {
    execSync(`npx vitest related "${resolvedPath}" --run`, { stdio: 'inherit' });
    console.log(`Related tests passed!`);
  } catch (e) {
    console.error(`Vitest related tests failed for file: ${filePath}`);
    process.exit(2);
  }
} else {
  console.log(`File is not in risk area: ${relativePath}. Skipping related tests.`);
}

process.exit(0);
