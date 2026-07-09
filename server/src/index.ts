import { serve } from '@hono/node-server';
import { createApp } from './app';
import { env } from './env';

serve({ fetch: createApp().fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
