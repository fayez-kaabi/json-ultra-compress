import express from 'express';
import { jsonOptimizerMiddleware } from '../src/http/express';

const app = express();
app.use(express.json());
app.use(jsonOptimizerMiddleware({ codec: 'brotli' }));

app.get('/api/hello', (_req, res) => {
  res.json({ hello: 'world', time: Date.now() });
});

app.listen(3000, () => console.log('http://localhost:3000'));


