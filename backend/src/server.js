import { createServer } from 'node:http';
import { handleApi } from './routes.js';

const port = Number(process.env.BACKEND_PORT || 3001);

const server = createServer(handleApi);

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock backend listening on http://127.0.0.1:${port}`);
});
