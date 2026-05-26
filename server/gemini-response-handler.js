// Gemini Response Handler - JSON Stream processing
import { sessionsService } from './modules/providers/index.js';
import {
  bindChildRuntimeFromTool,
  materializeAndBindChildSessionFromTool,
} from './modules/orchestrator/index.js';

class GeminiResponseHandler {
  constructor(ws, options = {}) {
    this.ws = ws;
    this.buffer = '';
    this.onContentFragment = options.onContentFragment || null;
    this.onInit = options.onInit || null;
    this.onToolUse = options.onToolUse || null;
    this.onToolResult = options.onToolResult || null;
    this.orchestratorSessionId = options.orchestratorSessionId || null;
  }

  // Process incoming raw data from Gemini stream-json
  processData(data) {
    this.buffer += data;

    // Split by newline
    const lines = this.buffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line);
        this.handleEvent(event);
      } catch (err) {
        // Not a JSON line, probably debug output or CLI warnings
      }
    }
  }

  handleEvent(event) {
    const sid = typeof this.ws.getSessionId === 'function' ? this.ws.getSessionId() : null;

    if (event.type === 'init') {
      if (this.onInit) {
        this.onInit(event);
      }
      return;
    }

    // Invoke per-type callbacks for session tracking
    if (event.type === 'message' && event.role === 'assistant') {
      const content = event.content || '';
      if (this.onContentFragment && content) {
        this.onContentFragment(content);
      }
    } else if (event.type === 'tool_use' && this.onToolUse) {
      this.onToolUse(event);
    } else if (event.type === 'tool_result' && this.onToolResult) {
      this.onToolResult(event);
    }

    // Normalize via adapter and send all resulting messages
    const normalized = sessionsService.normalizeMessage('gemini', event, sid);
    for (const msg of normalized) {
      if (this.orchestratorSessionId && msg.kind === 'tool_use') {
          console.log("[DEBUG][gemini-handler] -> materializeAndBindChildSessionFromTool toolName=" + msg.toolName + " toolId=" + msg.toolId);
        materializeAndBindChildSessionFromTool(this.orchestratorSessionId, {
          toolName: msg.toolName,
          toolInput: msg.toolInput,
          toolId: msg.toolId,
          runtimeInfo: msg.toolUseResult || msg.toolResult?.toolUseResult || msg.content || event,
        });
      }
      if (this.orchestratorSessionId && msg.kind === 'tool_result') {
        bindChildRuntimeFromTool(this.orchestratorSessionId, {
          toolId: msg.toolId,
          runtimeInfo: msg.toolUseResult || msg.toolResult?.toolUseResult || msg.content,
        });
      }
      this.ws.send(msg);
    }
  }

  forceFlush() {
    if (this.buffer.trim()) {
      try {
        const event = JSON.parse(this.buffer);
        this.handleEvent(event);
      } catch (err) { }
    }
  }

  destroy() {
    this.buffer = '';
  }
}

export default GeminiResponseHandler;
