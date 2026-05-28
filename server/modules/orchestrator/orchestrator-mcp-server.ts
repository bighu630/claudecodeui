import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';

import { handleOrchestratorToolCall } from './orchestrator.service.js';

function readOrchestratorSessionId(): string {
  const sessionId = process.env.ORCHESTRATOR_SESSION_ID?.trim();
  if (!sessionId) {
    throw new Error('Missing ORCHESTRATOR_SESSION_ID');
  }
  return sessionId;
}

function logMcpServer(message: string, details?: Record<string, unknown>): void {
  const payload = details && Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
  console.error(`[orchestrator-mcp] ${message}${payload}`);
}

async function main(): Promise<void> {
  const orchestratorSessionId = readOrchestratorSessionId();
  logMcpServer('starting stdio MCP server', {
    orchestratorSessionId,
    cwd: process.cwd(),
    tsxTsconfigPath: process.env.TSX_TSCONFIG_PATH || null,
    databasePath: process.env.DATABASE_PATH || null,
  });
  const server = new McpServer({
    name: 'orchestrator',
    version: '1.0.0',
  });

  server.registerTool(
    'orchestrator_lookup_role',
    {
      description: '查看某个角色的定位、职责、边界和输出偏好',
      inputSchema: {
        role_type: z.string(),
      },
    },
    async (args) => {
      try {
        logMcpServer('tool invoked', {
          toolName: 'orchestrator_lookup_role',
          orchestratorSessionId,
          args,
        });
        const result = await handleOrchestratorToolCall(
          'orchestrator_lookup_role',
          args,
          orchestratorSessionId,
        );
        logMcpServer('tool completed', {
          toolName: 'orchestrator_lookup_role',
          orchestratorSessionId,
          result: result.result,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.result),
            },
          ],
          structuredContent: result.result,
        };
      } catch (error) {
        logMcpServer('tool failed', {
          toolName: 'orchestrator_lookup_role',
          orchestratorSessionId,
          error: error instanceof Error ? error.message : String(error),
          code: (error as { code?: string })?.code || null,
          statusCode: (error as { statusCode?: number })?.statusCode || null,
        });
        throw error;
      }
    },
  );

  server.registerTool(
    'orchestrator_create_role',
    {
      description: '创建子角色会话',
      inputSchema: {
        role_type: z.string(),
        title: z.string(),
        goal: z.string(),
        constraints: z.string().optional(),
        custom_role_def: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args) => {
      try {
        logMcpServer('tool invoked', {
          toolName: 'orchestrator_create_role',
          orchestratorSessionId,
          args,
        });
        const result = await handleOrchestratorToolCall(
          'orchestrator_create_role',
          args,
          orchestratorSessionId,
        );
        logMcpServer('tool completed', {
          toolName: 'orchestrator_create_role',
          orchestratorSessionId,
          result: result.result,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.result),
            },
          ],
          structuredContent: result.result,
        };
      } catch (error) {
        logMcpServer('tool failed', {
          toolName: 'orchestrator_create_role',
          orchestratorSessionId,
          error: error instanceof Error ? error.message : String(error),
          code: (error as { code?: string })?.code || null,
          statusCode: (error as { statusCode?: number })?.statusCode || null,
        });
        throw error;
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logMcpServer('stdio MCP server connected');
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
