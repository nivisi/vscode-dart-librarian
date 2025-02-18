// VS Code extensibility API
import * as vscode from 'vscode';
import { registerExportCommand } from './commands/export';
import { registerRemoveExportCommand } from './commands/removeExport';

// Activates when extension is first executed
export function activate(context: vscode.ExtensionContext) {
	registerExportCommand(context);
	registerRemoveExportCommand(context);
}

// Cleanup when extension is deactivated
export function deactivate() { }
