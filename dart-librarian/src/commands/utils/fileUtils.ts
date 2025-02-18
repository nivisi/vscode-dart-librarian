import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Traverses up from the given URI to find a folder named "lib".
 */
export function findLibDirectorySync(uri: vscode.Uri): vscode.Uri | undefined {
    let currentDir = path.dirname(uri.fsPath);
    while (currentDir !== path.dirname(currentDir)) {
        if (path.basename(currentDir) === 'lib') {
            return vscode.Uri.file(currentDir);
        }
        currentDir = path.dirname(currentDir);
    }
    return undefined;
}

/**
 * Checks whether the given URI is within a "lib" folder.
 */
export function isInLibFolder(uri: vscode.Uri): boolean {
    return !!findLibDirectorySync(uri);
}

/**
 * Asynchronously finds the nearest "lib" folder.
 * (Here it wraps the sync version; you could later extend it for more advanced logic.)
 */
export async function findLibDirectory(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
    return findLibDirectorySync(uri);
} 