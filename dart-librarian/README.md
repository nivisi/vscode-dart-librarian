# Dart Librarian 1.0.1

**dart-librarian** is a VS Code extension that simplifies exporting files to `library` files.

## Features

### Export

- Focus a file in the explorer / editor that you want to export;
- Run the `Export` command (by executing it through the command palette or the assigned keybinding);
- Select the library file you want to export the files to;
- Done ✅

### Remove Export

- Focus a file in the explorer / editor that is exported from a library;
- Run the `Remove Export` command (by executing it through the command palette or the assigned keybinding);
- Done ✅

## Limitations

Right now, the extension only considers files in the `lib` directory. For example, if you have the following structure:

```
lib/
  src/
    extensions/
      extension_a.dart
      extension_b.dart
    util/
      util_a.dart
      util_b.dart
  utilities.dart
```

After executing the `Export` command on the file `util/util_a.dart`, the extension will suggest exporting to the `utilities.dart` file, or to create a new file for export immediately.

## Contributing

Pull Requests / Ideas are welcome. If you have any idea, please create an issue with the idea / proposal.

If you'd like to contribute to resolve an existing issue, please:

- Fork the repository;
- Create a branch for your changes;
- Submit a pull request with a clear description of your updates.

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.
