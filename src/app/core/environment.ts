/**
 * Environment configuration for LocalBench Chat.
 *
 * The LM Studio server URL defaults to http://localhost:1234 and can be changed
 * at runtime from the model pane (held in RAM only — never persisted).
 */
export interface AppEnvironment {
  /** Default base URL of the local LM Studio server. */
  lmStudioUrl: string;
}

export const environment: AppEnvironment = {
  lmStudioUrl: 'http://localhost:1234'
};
