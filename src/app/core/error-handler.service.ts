/**
 * Global error handling.
 *
 * Implements Angular's ErrorHandler as a safety net: LM Studio API failures are
 * already normalized into LmApiError by the client and handled by the stores,
 * so this handler only needs to log sanitized summaries. Error output never
 * includes request headers or credentials — the API token is attached at fetch
 * time only and is not part of any error object.
 */

import { ErrorHandler, Injectable } from '@angular/core';
import { LmApiError } from './api-error';

@Injectable({ providedIn: 'root' })
export class AppErrorHandler extends ErrorHandler {
  override handleError(error: unknown): void {
    if (error instanceof LmApiError) {
      // Expected API failure — stores surface these to the UI. Log a safe summary only.
      console.warn(`[LocalBench] LM Studio ${error.kind} error: ${error.message}`);
      return;
    }
    super.handleError(error);
  }
}
