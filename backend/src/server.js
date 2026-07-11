import { createServer } from 'node:http';
import { loadLocalEnv } from './config.js';
import { handleApi } from './routes.js';
import { startScheduler } from './services/scheduler.js';

loadLocalEnv();

const port = Number(process.env.BACKEND_PORT || 3001);
const server = createServer(handleApi);
startScheduler();

server.listen(port, '127.0.0.1', () => {
  console.log(`Backend listening on http://127.0.0.1:${port}`);
});
