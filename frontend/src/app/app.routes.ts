import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./health/health.page').then((module) => module.HealthPage),
    title: 'Mantenimiento por Sede',
  },
  { path: '**', redirectTo: '' },
];
