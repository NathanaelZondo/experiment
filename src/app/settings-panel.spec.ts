import { TestBed } from '@angular/core/testing';
import { SettingsPanel } from './settings-panel';
import { LmStudioService } from './lmstudio/lm-studio.service';
import { DEFAULT_GENERATION_SETTINGS, GenerationSettingsService } from './chat/generation-settings';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** Finds the generation number input by its label. */
function genInput(el: HTMLElement, label: string): HTMLInputElement {
  const input = el.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Generation field "${label}" not found`);
  }
  return input;
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

/** Finds the "Reset to defaults" button. */
function resetButton(el: HTMLElement): HTMLButtonElement {
  const buttons = Array.from(el.querySelectorAll('button')) as HTMLButtonElement[];
  const found = buttons.find((b) => b.textContent?.includes('Reset to defaults'));
  if (!found) {
    throw new Error('Reset button not found');
  }
  return found;
}

describe('SettingsPanel — generation parameters (Phase 8)', () => {
  let service: LmStudioService;
  let gen: GenerationSettingsService;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function createFixture(): Promise<ReturnType<typeof TestBed.createComponent> & { componentInstance: SettingsPanel }> {
    const fixture = TestBed.createComponent(SettingsPanel);
    await fixture.whenStable();
    return fixture as never;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SettingsPanel] });
    service = TestBed.inject(LmStudioService);
    gen = TestBed.inject(GenerationSettingsService);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders every generation field with its default value and range hint', async () => {
    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();

    expect(genInput(el, 'Temperature').value).toBe(String(DEFAULT_GENERATION_SETTINGS.temperature));
    expect(genInput(el, 'Top P').value).toBe(String(DEFAULT_GENERATION_SETTINGS.topP));
    expect(genInput(el, 'Top K').value).toBe(String(DEFAULT_GENERATION_SETTINGS.topK));
    expect(genInput(el, 'Repeat penalty').value).toBe(String(DEFAULT_GENERATION_SETTINGS.repeatPenalty));
    expect(genInput(el, 'Max tokens').value).toBe(String(DEFAULT_GENERATION_SETTINGS.maxTokens));

    // Range hints are visible.
    expect(el.textContent).toContain('0–2');
    expect(el.textContent).toContain('1–32768');
  });

  it('shows a validation error for out-of-range input without committing', async () => {
    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();

    typeInto(genInput(el, 'Temperature'), '3'); // Above the max of 2.
    fixture.detectChanges();

    expect(el.querySelector('.field-error')?.textContent).toContain('0–2');
    // The invalid value is NOT committed to the service.
    expect(gen.settings().temperature).toBe(DEFAULT_GENERATION_SETTINGS.temperature);
    // The input keeps showing what the user typed.
    expect(genInput(el, 'Temperature').value).toBe('3');

    // A valid correction clears the error and commits.
    typeInto(genInput(el, 'Temperature'), '1.2');
    fixture.detectChanges();
    expect(el.querySelector('.field-error')).toBeNull();
    expect(gen.settings().temperature).toBe(1.2);
  });

  it('commits valid input live to the settings service', async () => {
    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();

    typeInto(genInput(el, 'Top P'), '0.5');
    typeInto(genInput(el, 'Max tokens'), '4096');
    fixture.detectChanges();

    expect(gen.settings().topP).toBe(0.5);
    expect(gen.settings().maxTokens).toBe(4096);
  });

  it('rejects fractional values for integer-only fields', async () => {
    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();

    typeInto(genInput(el, 'Max tokens'), '10.5');
    fixture.detectChanges();

    expect(el.querySelector('.field-error')?.textContent).toContain('whole number');
    expect(gen.settings().maxTokens).toBe(DEFAULT_GENERATION_SETTINGS.maxTokens);
  });

  it('updates the reasoning mode from the select', async () => {
    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();

    const select = el.querySelector('select[aria-label="Reasoning mode"]') as HTMLSelectElement;
    expect(select.value).toBe('off');

    select.value = 'high';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(gen.settings().reasoningMode).toBe('high');
  });

  it('reset restores every default and is disabled while at defaults', async () => {
    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();

    // At defaults the reset button is disabled.
    expect(resetButton(el).disabled).toBe(true);

    gen.update({ temperature: 1.5, reasoningMode: 'low' });
    fixture.detectChanges();
    expect(resetButton(el).disabled).toBe(false);

    resetButton(el).click();
    fixture.detectChanges();

    expect(gen.settings()).toEqual(DEFAULT_GENERATION_SETTINGS);
    expect(genInput(el, 'Temperature').value).toBe(String(DEFAULT_GENERATION_SETTINGS.temperature));
  });
});

describe('SettingsPanel — LM Studio section', () => {
  let service: LmStudioService;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function createFixture(): Promise<ReturnType<typeof TestBed.createComponent> & { componentInstance: SettingsPanel }> {
    const fixture = TestBed.createComponent(SettingsPanel);
    await fixture.whenStable();
    return fixture as never;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SettingsPanel] });
    service = TestBed.inject(LmStudioService);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the disconnected state with URL and token fields', async () => {
    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.lm-status-row')?.textContent).toContain('Disconnected');
    expect(el.querySelector('input[type="search"]')).toBeTruthy();
    expect(el.querySelector('input[type="password"]')).toBeTruthy();
    // No catalogue before the first successful test.
    expect(el.querySelector('.model-list')).toBeNull();
  });

  it('shows the model catalogue after a successful connection', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        object: 'list',
        data: [
          // 5_300_000_000 bytes ≈ 4.93 GiB → "4.9 GB"
          { id: 'Llama-3.2-8B-Instruct-Q4_K_M.gguf', publisher: 'Meta', quantization: 'Q4_K_M', parameter_count: 8, size: 5_300_000_000, format: 'gguf', capabilities: ['chat'], loaded: true },
          { id: 'embed-model', capabilities: ['embedding'] },
        ],
      })
    );

    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;

    await service.testConnection();
    fixture.detectChanges();

    expect(el.querySelector('.lm-status-row')?.textContent).toContain('Connected');
    const cards = el.querySelectorAll('.model-card');
    expect(cards.length).toBe(2);
    expect(el.textContent).toContain('Llama-3.2-8B-Instruct-Q4_K_M.gguf');
    expect(el.textContent).toContain('Meta');
    expect(el.textContent).toContain('Q4_K_M');
    expect(el.textContent).toContain('8B');
    expect(el.textContent).toContain('4.9 GB');
    expect(el.textContent).toContain('gguf');
    // Filtering to chat-capable models hides the embedding-only model.
    const filter = el.querySelector('.lm-filter input') as HTMLInputElement;
    filter.checked = true;
    filter.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelectorAll('.model-card').length).toBe(1);
  });

  it('shows actionable guidance when the connection fails', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { name: 'TypeError' }));

    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;

    await service.testConnection();
    fixture.detectChanges();

    expect(el.querySelector('.lm-error')?.getAttribute('role')).toBe('alert');
    const guidanceText = (el.querySelector('.lm-guidance')?.textContent ?? '').toLowerCase();
    expect(guidanceText).toContain('cross-origin');
  });

  it('updates the service URL from the input and invalidates a previous result', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ object: 'list', data: [{ id: 'm1' }] }));
    await service.testConnection();
    expect(service.status()).toBe('connected');

    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;
    const urlInput = el.querySelector('input[type="search"]') as HTMLInputElement;

    urlInput.value = 'http://new-host:9090';
    urlInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(service.serverUrl()).toBe('http://new-host:9090');
    expect(service.status()).toBe('disconnected');
  });

  it('updates the service token from the password input', async () => {
    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;
    const tokenInput = el.querySelector('input[type="password"]') as HTMLInputElement;

    tokenInput.value = 'abc123';
    tokenInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(service.apiToken()).toBe('abc123');
  });
});

describe('SettingsPanel — model lifecycle', () => {
  let service: LmStudioService;
  let fetchMock: ReturnType<typeof vi.fn>;

  function catalogResponse(loadedIds: string[]): Response {
    return new Response(JSON.stringify({ object: 'list', data: ['a-model', 'b-model'].map((id) => ({ id, capabilities: ['chat'], loaded: loadedIds.includes(id) })) }), { status: 200 });
  }

  async function createFixture(): Promise<ReturnType<typeof TestBed.createComponent> & { componentInstance: SettingsPanel }> {
    const fixture = TestBed.createComponent(SettingsPanel);
    await fixture.whenStable();
    return fixture as never;
  }

  /** Establishes a connected state with the given catalogue so the UI renders. */
  async function connectWithCatalog(loadedIds: string[]): Promise<void> {
    fetchMock.mockResolvedValueOnce(catalogResponse(loadedIds));
    await service.testConnection();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SettingsPanel] });
    service = TestBed.inject(LmStudioService);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows Load buttons on unloaded models and Unload on the loaded one', async () => {
    await connectWithCatalog(['a-model']); // a-model loaded, b-model not

    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();

    const cards = Array.from(el.querySelectorAll('.model-card'));
    expect(cards.length).toBe(2);
    // a-model is loaded → Unload button; b-model is not → Load button.
    expect((cards[0].querySelector('button')?.textContent ?? '').trim()).toContain('Unload');
    expect((cards[1].querySelector('button')?.textContent ?? '').trim()).toContain('Load');
  });

  it('loads a model from the catalogue and shows the applied configuration', async () => {
    await connectWithCatalog([]); // nothing loaded yet
    fetchMock.mockResolvedValueOnce(jsonResponse({ model: 'b-model', settings: { gpu_offload: true, context_length: 4096 } })); // load
    fetchMock.mockResolvedValueOnce(catalogResponse(['b-model'])); // post-operation refresh

    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();

    const bCard = Array.from(el.querySelectorAll('.model-card')).find((card) => card.textContent?.includes('b-model')) as HTMLElement;
    (bCard.querySelector('button') as HTMLButtonElement).click(); // starts the load via the handler

    // The button handler fires without awaiting — wait until the post-operation
    // refresh has landed (the loaded flag flips only after it completes).
    const deadline = Date.now() + 2000;
    while (!service.models().some((m) => m.id === 'b-model' && m.loaded) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    fixture.detectChanges();

    // The applied configuration is displayed.
    expect(el.querySelector('.lm-applied-config')?.textContent).toContain('b-model');
    expect(el.querySelector('.lm-applied-config')?.textContent).toContain('gpu_offload');
    // After the refresh, b-model shows an Unload button and a-model a Load button.
    const cards = Array.from(el.querySelectorAll('.model-card'));
    expect((cards[0].querySelector('button')?.textContent ?? '').trim()).toContain('Load');
    expect((cards[1].querySelector('button')?.textContent ?? '').trim()).toContain('Unload');
  });

  it('shows the loading overlay with elapsed time while a load is in flight', async () => {
    await connectWithCatalog([]); // nothing loaded yet

    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;

    let resolveLoad!: (v: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => {
      resolveLoad = resolve;
    })); // the load request hangs until we release it

    vi.useFakeTimers();
    try {
      const loadPromise = service.loadModel('b-model');
      fixture.detectChanges();

      // Overlay is visible with the target model name and an elapsed-time line.
      const overlay = el.querySelector('.lifecycle-overlay') as HTMLElement | null;
      expect(overlay).toBeTruthy();
      expect(overlay?.textContent).toContain('Loading b-model…');
      expect(overlay?.textContent).toContain('s elapsed');

      vi.advanceTimersByTime(3000);
      fixture.detectChanges();
      expect(el.querySelector('.lifecycle-elapsed')?.textContent).toBe('3s elapsed');

      // Finish the load and refresh so the overlay goes away.
      fetchMock.mockResolvedValueOnce(catalogResponse(['b-model']));
      resolveLoad(jsonResponse({ model: 'b-model' }));
      await loadPromise;
      fixture.detectChanges();
      expect(el.querySelector('.lifecycle-overlay')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables lifecycle buttons while a chat generation is active', async () => {
    await connectWithCatalog(['a-model']);
    service.setGenerating(true);

    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();

    const buttons = Array.from(el.querySelectorAll('.model-card button')) as HTMLButtonElement[];
    expect(buttons.length).toBe(2);
    for (const btn of buttons) {
      expect(btn.disabled).toBe(true);
    }
  });

  it('shows lifecycle error guidance when a load fails', async () => {
    await connectWithCatalog([]);
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { name: 'TypeError' })); // load fails
    fetchMock.mockResolvedValueOnce(catalogResponse([])); // refresh

    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;

    await service.loadModel('b-model');
    fixture.detectChanges();

    const alerts = Array.from(el.querySelectorAll('.lm-error'));
    expect(alerts.length).toBeGreaterThan(0);
    expect((el.querySelector('.lifecycle-overlay') ?? null)).toBeNull();
  });
});
