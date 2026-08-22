import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ShellComponent } from './shell.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ShellComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('experiment');
}
