# Canvus Tests

This directory contains test files for Canvus features.

## Test Files

### `test_export.html`
- **Purpose**: Simulates the import process for HTML files into Canvus.
- **Functionality**:
  - Handles URL parameters (`import`, `file`, `page`).
  - Simulates importing content and displays a success message.
  - Shows a preview of the imported content.
- **Use Case**: Testing the import workflow before full implementation.

### `test_terminal_endpoint.html`
- **Purpose**: Tests the terminal endpoint (`/terminal`) functionality.
- **Functionality**:
  - Tests commands like `echo`, `date`, `help`, and error handling.
  - Uses mock responses to simulate the terminal API.
- **Use Case**: Ensuring the terminal endpoint works as expected before deployment.

## Usage

To run the tests:
1. Open the test file in a browser.
2. Follow the on-screen instructions.
3. Verify the expected behavior.

## Notes

- These tests are for development and debugging purposes.
- They do not replace automated testing frameworks.
- Keep this directory clean and only include active test files.
