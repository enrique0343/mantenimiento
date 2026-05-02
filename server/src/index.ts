import 'dotenv/config';
import { createServer } from 'http';
import app from './app';

const PORT = process.env.PORT || 3001;

const server = createServer(app);

server.listen(PORT, () => {
  console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📋 Ambiente: ${process.env.NODE_ENV || 'development'}\n`);
});

server.on('error', (err) => {
  console.error('Error del servidor:', err);
  process.exit(1);
});
