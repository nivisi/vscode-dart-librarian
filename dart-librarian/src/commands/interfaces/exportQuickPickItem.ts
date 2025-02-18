import * as vscode from 'vscode';
import { ExportFile } from "./exportFile";

export interface ExportQuickPickItem extends vscode.QuickPickItem {
    file?: ExportFile;
    isCreateNew?: boolean;
}