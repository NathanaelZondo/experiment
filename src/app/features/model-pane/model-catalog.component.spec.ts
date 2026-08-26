import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ModelCatalog } from './model-catalog.component';
import { ConnectionStore } from '../../core/connection.store';
import { ModelLifecycleStore } from '../../core/model-lifecycle.store';
import { ChatSessionStore } from '../../core/chat-session.store';
import { Button } from '../../shared/ui/button.component';
import { EmptyState } from '../../shared/ui/empty-state.component';
import { Skeleton } from '../../shared/ui/skeleton.component';
import { BytesPipe, DurationPipe } from '../../shared/pipes/format.pipe';
import type { CatalogModel } from '../../core/types/lm-studio.types';

describe('ModelCatalog component', () => {
  let fixture: ComponentFixture<ModelCatalog>;
  let component: ModelCatalog;
  let connections: ConnectionStore;
  let lifecycle: ModelLifecycleStore;
  let session: ChatSessionStore;

  beforeEach(async () => {
    // Create fresh store instances.
    const s = new ChatSessionStore();
    const c = new ConnectionStore();
    const l = new ModelLifecycleStore(c, s);

    TestBed.resetTestingModule();
    fixture = await TestBed.configureTestingModule({
      imports: [ModelCatalog, FormsModule, Button, EmptyState, Skeleton, BytesPipe, DurationPipe],
    }).overrideProvider(ConnectionStore, { useValue: c })
     .overrideProvider(ModelLifecycleStore, { useValue: l })
     .overrideProvider(ChatSessionStore, { useValue: s })
     .compileComponents();

    // Get the test-provided instances via TestBed.inject.
    connections = TestBed.inject(ConnectionStore);
    lifecycle = TestBed.inject(ModelLifecycleStore);
    session = TestBed.inject(ChatSessionStore);

    connections.status.set('disconnected');
    connections.models.set([]);
    fixture = TestBed.createComponent<ModelCatalog>(ModelCatalog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the catalogue section with the correct aria-label', () => {
    const section = fixture.nativeElement.querySelector('section[aria-label="Model catalogue"]');
    expect(section).toBeTruthy();
  });

  it('shows an empty state when not connected', () => {
    expect(fixture.nativeElement.querySelector('.lb-empty')).toBeTruthy();
  });

  it('shows an empty state when no models are found', () => {
    connections.status.set('connected');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.lb-empty')).toBeTruthy();
  });

  it('renders model items in a scrollable list', () => {
    connections.status.set('connected');
    connections.models.set([
      { id: 'm/1', name: 'Test Model', chatCapable: true, loaded: false, capabilities: ['chat'] }
    ]);
    fixture.detectChanges();
    const list = fixture.nativeElement.querySelector('.catalog__list');
    expect(list).toBeTruthy();
    const items = list!.querySelectorAll('.catalog__item');
    expect(items).toHaveLength(1);
    expect(items[0].querySelector('.catalog__name')?.textContent).toBe('Test Model');
  });

  it('filters to chat-capable models only by default', () => {
    connections.status.set('connected');
    connections.models.set([
      { id: 'm/chat', name: 'Chat Model', chatCapable: true, loaded: false, capabilities: ['chat'] },
      { id: 'm/embed', name: 'Embed Model', chatCapable: false, loaded: false, capabilities: ['embedding'] }
    ]);
    fixture.detectChanges();
    const items = fixture.nativeElement.querySelector('.catalog__list')!.querySelectorAll('.catalog__item');
    expect(items).toHaveLength(1);
    expect(items[0].querySelector('.catalog__name')?.textContent).toBe('Chat Model');
  });

  it('shows all models when the chat-only filter is toggled off', () => {
    connections.status.set('connected');
    connections.models.set([
      { id: 'm/chat', name: 'Chat Model', chatCapable: true, loaded: false, capabilities: ['chat'] },
      { id: 'm/embed', name: 'Embed Model', chatCapable: false, loaded: false, capabilities: ['embedding'] }
    ]);
    fixture.detectChanges();
    (component as any).chatOnly.set(false);
    fixture.detectChanges();
    const items = fixture.nativeElement.querySelector('.catalog__list')!.querySelectorAll('.catalog__item');
    expect(items).toHaveLength(2);
  });

  it('the catalogue list element has the bounded-scroll class', () => {
    connections.status.set('connected');
    connections.models.set([{ id: 'm/1', name: 'Model', chatCapable: true, loaded: false, capabilities: ['chat'] }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.catalog__list')).toBeTruthy();
  });
});
