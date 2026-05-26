<div align="center">

> ## This package has moved to [`@codeagent-ui/codeagent`](https://www.npmjs.com/package/@codeagent-ui/codeagent)
>
> ```bash
> npm install -g @codeagent-ui/codeagent
> ```
>
> This package (`@codeagent-ui/codeagent-redirect`) is now a thin wrapper that installs the new package automatically.
> For new installations, use `@codeagent-ui/codeagent` directly.

</div>

---

<div align="center">
  <img src="https://raw.githubusercontent.com/bighu630/claudecodeui/main/public/logo.svg" alt="CodeAgent UI" width="64" height="64">
  <h1>Cloud CLI (aka Claude Code UI)</h1>
  <p>A desktop and mobile UI for <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>, <a href="https://docs.cursor.com/en/cli/overview">Cursor CLI</a>, <a href="https://developers.openai.com/codex">Codex</a>, and <a href="https://geminicli.com/">Gemini-CLI</a>.<br>Use it locally or remotely to view your active projects and sessions from everywhere.</p>
</div>

<p align="center">
</p>

<p align="center">
  <br><br>
</p>

---

## Screenshots

<div align="center">

<table>
<tr>
<td align="center">
<h3>Desktop View</h3>
<img src="https://raw.githubusercontent.com/bighu630/claudecodeui/main/public/screenshots/desktop-main.png" alt="Desktop Interface" width="400">
<br>
<em>Main interface showing project overview and chat</em>
</td>
<td align="center">
<h3>Mobile Experience</h3>
<img src="https://raw.githubusercontent.com/bighu630/claudecodeui/main/public/screenshots/mobile-chat.png" alt="Mobile Interface" width="250">
<br>
<em>Responsive mobile design with touch navigation</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI Selection</h3>
<img src="https://raw.githubusercontent.com/bighu630/claudecodeui/main/public/screenshots/cli-selection.png" alt="CLI Selection" width="400">
<br>
<em>Select between Claude Code, Gemini, Cursor CLI and Codex</em>
</td>
</tr>
</table>



</div>

## Features

- **Responsive Design** - Works seamlessly across desktop, tablet, and mobile so you can also use Agents from mobile
- **Interactive Chat Interface** - Built-in chat interface for seamless communication with the Agents
- **Integrated Shell Terminal** - Direct access to the Agents CLI through built-in shell functionality
- **File Explorer** - Interactive file tree with syntax highlighting and live editing
- **Git Explorer** - View, stage and commit your changes. You can also switch branches
- **Session Management** - Resume conversations, manage multiple sessions, and track history
- **Plugin System** - Extend CodeAgent with custom plugins — add new tabs, backend services, and integrations. [Build your own →](https://github.com/github.com/bighu630/claudecodeui/codeagent-plugin-starter)
- **TaskMaster AI Integration** *(Optional)* - Advanced project management with AI-powered task planning, PRD parsing, and workflow automation
- **Model Compatibility** - Works with Claude, GPT, and Gemini model families (see [`shared/modelConstants.js`](https://github.com/bighu630/claudecodeui/blob/main/shared/modelConstants.js) for the full list of supported models)


## Quick Start

### CodeAgent Cloud (Recommended)

The fastest way to get started — no local setup required. Get a fully managed, containerized development environment accessible from the web, mobile app, API, or your favorite IDE.

**[Get started with CodeAgent Cloud](https://github.com/bighu630/claudecodeui)**


### Self-Hosted (Open source)

Try CodeAgent UI instantly with **npx** (requires **Node.js** v22+):

```
npx @codeagent-ui/codeagent
```

Or install **globally** for regular use:

```
npm install -g @codeagent-ui/codeagent
codeagent
```

Open `http://localhost:3001` — all your existing sessions are discovered automatically.

Visit the **[documentation →](https://github.com/bighu630/claudecodeui/docs)** for more full configuration options, PM2, remote server setup and more


---

## Which option is right for you?

CodeAgent UI is the open source UI layer that powers CodeAgent Cloud. You can self-host it on your own machine, or use CodeAgent Cloud which builds on top of it with a full managed cloud environment, team features, and deeper integrations.

| | CodeAgent UI (Self-hosted) | CodeAgent Cloud |
|---|---|---|
| **Best for** | Developers who want a full UI for local agent sessions on their own machine | Teams and developers who want agents running in the cloud, accessible from anywhere |
| **How you access it** | Browser via `[yourip]:port` | Browser, any IDE, REST API, n8n |
| **Setup** | `npx @codeagent-ui/codeagent` | No setup required |
| **Machine needs to stay on** | Yes | No |
| **Mobile access** | Any browser on your network | Any device, native app coming |
| **Sessions available** | All sessions auto-discovered from `~/.claude` | All sessions within your cloud environment |
| **Agents supported** | Claude Code, Cursor CLI, Codex, Gemini CLI | Claude Code, Cursor CLI, Codex, Gemini CLI |
| **File explorer and Git** | Yes, built into the UI | Yes, built into the UI |
| **MCP configuration** | Managed via UI, synced with your local `~/.claude` config | Managed via UI |
| **IDE access** | Your local IDE | Any IDE connected to your cloud environment |
| **REST API** | Yes | Yes |
| **n8n node** | No | Yes |
| **Team sharing** | No | Yes |
| **Platform cost** | Free, open source | Starts at $7/month |

> Both options use your own AI subscriptions (Claude, Cursor, etc.) — CodeAgent provides the environment, not the AI.

---

## Security & Tools Configuration

**Important Notice**: All Claude Code tools are **disabled by default**. This prevents potentially harmful operations from running automatically.

### Enabling Tools

To use Claude Code's full functionality, you'll need to manually enable tools:

1. **Open Tools Settings** - Click the gear icon in the sidebar
2. **Enable Selectively** - Turn on only the tools you need
3. **Apply Settings** - Your preferences are saved locally

**Recommended approach**: Start with basic tools enabled and add more as needed. You can always adjust these settings later.

---

## Plugins

CodeAgent has a plugin system that lets you add custom tabs with their own frontend UI and optional Node.js backend. Install plugins from git repos directly in **Settings > Plugins**, or build your own.

### Available Plugins

| Plugin | Description |
|---|---|
| **[Project Stats](https://github.com/github.com/bighu630/claudecodeui/codeagent-plugin-starter)** | Shows file counts, lines of code, file-type breakdown, largest files, and recently modified files for your current project |
| **[Web Terminal](https://github.com/github.com/bighu630/claudecodeui/codeagent-plugin-terminal)** | Full xterm.js terminal with multi-tab support|

### Build Your Own

**[Plugin Starter Template →](https://github.com/github.com/bighu630/claudecodeui/codeagent-plugin-starter)** — fork this repo to create your own plugin. It includes a working example with frontend rendering, live context updates, and RPC communication to a backend server.

**[Plugin Documentation →](https://github.com/bighu630/claudecodeui/docs/plugin-overview)** — full guide to the plugin API, manifest format, security model, and more.

---
## FAQ

<details>
<summary>How is this different from Claude Code Remote Control?</summary>

Claude Code Remote Control lets you send messages to a session already running in your local terminal. Your machine has to stay on, your terminal has to stay open, and sessions time out after roughly 10 minutes without a network connection.

CodeAgent UI and CodeAgent Cloud extend Claude Code rather than sit alongside it — your MCP servers, permissions, settings, and sessions are the exact same ones Claude Code uses natively. Nothing is duplicated or managed separately.

Here's what that means in practice:

- **All your sessions, not just one** — CodeAgent UI auto-discovers every session from your `~/.claude` folder. Remote Control only exposes the single active session to make it available in the Claude mobile app.
- **Your settings are your settings** — MCP servers, tool permissions, and project config you change in CodeAgent UI are written directly to your Claude Code config and take effect immediately, and vice versa.
- **Works with more agents** — Claude Code, Cursor CLI, Codex, and Gemini CLI, not just Claude Code.
- **Full UI, not just a chat window** — file explorer, Git integration, MCP management, and a shell terminal are all built in.
- **CodeAgent Cloud runs in the cloud** — close your laptop, the agent keeps running. No terminal to babysit, no machine to keep awake.

</details>

<details>
<summary>Do I need to pay for an AI subscription separately?</summary>

Yes. CodeAgent provides the environment, not the AI. You bring your own Claude, Cursor, Codex, or Gemini subscription. CodeAgent Cloud starts at $7/month for the hosted environment on top of that.

</details>

<details>
<summary>Can I use CodeAgent UI on my phone?</summary>

Yes. For self-hosted, run the server on your machine and open `[yourip]:port` in any browser on your network. For CodeAgent Cloud, open it from any device — no VPN, no port forwarding, no setup. A native app is also in the works.

</details>

<details>
<summary>Will changes I make in the UI affect my local Claude Code setup?</summary>

Yes, for self-hosted. CodeAgent UI reads from and writes to the same `~/.claude` config that Claude Code uses natively. MCP servers you add via the UI show up in Claude Code immediately and vice versa.

</details>

---

## Community & Support

- **[Documentation](https://github.com/bighu630/claudecodeui/docs)** — installation, configuration, features, and troubleshooting
- **[GitHub Issues](https://github.com/bighu630/claudecodeui/issues)** — bug reports and feature requests
- **[Contributing Guide](https://github.com/bighu630/claudecodeui/blob/main/CONTRIBUTING.md)** — how to contribute to the project

## License

GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later) — see [LICENSE](https://github.com/bighu630/claudecodeui/blob/main/LICENSE) for the full text, including additional terms under Section 7.

This project is open source and free to use, modify, and distribute under the AGPL-3.0-or-later license. If you modify this software and run it as a network service, you must make your modified source code available to users of that service.

CodeAgent UI  - (https://github.com/bighu630/claudecodeui).

## Acknowledgments

### Built With
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic's official CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor's official CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[Gemini-CLI](https://geminicli.com/)** - Google Gemini CLI
- **[React](https://react.dev/)** - User interface library
- **[Vite](https://vitejs.dev/)** - Fast build tool and dev server
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[CodeMirror](https://codemirror.net/)** - Advanced code editor
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(Optional)* - AI-powered project management and task planning


### Sponsors
---

<div align="center">
  <strong>Made with care for the Claude Code, Cursor and Codex community.</strong>
</div>
