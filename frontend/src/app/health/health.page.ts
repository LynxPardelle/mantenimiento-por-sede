import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';

import { HealthStore } from './health.store';

@Component({
  selector: 'app-health-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [HealthStore],
  templateUrl: './health.page.html',
  styleUrl: './health.page.css',
})
export class HealthPage implements OnInit {
  protected readonly health = inject(HealthStore);

  ngOnInit(): void {
    void this.health.refresh();
  }
}
