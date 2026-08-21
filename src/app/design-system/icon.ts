import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const ICON_PATHS: Record<string, string[]> = {
  plus: ['M12 5v14', 'M5 12h14'],
  sun: [
    'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    'M12 2v2',
    'M12 20v2',
    'M4.93 4.93l1.41 1.41',
    'M17.66 17.66l1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'M4.93 19.07l1.41-1.41',
    'M17.66 6.34l1.41-1.41'
  ],
  moon: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  sliders: [
    'M4 21v-7',
    'M4 10V3',
    'M12 21v-9',
    'M12 8V3',
    'M20 21v-5',
    'M20 12V3',
    'M1 14h6',
    'M9 8h6',
    'M17 16h6'
  ],
  trash: [
    'M3 6h18',
    'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2',
    'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
    'M10 11v6',
    'M14 11v6'
  ],
  pencil: ['M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'],
  send: ['M22 2 11 13', 'M22 2 15 22l-4-9-9-4Z'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z'],
  copy: ['M8 8h12v12H8z', 'M16 8V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3'],
  check: ['M20 6 9 17l-5-5'],
  stop: ['M6 6h12v12H6z'],
  refresh: [
    'M21 12a9 9 0 1 1-2.64-6.36',
    'M21 3v6h-6'
  ]
};

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      [style.width.px]="size()"
      [style.height.px]="size()"
    >
      @for (d of paths(); track d) {
        <path [attr.d]="d" />
      }
    </svg>
  `
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(20);

  readonly paths = computed(() => ICON_PATHS[this.name()] ?? []);
}
