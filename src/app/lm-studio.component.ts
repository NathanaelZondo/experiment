import { Component, OnInit, inject } from '@angular/core';
import {
  LmStudioService,
  ModelInfo,
  ConnectionState,
  LmStudioConfig,
} from '../lm-studio.service';

@Component({
  selector: 'app-lm-studio',
  standalone: true,
  imports: [],
  templateUrl: './lm-studio.component.html',
  styleUrls: ['./lm-studio.component.css'],
})
export class LmStudioComponent implements OnInit {
  /** Public reference to the LM Studio service for template access */
  public readonly service = inject(LmStudioService);

  /** Filter text for chat-capable models */
  public filterText!: string;

  /** Get filtered and sorted model list */
  public get displayedModels(): ModelInfo[] {
    return this.service.chatModels()
      .filter((model: ModelInfo) =>
        model.name.toLowerCase().includes(this.filterText!.toLowerCase()) ||
        model.id.toLowerCase().includes(this.filterText!.toLowerCase()),
      )
      .sort((a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name));
  }

  /** Track by ID */
  public trackByModelId(_: number, model: ModelInfo): string {
    return model.id;
  }

  ngOnInit(): void {
    // No initialization needed - signals are reactive
  }

  /**
   * Attempt to connect to LM Studio.
   * Tests the connection and fetches models if successful.
   */
  public async connect(): Promise<void> {
    const success = await this.service.testConnection();
    if (success) {
      // Connection successful - models already fetched in testConnection
    }
  }

  /** Clear configuration and reset state */
  public clearConfig(): void {
    this.service.clearConfig();
  }
}