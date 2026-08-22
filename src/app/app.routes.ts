import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/conversations',
    pathMatch: 'full',
  },
  {
    path: 'conversations',
    loadChildren: () =>
      import('./conversation/conversation.component').then((m) => m.ConversationComponent),
  },
  {
    path: 'lm-studio',
    loadComponent: () => import('./lm-studio.component'),
  },
  {
    path: '**',
    redirectTo: '/conversations',
  },
];