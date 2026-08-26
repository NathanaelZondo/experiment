import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { AppErrorHandler } from './core/error-handler.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Global error handling — API failures are normalized and surfaced by the stores.
    { provide: ErrorHandler, useClass: AppErrorHandler },
    // Browser globals used via inject(): MessageItem renders every chat bubble
    // and needs Navigator for its clipboard (copy message / code actions).
    // Without this provider, creating the first message bubble throws
    // "NG0201: No provider for Navigator" and nothing renders.
    { provide: Navigator, useValue: navigator }
  ]
};
