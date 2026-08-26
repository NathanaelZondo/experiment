# Experiment

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.0.

## Development server

To start a local development server, run:

```bash
ng serve
```

The dev server binds `0.0.0.0` (both IPv4 and IPv6 localhost). Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## LocalBench Chat

A local-AI chat workstation (Angular 22) that talks directly to an LM Studio server on `http://localhost:1234` (editable in the app; all state is RAM-only — refreshing clears chats and settings).

### Setup

1. Start LM Studio, load a model, and start the local server (**Developer → Start Server**, port `1234` by default).
2. Run `npm start` and open `http://localhost:4200/`.
3. Click **New chat**, load a model in the right-hand panel, then type your first message.

### Troubleshooting

- **Badge shows Disconnected/Failed**: the app re-probes LM Studio automatically — on startup, on window focus, and every ~15 s while disconnected — so a server started after the page loaded reconnects on its own. Make sure the server is started and CORS is enabled (**Developer → Server**).
- **Connected but sending does nothing**: you need an active conversation — click **New chat** first. (As a safety net the app now auto-creates one if a send still arrives without a conversation.)
- **Response stuck on "Generating…"**: LM Studio serves a **single generation slot**. If another request is running (another tab, LM Studio's own chat), yours queues silently. The app now shows *"Waiting for the model…"* after ~30 s of silence and fails the message cleanly after a hard timeout instead of hanging; click **Stop** to abort.
- **No visible answer from a reasoning model**: reasoning models think before answering (the thinking text streams under "Thinking…"). If the response ends with only reasoning, raise **Max output tokens** in the model settings or disable reasoning.
- **localhost / IPv4 vs IPv6**: the dev server now binds `0.0.0.0`. LM Studio's server binds IPv4 (`0.0.0.0`) — if your browser ever resolves `localhost` only to `::1`, open `http://127.0.0.1:4200` or set the Server URL in the app to `http://127.0.0.1:1234`.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
