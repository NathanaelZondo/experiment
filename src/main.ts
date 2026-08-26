import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { ConnectionStore } from './app/core/connection.store';

bootstrapApplication(App, appConfig)
  .then((ref) => {
    const connections = ref.injector.get(ConnectionStore);
    // Auto-discover the LM Studio server on startup so the status badge and the
    // loaded-model flags reflect reality without a manual "Test connection"
    // click (state stays RAM-only — this just probes the configured URL).
    // A failure leaves the normal disconnected/guidance UI visible.
    void connections.testConnection().catch(() => {});
    // Auto-reconnect: if the server was still starting (or dropped after the
    // app loaded), re-probe on focus and on an interval while disconnected so
    // the badge recovers without a manual click.
    connections.startAutoReconnect();
  })
  .catch((err) => console.error(err));
