import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const app = express();
const angular = new AngularNodeAppEngine();
app.disable('x-powered-by');
app.use(
  express.static(join(import.meta.dirname, '../browser'), {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);
// En nube, CloudFront envía /api/* al servicio de plataforma, inventario o inspecciones.
app.use('/api', (_request, response) => response.status(404).json({ error: 'not_found' }));
app.use((request, response, next) => {
  angular
    .handle(request)
    .then((rendered) => (rendered ? writeResponseToNodeResponse(rendered, response) : next()))
    .catch(next);
});
if (isMainModule(import.meta.url)) app.listen(Number(process.env['PORT'] || 4300), '127.0.0.1');
export const reqHandler = createNodeRequestHandler(app);
