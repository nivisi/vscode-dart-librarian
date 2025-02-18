import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface ExportFile {
    fsPath: string;
    relativePath: string;
    hasLibrary: boolean;
}

interface ExportQuickPickItem extends vscode.QuickPickItem {
    file?: ExportFile;
    isCreateNew?: boolean;
}

// Register the export-in command.
export async function registerExportInCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('dart-librarian.exportIn', async (uri?: vscode.Uri) => {
        // Use the provided URI if available; otherwise, use the active editor.
        if (!uri) {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor || !activeEditor.document.fileName.endsWith('.dart') || !isInLibFolder(activeEditor.document.uri)) {
                vscode.window.showErrorMessage('Please select a Dart file in the lib directory.');
                return;
            }
            uri = activeEditor.document.uri;
        } else {
            // Ensure the selected file is a Dart file within the lib directory.
            if (!uri.fsPath.endsWith('.dart') || !isInLibFolder(uri)) {
                vscode.window.showErrorMessage('Please select a Dart file within the lib directory.');
                return;
            }
        }

        // Find the lib folder.
        const libDir = await findLibDirectory(uri);
        if (!libDir) {
            vscode.window.showErrorMessage('Could not find lib directory.');
            return;
        }

        // Get potential export files from the lib folder.
        let exportFiles = await findExportFiles(libDir);
        // Filter out the source file itself.
        exportFiles = exportFiles.filter(file => file.fsPath !== uri.fsPath);

        let targetFile: ExportFile;
        if (exportFiles.length === 0) {
            // No valid export file found—prompt to create one.
            const fileName = await vscode.window.showInputBox({
                prompt: 'No export file found. Enter the new file name (relative to lib)',
                placeHolder: 'e.g., exports.dart or subfolder/exports.dart'
            });
            if (!fileName) {
                return;
            }
            targetFile = await createNewFile(libDir, fileName);
        } else {
            // Build QuickPick items.
            const items: ExportQuickPickItem[] = exportFiles.map(file => ({
                label: file.relativePath,
                description: file.hasLibrary ? '(has library)' : '',
                file
            }));
            items.push({ label: '$(new-file) Create new file...', description: '', isCreateNew: true });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select or create a file to export to'
            });
            if (!selected) {
                return;
            }
            if (selected.isCreateNew) {
                const fileName = await vscode.window.showInputBox({
                    prompt: 'Enter the new file name (relative to lib)',
                    placeHolder: 'e.g., exports.dart or subfolder/exports.dart'
                });
                if (!fileName) {
                    return;
                }
                targetFile = await createNewFile(libDir, fileName);
            } else if (selected.file) {
                targetFile = selected.file;
            } else {
                return;
            }
        }

        // Add export statement to the target file.
        await addExportStatement(uri, targetFile);
    });

    context.subscriptions.push(disposable);
}

// Helper to check if a URI is within the lib folder.
function isInLibFolder(uri: vscode.Uri): boolean {
    const libDir = findLibDirectorySync(uri);
    return !!libDir;
}

// Synchronous version to quickly check lib directory.
function findLibDirectorySync(uri: vscode.Uri): vscode.Uri | undefined {
    let currentDir = path.dirname(uri.fsPath);
    while (currentDir !== path.dirname(currentDir)) {
        if (path.basename(currentDir) === 'lib') {
            return vscode.Uri.file(currentDir);
        }
        currentDir = path.dirname(currentDir);
    }
    return undefined;
}

// Finds the nearest lib folder by traversing up from the given file.
async function findLibDirectory(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
    return findLibDirectorySync(uri);
}

// Finds all Dart export files directly inside the lib folder.
async function findExportFiles(libDir: vscode.Uri): Promise<ExportFile[]> {
    const result: ExportFile[] = [];
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(libDir, '*.dart'));
    for (const file of files) {
        // Exclude files with a leading underscore (private files)
        if (path.basename(file.fsPath).startsWith('_')) {
            continue;
        }
        const content = (await vscode.workspace.fs.readFile(file)).toString();
        const hasLibrary = /^library\s+/m.test(content);
        result.push({
            fsPath: file.fsPath,
            relativePath: path.relative(libDir.fsPath, file.fsPath),
            hasLibrary
        });
    }
    return result;
}

// Creates a new Dart export file.
async function createNewFile(libDir: vscode.Uri, fileName: string): Promise<ExportFile> {
    const fullPath = path.join(libDir.fsPath, fileName);
    const dirName = path.dirname(fullPath);
    if (!fs.existsSync(dirName)) {
        fs.mkdirSync(dirName, { recursive: true });
    }
    fs.writeFileSync(fullPath, '');
    return {
        fsPath: fullPath,
        relativePath: path.relative(libDir.fsPath, fullPath),
        hasLibrary: false
    };
}

// Adds the export statement and sorts it among existing relative exports.
async function addExportStatement(sourceFile: vscode.Uri, targetFile: ExportFile): Promise<void> {
    const document = await vscode.workspace.openTextDocument(targetFile.fsPath);
    const relativePath = path.relative(path.dirname(targetFile.fsPath), sourceFile.fsPath).replace(/\\/g, '/');
    const exportStatement = `export '${relativePath}';`;

    const lines = document.getText().split('\n');

    // Prevent duplicate export.
    if (lines.some(line => line.trim() === exportStatement)) {
        vscode.window.showWarningMessage('This export statement already exists.');
        return;
    }

    // Look for existing relative exports (exclude package exports)
    const relativeExports = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed.startsWith("export '") && !trimmed.startsWith("export 'package:");
    }).map(line => line.trim());

    const edit = new vscode.WorkspaceEdit();
    if (relativeExports.length > 0) {
        // Replace the export block with our custom sorted exports.
        const newExports = sortExportStatements([...relativeExports, exportStatement]);

        // Find the starting index of the relative export block.
        const startIndex = lines.findIndex(line => {
            const trimmed = line.trim();
            return trimmed.startsWith("export '") && !trimmed.startsWith("export 'package:");
        });
        let endIndex = startIndex;
        for (let i = startIndex; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith("export '") && !trimmed.startsWith("export 'package:")) {
                endIndex = i;
            } else {
                break;
            }
        }

        const range = new vscode.Range(
            new vscode.Position(startIndex, 0),
            new vscode.Position(endIndex + 1, 0)
        );
        edit.replace(document.uri, range, newExports.join('\n') + '\n');
    } else {
        // Determine a fallback insert position: after library declaration or package exports.
        let insertPosition = document.lineCount;
        for (let i = 0; i < lines.length; i++) {
            if (/^library\s+/.test(lines[i].trim()) || /^export\s+'package:/.test(lines[i].trim())) {
                insertPosition = i + 1;
            }
        }
        // Insert an extra newline to preserve one empty line below the new export.
        edit.insert(document.uri, new vscode.Position(insertPosition, 0), exportStatement + '\n\n');
    }

    await vscode.workspace.applyEdit(edit);
    // Save the file automatically after the edit.
    await document.save();

    // Highlight the newly added export.
    const updatedDocument = await vscode.workspace.openTextDocument(targetFile.fsPath);
    const updatedLines = updatedDocument.getText().split('\n');
    const exportLineNumber = updatedLines.findIndex(line => line.trim() === exportStatement);
    if (exportLineNumber !== -1) {
        const lineRange = updatedDocument.lineAt(exportLineNumber).range;
        const updatedEditor = await vscode.window.showTextDocument(updatedDocument);
        updatedEditor.selection = new vscode.Selection(lineRange.start, lineRange.end);
        updatedEditor.revealRange(lineRange);
    }
}

// Add this helper function (e.g., after createNewFile, before addExportStatement)
function sortExportStatements(exportsArr: string[]): string[] {
    return exportsArr.sort((a, b) => {
        const regex = /export\s+'(.*)';/;
        const matchA = a.match(regex);
        const matchB = b.match(regex);
        if (!matchA || !matchB) {
            return a.localeCompare(b);
        }

        // Get the full path from the export statement, e.g., "subfolder/abc.dart"
        const fileAFull = matchA[1];
        const fileBFull = matchB[1];

        // Use the basename for comparison
        const fileNameA = path.basename(fileAFull);
        const fileNameB = path.basename(fileBFull);

        // Determine if the file is a freezed file.
        const isFreezedA = fileNameA.endsWith(".freezed.dart");
        const isFreezedB = fileNameB.endsWith(".freezed.dart");

        // Remove the extension: if freezed, remove ".freezed.dart", otherwise remove ".dart"
        const baseA = isFreezedA ? fileNameA.slice(0, -".freezed.dart".length)
            : fileNameA.slice(0, -".dart".length);
        const baseB = isFreezedB ? fileNameB.slice(0, -".freezed.dart".length)
            : fileNameB.slice(0, -".dart".length);

        // If the base names are identical, non-freezed should come first.
        if (baseA === baseB) {
            if (isFreezedA !== isFreezedB) {
                return isFreezedA ? 1 : -1;
            }
            return 0;
        }

        // If one base is a prefix of the other (e.g. "abc" vs "abc_abc"),
        // the shorter (non‑underscored) file should come first.
        if (baseA.startsWith(baseB) || baseB.startsWith(baseA)) {
            if (isFreezedA !== isFreezedB) {
                return isFreezedA ? 1 : -1;
            }
            return baseA.length - baseB.length;
        }

        // Otherwise, use a localeCompare with numeric and base sensitivity.
        return baseA.localeCompare(baseB, undefined, { numeric: true, sensitivity: 'base' });
    });
} 