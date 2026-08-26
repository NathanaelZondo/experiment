import { Component, input } from '@angular/core';

/** Loading placeholder with a restrained shimmer (disabled under reduced motion). */
@Component({
  selector: 'app-skeleton',
  template: `<div class="lb-skel" [style.height.px]="height()" role="status" aria-label="Loading"></div>`,
  styles: `
    .lb-skel {
      border-radius: var(--radius-sm);
      background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%);
      background-size: 200% 100%;
      animation: lb-shimmer 1.4s linear infinite;
    }

    @keyframes lb-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `
})
export class Skeleton {
  readonly height = input(16);
}
