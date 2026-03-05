# Canvus Terminal API

The Canvus terminal endpoint provides programmatic access to Canvus functionality via HTTP requests.

## Base URL

```
POST https://canvus.app/terminal
```

## Authentication

Currently, the terminal endpoint is open and doesn't require authentication. In production, you may want to add API key authentication.

## Commands

### 1. Echo

Returns the provided arguments as output.

**Request:**
```bash
curl -X POST https://canvus.app/terminal \
  -H "Content-Type: application/json" \
  -d '{"command": "echo", "args": ["Hello", "World"]}'
```

**Response:**
```json
{
  "success": true,
  "output": "Hello World"
}
```

### 2. Date

Returns the current date and time in ISO format.

**Request:**
```bash
curl -X POST https://canvus.app/terminal \
  -H "Content-Type: application/json" \
  -d '{"command": "date"}'
```

**Response:**
```json
{
  "success": true,
  "output": "2024-03-15T14:30:45.123Z"
}
```

### 3. Help

Returns available commands.

**Request:**
```bash
curl -X POST https://canvus.app/terminal \
  -H "Content-Type: application/json" \
  -d '{"command": "help"}'
```

**Response:**
```json
{
  "success": true,
  "output": "Available commands: echo, date, help, import"
}
```

### 4. Import (Main Feature)

Import a file to a specific Canvus page.

**Request:**
```bash
curl -X POST https://canvus.app/terminal \
  -H "Content-Type: application/json" \
  -d '{"command": "import", "args": ["habit.html", "https://canvus.app/#/file_dbmwsryv/page_main"]}'
```

**Parameters:**
- `args[0]`: Filename to import (e.g., "habit.html")
- `args[1]`: Target URL in the new format: `https://canvus.app/#/file_<fileId>/page_<pageId>`

**Response (Success):**
```json
{
  "success": true,
  "output": "Import scheduled: habit.html -> https://canvus.app/#/file_dbmwsryv/page_main"
}
```

**Response (Error - Invalid URL):**
```json
{
  "success": false,
  "error": "Invalid target URL format. Use: #/file_<fileId>/page_<pageId>"
}
```

**Response (Error - Missing Arguments):**
```json
{
  "success": false,
  "error": "import requires filename and target URL"
}
```

## URL Format Requirements

The import command requires the **new URL format** introduced in the Canvus URL refactoring:

✅ **Correct:** `https://canvus.app/#/file_dbmwsryv/page_main`
❌ **Incorrect:** `https://canvus.app/file_dbmwsryv` (legacy format)

The URL must contain both `file_<fileId>` and `page_<pageId>` components.

## Bash Script Usage

A convenience script `canvus_push.sh` is provided:

```bash
# Make executable
chmod +x canvus_push.sh

# Usage
./canvus_push.sh habit.html https://canvus.app/#/file_dbmwsryv/page_main
```

**Example Output:**
```
Canvus Push Tool
================

Validating target URL...
✅ URL format is valid

✅ File 'habit.html' found

Sending import request to Canvus...
Response:
{"success":true,"output":"Import scheduled: habit.html -> https://canvus.app/#/file_dbmwsryv/page_main"}

🎉 Import scheduled successfully!
📋 You can now open: https://canvus.app/#/file_dbmwsryv/page_main
```

## Error Handling

The terminal endpoint provides detailed error messages:

- **Missing command:** HTTP 400 with `{"error": "Missing command"}`
- **Invalid JSON:** HTTP 400 with `{"error": "Invalid JSON body"}`
- **Wrong method:** HTTP 405 with `{"error": "POST only"}`
- **Command-specific errors:** See individual command documentation

## Implementation Notes

- The terminal endpoint is implemented in `worker.js`
- It follows the same pattern as the existing `/ai` and `/generate` endpoints
- The import functionality currently returns a success message but would need to be connected to the actual import logic in a production environment
- URL validation ensures compatibility with the new Canvus URL structure

## Testing

Test pages are provided to verify functionality:
- `terminal_import_test.html` - Interactive test suite
- `test_terminal_endpoint.html` - General terminal endpoint tests