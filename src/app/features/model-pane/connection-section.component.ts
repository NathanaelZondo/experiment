import { Component, inject, signal } from '@angular/core';
import { ConnectionStore } from '../../core/connection.store';
import { InputField } from '../../shared/ui/input.component';
import { Button } from '../../shared/ui/button.component';
import { StatusBadge } from '../../shared/ui/status-badge.component';

/**
 * LM Studio connection controls: editable server URL and optional API token
 * (both held in RAM only), a Test-connection action using GET /api/v1/models,
 * the current status badge and clear guidance for CORS / not-running failures.
 */
@Component({
  selector: 'app-connection-section',
  imports: [InputField, Button, StatusBadge],
  templateUrl: './connection-section.component.html',
  styleUrl: './connection-section.component.scss'
})
export class ConnectionSection {
  private readonly connections = inject(ConnectionStore);

  /** Local buffers — committed to the store when "Test connection" runs. */
  protected readonly urlValue = signal(this.connections.serverUrl());
  protected readonly tokenValue = signal(''); // never pre-filled, never logged

  protected readonly status = this.connections.status;
  protected readonly lastError = this.connections.lastError;
  protected readonly modelCount = this.connections.models;

  testConnection(): void {
    const url = this.urlValue().trim();
    if (!url) return;
    this.connections.setServerUrl(url);
    this.connections.setApiToken(this.tokenValue());
    void this.connections.testConnection();
  }
}
