import type { Routes } from '@angular/router';
import { autenticadoGuard } from './core/interceptadores';
import { Layout } from './layout/layout';

export const routes: Routes = [
  { path: 'entrar', title: 'Entrar · Painel do gabinete', loadComponent: () => import('./paginas/entrar/entrar').then((m) => m.Entrar) },
  {
    path: '',
    component: Layout,
    canActivate: [autenticadoGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
      { path: 'inicio', title: 'Início · Painel do gabinete', loadComponent: () => import('./paginas/inicio/inicio').then((m) => m.InicioPagina) },
      { path: 'painel', title: 'Expedientes · Painel do gabinete', loadComponent: () => import('./paginas/painel/painel').then((m) => m.PainelPagina) },
      { path: 'expedientes/:id', title: 'Expediente · Painel do gabinete', loadComponent: () => import('./paginas/expediente/expediente').then((m) => m.ExpedientePagina) },
      { path: 'foco', title: 'Próximo processo · Painel do gabinete', loadComponent: () => import('./paginas/foco/foco').then((m) => m.FocoPagina) },
      { path: 'alertas', title: 'Alertas · Painel do gabinete', loadComponent: () => import('./paginas/alertas/alertas').then((m) => m.AlertasPagina) },
      { path: 'indicadores', title: 'Indicadores · Painel do gabinete', loadComponent: () => import('./paginas/indicadores/indicadores').then((m) => m.IndicadoresPagina) },
      { path: 'lotes', title: 'Lotes · Painel do gabinete', loadComponent: () => import('./paginas/lotes/lotes').then((m) => m.LotesPagina) },
    ],
  },
  { path: '**', redirectTo: 'inicio' },
];
