import { runDaemon } from './daemon/index.js';

runDaemon().catch((error) => {
  console.error(`[daemon] Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
