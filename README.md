<div align="center">
  <img src="public/logo.svg" alt="CodeAgent UI" width="64" height="64">
  <h1>CodeAgent UI</h1>
  <p>A desktop and mobile UI for <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>, <a href="https://docs.cursor.com/en/cli/overview">Cursor CLI</a>, <a href="https://developers.openai.com/codex">Codex</a>, and <a href="https://geminicli.com/">Gemini-CLI</a>.<br>Use it locally or remotely to view your active projects and sessions from everywhere.</p>
</div>
<p align="center">
  <a href="https://github.com/bighu630/claudecodeui">GitHub</a> · <a href="https://github.com/bighu630/claudecodeui/issues">Bug Reports</a> · <a href="CONTRIBUTING.md">Contributing</a>
</p>

<div align="right"><i><b>English</b> · <a href="./README.ru.md">Русский</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.zh-CN.md">中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.tr.md">Türkçe</a></i></div>
---
## Role-Based Session System

CodeAgent UI uses a role-based session system to manage complex agent workflows. Each project gets two root session trees at creation time, and sessions follow a strict parent-child derivation hierarchy.

### Session Tree Structure

Each project is bootstrapped with two independent root sessions:

- **tech_lead** — handles architecture decisions, feasibility analysis, and requirements decomposition. Delegates implementation work to feature_lead sessions.
- **ops** — manages deployment, environment configuration, and infrastructure support. This root is independent and does not create child sessions.

Allowed derivations:

- `tech_lead → feature_lead` — a tech_lead session can create feature_lead children
- `feature_lead → worker` — a feature_lead session can create worker children
- `worker → ✗` — workers are execution-only and cannot spawn further sessions
- `ops → ✗` — ops sessions operate independently

### Role Responsibilities

| Role | Responsibility |
|---|---|
| **tech_lead** | Architecture decisions, feasibility assessment, requirements analysis. Hands off tasks to feature_lead. |
| **feature_lead** | Code-level planning, implementation decomposition, worker coordination. |
| **worker** | Strictly follows a task spec. Single responsibility. |
| **ops** | Deployment, environment, infrastructure support. |

### Empty Startup Strategy

Child sessions start in a blank state and receive only the minimum necessary handoff context (goal, constraints, task spec). Session history is **not** inherited from the parent. This prevents role leakage—a worker acts on its assigned task, not on the full conversation that produced it.

### Session vs Runtime Separation

The orchestrator session is a **logical identity** in the session tree, while the provider runtime (Claude, Codex, Cursor, or Gemini session) is the **execution carrier**. These are distinct concepts: one orchestrator session may bind to one runtime session via `external_session_id`, but the tree structure, role prompts, and lifecycle are managed independently from the runtime provider.

## Screenshots

<div align="center">
  
<table>
<tr>
<td align="center">
<h3>Desktop View</h3>
<img src="public/screenshots/desktop-main.png" alt="Desktop Interface" width="400">
<br>
<em>Main interface showing project overview and chat</em>
</td>
<td align="center">
<h3>Mobile Experience</h3>
<img src="public/screenshots/mobile-chat.png" alt="Mobile Interface" width="250">
<br>
<em>Responsive mobile design with touch navigation</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI Selection</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI Selection" width="400">
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
- **Plugin System** - Extend CodeAgent with custom plugins — add new tabs, backend services, and integrations. [Build your own →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)
- **TaskMaster AI Integration** *(Optional)* - Advanced project management with AI-powered task planning, PRD parsing, and workflow automation
- **Model Compatibility** - Works with Claude, GPT, and Gemini model families (see [`shared/modelConstants.js`](shared/modelConstants.js) for the full list of supported models)

## Quick Start

### Self-Hosted (Open source)

#### npm

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

Visit the **[documentation →](https://github.com/bighu630/claudecodeui)** for full configuration options, PM2, remote server setup and more.

#### Docker Sandboxes (Experimental)

Run agents in isolated sandboxes with hypervisor-level isolation. Starts Claude Code by default. Requires the [`sbx` CLI](https://docs.docker.com/ai/sandboxes/get-started/).

```
npx @codeagent-ui/codeagent@latest sandbox ~/my-project
```

Supports Claude Code, Codex, and Gemini CLI. See the [sandbox docs](docker/) for setup and advanced options.

## Which option is right for you?

You can self-host CodeAgent UI on your own machine or run it in a Docker sandbox for isolation.

| | Self-Hosted (npm) | Self-Hosted (Docker Sandbox) *(Experimental)* |
|---|---|---|
| **Best for** | Local agent sessions on your own machine | Isolated agents with web/mobile IDE  |
| **How you access it** | Browser via `[yourip]:port` | Browser via `localhost:port`  |
| **Setup** | `npx @codeagent-ui/codeagent` | `npx @codeagent-ui/codeagent@latest sandbox ~/project`  |
| **Isolation** | Runs on your host | Hypervisor-level sandbox (microVM)  |
| **Machine needs to stay on** | Yes | Yes |
| **Mobile access** | Any browser on your network | Any browser on your network  |
| **Agents supported** | Claude Code, Cursor CLI, Codex, Gemini CLI | Claude Code, Codex, Gemini CLI |
| **File explorer and Git** | Yes | Yes | 
| **MCP configuration** | Synced with `~/.claude` | Managed via UI |
| **REST API** | Yes | Yes | 
| **Team sharing** | No | No |
| **Platform cost** | Free, open source | Free, open source  |

> All options use your own AI subscriptions (Claude, Cursor, etc.) — CodeAgent provides the environment, not the AI.

---
## Security & Tools Configuration

**🔒 Important Notice**: All Claude Code tools are **disabled by default**. This prevents potentially harmful operations from running automatically.

### Enabling Tools

To use Claude Code's full functionality, you'll need to manually enable tools:

1. **Open Tools Settings** - Click the gear icon in the sidebar
2. **Enable Selectively** - Turn on only the tools you need
3. **Apply Settings** - Your preferences are saved locally

<div align="center">

![Tools Settings Modal](public/screenshots/tools-modal.png)
*Tools Settings interface - enable only what you need*

</div>

**Recommended approach**: Start with basic tools enabled and add more as needed. You can always adjust these settings later.
## Plugins

CodeAgent has a plugin system that lets you add custom tabs with their own frontend UI and optional Node.js backend. Install plugins from git repos directly in **Settings > Plugins**, or build your own.

### Available Plugins

| Plugin | Description |
|---|---|
| **[Project Stats](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** | Shows file counts, lines of code, file-type breakdown, largest files, and recently modified files for your current project |
| **[Web Terminal](https://github.com/cloudcli-ai/cloudcli-plugin-terminal)** | Full xterm.js terminal with multi-tab support|
| **[CloudCLI Scheduler](https://github.com/grostim/cloudcli-cron)** | Create workspace-scoped scheduled prompts and execute them through a local CLI such as Codex, Claude Code, or Gemini CLI|

### Build Your Own

**[Plugin Starter Template →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** — fork this repo to create your own plugin. It includes a working example with frontend rendering, live context updates, and RPC communication to a backend server.

**[Plugin Documentation →](https://github.com/cloudcli-ai/cloudcli-plugin-starter#readme)** — full guide to the plugin API, manifest format, security model, and more.

## FAQ

<details>
<summary>How is this different from Claude Code Remote Control?</summary>

Claude Code Remote Control lets you send messages to a session already running in your local terminal. Your machine has to stay on, your terminal has to stay open, and sessions time out after roughly 10 minutes without a network connection.

CodeAgent UI extends Claude Code rather than sit alongside it — your MCP servers, permissions, settings, and sessions are the exact same ones Claude Code uses natively. Nothing is duplicated or managed separately.

Here's what that means in practice:

- **All your sessions, not just one** — CodeAgent UI auto-discovers every session from your `~/.claude` folder. Remote Control only exposes the single active session to make it available in the Claude mobile app.
- **Your settings are your settings** — MCP servers, tool permissions, and project config you change in CodeAgent UI are written directly to your Claude Code config and take effect immediately, and vice versa.
- **Works with more agents** — Claude Code, Cursor CLI, Codex, and Gemini CLI, not just Claude Code.
- **Full UI, not just a chat window** — file explorer, Git integration, MCP management, and a shell terminal are all built in.
- **Docker Sandbox** — the sandbox runs isolated from your machine. Close your laptop and the agent keeps running.

</details>

<details>
<summary>Do I need to pay for an AI subscription separately?</summary>

Yes. CodeAgent provides the environment, not the AI. You bring your own Claude, Cursor, Codex, or Gemini subscription. Self-hosting is free and open source under AGPL-3.0.

</details>

<details>
<summary>Can I use CodeAgent UI on my phone?</summary>

Yes. Run the server on your machine and open `[yourip]:port` in any browser on your network — no VPN, no port forwarding needed. A native app is also in the works.

</details>

<details>
<summary>Will changes I make in the UI affect my local Claude Code setup?</summary>

Yes, for self-hosted. CodeAgent UI reads from and writes to the same `~/.claude` config that Claude Code uses natively. MCP servers you add via the UI show up in Claude Code immediately and vice versa.

</details>

---
## Community & Support

- **[Documentation](https://github.com/bighu630/claudecodeui)** — installation, configuration, features, and troubleshooting
- **[GitHub Issues](https://github.com/bighu630/claudecodeui/issues)** — bug reports and feature requests
- **[Contributing Guide](CONTRIBUTING.md)** — how to contribute to the project

## License

GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later) — see [LICENSE](LICENSE) for the full text, including additional terms under Section 7.

This project is open source and free to use, modify, and distribute under the AGPL-3.0-or-later license. If you modify this software and run it as a network service, you must make your modified source code available to users of that service.

CodeAgent UI — https://github.com/bighu630/claudecodeui

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

<div align="center">
  <strong>Made with care for the Claude Code, Cursor and Codex community.</strong>
</div>
