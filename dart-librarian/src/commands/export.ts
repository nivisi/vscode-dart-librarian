import * as path from 'path';
import * as vscode from 'vscode';
import { ExportFile } from './interfaces/exportFile';
import { ExportQuickPickItem } from './interfaces/exportQuickPickItem';
import { findExportFiles } from './utils/dartFileUtils';
import { findLibDirectory, isInLibFolder } from './utils/fileUtils';
// Register the export command.
export async function registerExportCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('dart-librarian.export', async (uri?: vscode.Uri) => {
        try {
            // Use the provided URI if available; otherwise, use the active editor.
            if (!uri) {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor ||
                    !activeEditor.document.fileName.endsWith('.dart') ||
                    !isInLibFolder(activeEditor.document.uri)) {
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
            exportFiles = exportFiles.filter(file => file.fsPath !== uri?.fsPath);

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
        } catch (error: any) {
            vscode.window.showErrorMessage(`An error occurred during export: ${error.message}`);
        }
    });

    context.subscriptions.push(disposable);
}

// Updated: Creates a new Dart export file using asynchronous file operations.
async function createNewFile(libDir: vscode.Uri, fileName: string): Promise<ExportFile> {
    const fullPath = path.join(libDir.fsPath, fileName);
    const dirName = path.dirname(fullPath);
    const dirUri = vscode.Uri.file(dirName);

    // Ensure the directory exists.
    await vscode.workspace.fs.createDirectory(dirUri);
    const fileUri = vscode.Uri.file(fullPath);
    // Write an empty file.
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(''));

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

// Sorts the export statements. (No changes here; just retained for completeness.)
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

        // Extract the base name by removing any additional extensions.
        const baseA = fileNameA.split('.').slice(0, -1).join('.');
        const baseB = fileNameB.split('.').slice(0, -1).join('.');

        // If the base names are identical, the file with fewer extensions should come first.
        if (baseA === baseB) {
            return fileNameA.split('.').length - fileNameB.split('.').length;
        }

        // If one base is a prefix of the other (e.g. "abc" vs "abc_abc"),
        // the shorter (non‑underscored) file should come first.
        if (baseA.startsWith(baseB) || baseB.startsWith(baseA)) {
            return baseA.length - baseB.length;
        }

        // Otherwise, use a localeCompare with numeric and base sensitivity.
        return baseA.localeCompare(baseB, undefined, { numeric: true, sensitivity: 'base' });
    });
} 