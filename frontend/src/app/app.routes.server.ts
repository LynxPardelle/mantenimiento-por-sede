import { RenderMode, ServerRoute } from '@angular/ssr';

// Las pantallas privadas se resuelven en el navegador; no se serializan sesiones ni datos de la operación.
export const serverRoutes: ServerRoute[] = [
  { path: 'registro', renderMode: RenderMode.Client },
  { path: 'app', renderMode: RenderMode.Client },
  { path: 'app/piloto', renderMode: RenderMode.Client },
  { path: 'auth/callback', renderMode: RenderMode.Client },
  { path: 'status', renderMode: RenderMode.Client },
  { path: '**', renderMode: RenderMode.Server },
];
