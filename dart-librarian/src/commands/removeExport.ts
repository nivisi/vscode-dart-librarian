import * as path from 'path';
import * as vscode from 'vscode';

// Represents a library/export file
interface ExportFile {
    fsPath: string;
    relativePath: string;
    hasLibrary: boolean;
}

// Register the remove-export command.
export async function registerRemoveExportCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('dart-librarian.removeExport', async (uri?: vscode.Uri) => {
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

        // Find the nearest lib folder.
        const libDir = await findLibDirectory(uri);
        if (!libDir) {
            vscode.window.showErrorMessage('Could not find lib directory.');
            return;
        }

        // Get all Dart files in lib.
        let libraryFiles = await findExportFiles(libDir);
        // Only consider files that are not the target itself.
        libraryFiles = libraryFiles.filter(f => f.fsPath !== uri.fsPath);

        // Keep only files that actually export the given file.
        const candidates: ExportFile[] = [];
        for (const libFile of libraryFiles) {
            const expectedExport = getExportStatement(libFile, uri);
            const fileContent = (await vscode.workspace.fs.readFile(vscode.Uri.file(libFile.fsPath))).toString();
            const fileLines = fileContent.split('\n').map(line => line.trim());
            if (fileLines.includes(expectedExport)) {
                candidates.push(libFile);
            }
        }

        if (libraryFiles.length === 0) {
            vscode.window.showInformationMessage('No library file is available.');
            return;
        }
        if (candidates.length === 0) {
            vscode.window.showWarningMessage('No library file exports this file.');
            return;
        }

        // Let the user select from files that export this file.
        const items = candidates.map(libFile => ({
            label: libFile.relativePath,
            description: libFile.hasLibrary ? '(has library)' : '',
            file: libFile
        }));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select the library file to remove export from'
        });
        if (!selected || !selected.file) {
            return;
        }

        // Remove the export statement.
        await removeExportStatement(uri, selected.file);
    });
    context.subscriptions.push(disposable);
}

// Computes the expected export statement from a library file to the target file.
function getExportStatement(libraryFile: ExportFile, targetUri: vscode.Uri): string {
    const relativePath = path.relative(path.dirname(libraryFile.fsPath), targetUri.fsPath).replace(/\\/g, '/');
    return `export '${relativePath}';`;
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
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(libDir, '**/*.dart'));
    for (const file of files) {
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

// Removes the export statement from the library file.
// Why: We remove the export by scanning for blocks of relative exports so that the removal works even if grouped.
async function removeExportStatement(targetFileUri: vscode.Uri, libFile: ExportFile): Promise<void> {
    const document = await vscode.workspace.openTextDocument(libFile.fsPath);
    const lines = document.getText().split('\n');
    const exportStmt = getExportStatement(libFile, targetFileUri);

    // Identify a continuous block of relative exports.
    let blockStart = -1;
    let blockEnd = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^export\s+'(?!package:)/.test(lines[i].trim())) {
            if (blockStart === -1) {
                blockStart = i;
            }
            blockEnd = i;
        } else if (blockEnd !== -1) {
            break;
        }
    }

    const edit = new vscode.WorkspaceEdit();
    let modified = false;
    if (blockStart !== -1 && blockEnd !== -1) {
        // Rebuild the export block excluding the target export.
        const blockLines = lines.slice(blockStart, blockEnd + 1);
        const newBlock = blockLines.filter(line => line.trim() !== exportStmt);
        if (newBlock.length !== blockLines.length) {
            const range = new vscode.Range(new vscode.Position(blockStart, 0), new vscode.Position(blockEnd + 1, 0));
            edit.replace(document.uri, range, newBlock.join('\n') + (newBlock.length > 0 ? '\n' : ''));
            modified = true;
        }
    }
    if (!modified) {
        // If not part of a block, try to remove the line individually.
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === exportStmt) {
                const range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i + 1, 0));
                edit.delete(document.uri, range);
                modified = true;
                break;
            }
        }
    }
    if (!modified) {
        vscode.window.showWarningMessage('Export statement not found in the selected library file.');
        return;
    }
    await vscode.workspace.applyEdit(edit);
    // Open the updated file so that tests can verify the change.
    const updatedDocument = await vscode.workspace.openTextDocument(libFile.fsPath);
    await vscode.window.showTextDocument(updatedDocument);
} 