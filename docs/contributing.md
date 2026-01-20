# Contributing Guide

Thank you for your interest in contributing to the Polymarket Copy Trading Bot!

## How to Contribute

### Reporting Bugs

If you find a bug, please open an issue on GitHub including:

1.  Your OS and Node version.
2.  Steps to reproduce the error.
3.  Logs (remove any sensitive keys!).
4.  Expected vs Actual behavior.

### Feature Requests

We welcome ideas! Please describe:

1.  The problem you are solving.
2.  Your proposed solution.
3.  Any alternatives you considered.

### Pull Requests

1.  **Fork** the repository and clone it locally.
2.  Create a **new branch** for your feature or fix:
    ```bash
    git checkout -b feature/amazing-new-feature
    ```
3.  **Install dependencies** and ensure everything builds:
    ```bash
    npm install
    npm run build
    ```
4.  **Make your changes**.
    - Keep code style consistent (Prettier/ESLint configs included).
    - Add comments for complex logic.
5.  **Test your changes**.
    - Run the bot in Paper Trading mode to verify logic.
6.  **Commit** your changes with clear messages.
7.  **Push** to your fork and submit a Pull Request.

## Code Standards

- **TypeScript**: We use strict mode. Avoid `any` whenever possible.
- **Logging**: Use the `logger` utility, do not use `console.log` directly in backend code.
- **IPC**: Keep the IPC boundary clean. Data fetching logic belongs in `botService.ts` or `polymarket/`, not directly in `background.ts`.

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](../LICENSE).
