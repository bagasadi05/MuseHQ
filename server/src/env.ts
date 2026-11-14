import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPaths = Array.from(
  new Set([
    path.resolve(__dirname, '..', '.env'),       // server/.env
    path.resolve(__dirname, '..', '..', '.env'), // repo root .env
    path.resolve(process.cwd(), '.env'),         // current working directory .env
  ])
);

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}
