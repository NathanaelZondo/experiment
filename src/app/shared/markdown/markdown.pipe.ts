import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MarkdownService } from './markdown.service';

/** Renders a markdown string to sanitized HTML (use with [innerHTML]). */
@Pipe({ name: 'markdown', pure: true })
export class MarkdownPipe implements PipeTransform {
  private readonly service = inject(MarkdownService);
  private readonly sanitizer = inject(DomSanitizer);

  transform(value?: string | null): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.service.render(value ?? ''));
  }
}
