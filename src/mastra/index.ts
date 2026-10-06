import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MySQLStore } from '@mastra/mysql';
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
import { experimenterAgent } from './agents/experimenter';
import { reviewerAgent } from './agents/reviewer';
import { mathCuratorAgent } from './agents/math-curator';
import { contentQualityAgent } from './agents/content-quality';
import { contentAuthorAgent } from './agents/content-author';
import { startScheduleTool, stopScheduleTool } from './tools/schedule-tools';
import { worktreeTool } from './tools/worktree-tool';
import { verifyMathTool } from './tools/verify-math';
import { verifyTriviaTool } from './tools/verify-trivia';
import { ideasTool } from './tools/ideas-tool';
import { contentLibraryTool } from './tools/content-library-tool';
import { featureDevWorkflow } from './workflows/feature-dev';
import { contentCreationWorkflow } from './workflows/content-creation';
import { ideaExperimentWorkflow } from './workflows/idea-experiment';
import { contentAuthorWorkflow } from './workflows/content-author';
import { eloUpdateWorkflow } from './workflows/elo-update';
import { quizApiRoutes } from './quiz/routes';

// On the droplet (SPROUT_ENV=production) only the quiz and content pipeline
// are registered: the shell-capable general agent and the git-worktree dev
// workflows have no business on a server and are left out.
const production = process.env.SPROUT_ENV === 'production';

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  server: {
    apiRoutes: quizApiRoutes,
  },
  agents: {
    ...(production
      ? {}
      : {
          agent,
          architect: architectAgent,
          builder: builderAgent,
          experimenter: experimenterAgent,
          reviewer: reviewerAgent,
        }),
    mathCurator: mathCuratorAgent,
    contentQuality: contentQualityAgent,
    contentAuthor: contentAuthorAgent,
  },
  tools: { ...(production ? {} : { startScheduleTool, stopScheduleTool, worktreeTool }), verifyMathTool, verifyTriviaTool, ideasTool, contentLibraryTool },
  workflows: {
    ...(production ? {} : { featureDev: featureDevWorkflow, ideaExperiment: ideaExperimentWorkflow }),
    contentCreation: contentCreationWorkflow,
    contentAuthor: contentAuthorWorkflow,
    eloUpdate: eloUpdateWorkflow,
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    // MYSQL_URL (the droplet) puts Mastra's own memory/workflow state in MySQL
    // alongside the app tables; otherwise a local SQLite file or Turso.
    default: process.env.MYSQL_URL
      ? new MySQLStore({
          id: 'mastra-mysql',
          connectionString: process.env.MYSQL_URL,
          ssl: process.env.MYSQL_SSL === 'true' ? true : undefined,
        })
      : new LibSQLStore({
          id: 'mastra-storage',
          url: process.env.TURSO_DATABASE_URL || 'file:./mastra.db',
          authToken: process.env.TURSO_AUTH_TOKEN || undefined,
        }),
    domains: {
      // DUCKDB_PATH lets the container keep traces on a mounted volume.
      observability: await new DuckDBStore(process.env.DUCKDB_PATH ? { path: process.env.DUCKDB_PATH } : undefined).getStore('observability'),
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
