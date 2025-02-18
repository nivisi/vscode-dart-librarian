import path from "path";
import * as vscode from 'vscode';
import { ExportFile } from "../interfaces/exportFile";

export async function findExportFiles(libDir: vscode.Uri): Promise<ExportFile[]> {
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