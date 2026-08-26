import { Component } from '@angular/core';
import { ConnectionSection } from './connection-section.component';
import { ModelCatalog } from './model-catalog.component';
import { GenerationSettingsForm } from './generation-settings-form.component';
import { SessionMetrics } from './session-metrics.component';

/**
 * Right-hand panel: loaded-model information, generation settings and
 * performance metrics.
 *
 * Layout contract (Known Issue 2): the panel is a fixed-width flex column with
 * `min-height: 0`. The model catalogue owns the only growing region — it is a
 * bounded scroll container (`flex: 1; min-height: 0; overflow-y: auto`) so an
 * arbitrarily long model list scrolls inside this panel and can never displace
 * the centre conversation area.
 */
@Component({
  selector: 'app-model-pane',
  imports: [ConnectionSection, ModelCatalog, GenerationSettingsForm, SessionMetrics],
  templateUrl: './model-pane.component.html',
  styleUrl: './model-pane.component.scss'
})
export class ModelPane {}
