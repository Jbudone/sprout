import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import {
  MastraStorageExporter,
  MastraPlatformExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';
import { agent } from './agents/agent';
import { architectAgent } from './agents/architect';
import { builderAgent } from './agents/builder';
import { reviewerAgent } from './agents/reviewer';
import { mathCuratorAgent } from './agents/math-curator';
import { startScheduleTool, stopScheduleTool } from './tools/schedule-tools';
import { worktreeTool } from './tools/worktree-tool';
import { verifyMathTool } from './tools/verify-math';
import { featureDevWorkflow } from './workflows/feature-dev';

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  agents: { agent, architect: architectAgent, builder: builderAgent, reviewer: reviewerAgent, mathCurator: mathCuratorAgent },
  tools: { startScheduleTool, stopScheduleTool, worktreeTool, verifyMathTool },
  workflows: { featureDev: featureDevWorkflow },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: process.env.TURSO_DATABASE_URL || 'file:./mastra.db',
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
