import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, Router } from '@angular/router';

import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterModule],
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.css'],
})
export class ShellComponent {
  /** Theme mode - toggle dark/light */
  protected toggleTheme(): void {
    document.documentElement.classList.toggle('dark');
  }

  /** Navigation items for sidebar */
  protected readonly navItems = [
    { id: 'home', label: 'Home', link: '/' },
    { id: 'docs', label: 'Docs', link: '/docs' },
    { id: 'settings', label: 'Settings', link: '/settings' },
  ];

  /** Action items for right panel */
  protected readonly actionItems = [
    {
      id: 'refresh',
      label: 'Refresh',
      action: () => window.location.reload(),
      active: false,
    },
    {
      id: 'search',
      label: 'Search',
      action: () => alert('Search'),
      active: false,
    },
  ];

  /** Check if route is active */
  protected isRoute(route: string): boolean {
    const router = inject(Router);
    return router.url === route;
  }
}