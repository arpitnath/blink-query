import { createServer } from './utils.js';

export interface AppConfig {
  port: number;
  name: string;
}

export function startApp(config: AppConfig) {
  const server = createServer(config.port);
  console.log(`${config.name} running on port ${config.port}`);
  return server;
}

export { formatDate, slugify } from './utils.js';
