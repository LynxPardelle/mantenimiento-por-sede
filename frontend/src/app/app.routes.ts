import { Routes } from '@angular/router';
import { sessionGuard } from './auth/auth.service';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./home/home.page').then((module) => module.HomePage),
    title: 'SedePulso · Mantenimiento preventivo por sede',
  },
  {
    path: 'app',
    canActivate: [sessionGuard],
    loadComponent: () =>
      import('./maintenance/maintenance.page').then((module) => module.MaintenancePage),
    title: 'Tu operación · SedePulso',
  },
  {
    path: 'auth/callback',
    loadComponent: () => import('./auth/callback.page').then((module) => module.CallbackPage),
    title: 'Acceso · SedePulso',
  },
  {
    path: 'status',
    loadComponent: () => import('./health/health.page').then((module) => module.HealthPage),
    title: 'Disponibilidad · SedePulso',
  },
  { path: '**', redirectTo: '' },
];
