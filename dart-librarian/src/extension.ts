// VS Code extensibility API
import * as vscode from 'vscode';
import { registerExportInCommand } from './commands/exportIn';
import { registerRemoveExportCommand } from './commands/removeExport';

// Activates when extension is first executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Dart Librarian extension is now active');
	registerExportInCommand(context);
	registerRemoveExportCommand(context);
}

// Cleanup when extension is deactivated
export function deactivate() { }
