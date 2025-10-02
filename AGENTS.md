# Repository Guidelines

## Project Structure & Module Organization
 hosts the FastAPI app, WebSocket hub, and upload endpoints. Persistence lives in , which seeds SQLite at . HTML views stay in , while  serves browser logic via . Room-specific files end up in . Store secrets like  as environment variables, not in source.

## Build, Test, and Development Commands
Create a virtualenv () and activate it ( on Windows or ). Install dependencies with . Start local development through . Inspect schema tweaks with . Run  for a fast syntax check before pushing.

## Coding Style & Naming Conventions
Stick to 4-space indentation and descriptive snake_case for functions, variables, and room names; reserve UpperCamelCase for future classes. Keep FastAPI endpoints typed and prefer small helper functions when websocket branches grow. In templates, indent Jinja blocks consistently and keep script helpers grouped inside  as lowerCamelCase utilities.

## Testing Guidelines
Automated tests are not yet committed; add new coverage under  using  when possible. Name files  and mock database access via temporary SQLite files. Until suites exist, manually confirm room creation, chat exchange, reconnection, and file uploads after changes, documenting findings in the PR.

## Commit & Pull Request Guidelines
Follow the existing log style with short, present-tense summaries such as , keeping them under 60 characters. Reference issues or tickets in the body and note any schema or protocol updates. Pull requests should describe scope, list manual or automated tests ( session, upload check), and attach UI screenshots or clips when front-end behavior shifts.

## Security & Configuration Tips
Export  before running admin APIs; never hard-code the value. Update the  constant deliberately so seeded spaces stay safe. Rely on  for uploads and avoid reusing original filenames. Periodically prune stale files under  and ensure backups for  when deploying.

## Debugging
Use the chromium engine to interact with the project webui, and capture the screen as image to the tmp directory that sits at the project root. Use the image to help debug issues or share with others for assistance.