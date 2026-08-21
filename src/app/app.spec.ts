import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the header brand and skip link', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.app-brand')?.textContent).toContain('Experiment');
    expect(compiled.querySelector('.skip-link')?.getAttribute('href')).toBe('#main-content');
  });

  it('should render the three panels', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('nav.panel--sidebar')).toBeTruthy();
    expect(compiled.querySelector('main.panel--chat')).toBeTruthy();
    expect(compiled.querySelector('aside.panel--settings')).toBeTruthy();
  });

  it('should show the friendly first-use state when no conversation exists', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.chat-welcome')?.textContent).toContain(
      'Welcome to Experiment'
    );
  });

  it('should toggle the settings panel', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const initial = app.settingsOpen;
    app.toggleSettings();
    expect(app.settingsOpen).toBe(!initial);
  });
});
